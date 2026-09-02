// Cluster D — Organizations. The org backbone the arsenal lacked: registries (EDGAR, GLEIF, Companies House,
// OpenCorporates), the knowledge graph (Wikidata — orgs AND people), nonprofits (ProPublica 990s), government
// money (USAspending), litigation (CourtListener) and risk (OpenSanctions). Same shape as the other clusters:
// pure `parseX` (tested on captured shapes) + async runner, self-rate-limited, uniform CapabilityResult.
// Keyless: edgar, gleif, wikidata, nonprofit, usaspending, court. Keyed: companies_house, opencorporates,
// sanctions (parse-tested only until keys are provisioned). Live-verified 2026-09-02 (research/17 §D).
import { getJson, getJsonOrNull, getText, postJson } from "./http.ts";
import { type CapabilityResult, type CapProvenance, type CapEdge, aggregateRecurring, dedupePivots, emptyResult } from "./types.ts";

const now = () => new Date().toISOString();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** strip corporate suffixes so "Palantir Technologies Inc." ≈ "PALANTIR TECHNOLOGIES" for fuzzy name matching */
const stem = (s: string) => norm(s).replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|pbc)\b/g, "").replace(/\s+/g, " ").trim();
const domainOf = (url: string): string | undefined => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return undefined; } };

// ---------------------------------------------------------------------------
// D1. SEC EDGAR — the US public-company profile + filing history (keyless, needs a UA with contact)
// ---------------------------------------------------------------------------
export interface EdgarSubmissions {
  cik: string; name: string; entityType?: string; sic?: string; sicDescription?: string; ein?: string; lei?: string | null;
  tickers?: string[]; exchanges?: string[]; website?: string; investorWebsite?: string; stateOfIncorporation?: string; fiscalYearEnd?: string; category?: string;
  formerNames?: { name: string; from?: string; to?: string }[];
  addresses?: { business?: { street1?: string; city?: string; stateOrCountry?: string; zipCode?: string }; mailing?: { street1?: string; city?: string; stateOrCountry?: string } };
  filings?: { recent?: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[]; primaryDocDescription?: string[] } };
}

/** Forms worth listing one-by-one (material events, registrations, ownership); the rest are aggregated by form. */
const NOTABLE_FORMS = new Set(["10-K", "10-Q", "8-K", "S-1", "S-1/A", "F-1", "DEF 14A", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "D", "D/A", "424B4", "20-F", "6-K"]);

export function parseEdgarSubmissions(j: EdgarSubmissions): CapabilityResult {
  const prov: CapProvenance = { capability: "org.edgar", source: "SEC EDGAR", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = { ...j, filings: undefined }; // the filing arrays are large; keep the profile only
  const name = j.name?.trim();
  if (!name) { prov.note = "no EDGAR entity"; return r; }
  const cik = String(Number(j.cik));
  // EDGAR files people (insiders) under the same shape; without SIC/EIN/tickers a "SURNAME GIVEN" name is a reporting owner
  const isPerson = !j.sic && !j.tickers?.length && (!j.ein || j.ein === "000000000") && !/\b(inc|corp|llc|ltd|trust|fund|lp|l\.?p\.?|partners|capital|holdings|group|co)\b/i.test(name);
  r.entities.push({ type: isPerson ? "person" : "organization", kind: isPerson ? undefined : j.tickers?.length ? "public_company" : "company", name, hints: { cik, ...(j.ein && j.ein !== "000000000" ? { ein: j.ein } : {}), ...(j.lei ? { lei: j.lei } : {}) } });
  r.attributes.push({ entity: name, key: "cik", value: cik });
  if (j.ein && j.ein !== "000000000") r.attributes.push({ entity: name, key: "ein", value: j.ein });
  if (j.lei) r.attributes.push({ entity: name, key: "lei", value: j.lei });
  if (j.sicDescription) r.attributes.push({ entity: name, key: "industry", value: j.sicDescription });
  if (j.sic) r.attributes.push({ entity: name, key: "sic", value: j.sic });
  if (j.stateOfIncorporation) r.attributes.push({ entity: name, key: "state_of_incorporation", value: j.stateOfIncorporation });
  if (j.category) r.attributes.push({ entity: name, key: "filer_category", value: j.category });
  for (const t of j.tickers ?? []) r.attributes.push({ entity: name, key: "ticker", value: t });
  for (const x of j.exchanges ?? []) if (x) r.attributes.push({ entity: name, key: "exchange", value: x });
  for (const site of [j.website, j.investorWebsite]) {
    if (!site) continue;
    r.attributes.push({ entity: name, key: "website", value: site });
    const d = domainOf(site); if (d) r.pivots.push({ kind: "domain", value: d });
  }
  const b = j.addresses?.business;
  if (b?.city) r.attributes.push({ entity: name, key: "headquarters", value: [b.street1, b.city, b.stateOrCountry, b.zipCode].filter(Boolean).join(", ") });
  for (const f of j.formerNames ?? []) {
    if (!f.name) continue;
    r.attributes.push({ entity: name, key: "former_name", value: f.name, at: f.from?.slice(0, 10) });
    r.edges.push({ subject: name, predicate: "formerly_known_as", object: f.name, from: f.from?.slice(0, 10), to: f.to?.slice(0, 10) });
  }
  // filings: notable forms listed individually (bounded), the rest aggregated per form type
  const rec = j.filings?.recent;
  if (rec) {
    const byForm = new Map<string, { n: number; first: string; last: string }>();
    let listed = 0;
    for (let i = 0; i < rec.form.length; i++) {
      const form = rec.form[i]!, date = rec.filingDate[i]!;
      const cur = byForm.get(form);
      if (!cur) byForm.set(form, { n: 1, first: date, last: date });
      else { cur.n++; if (date < cur.first) cur.first = date; if (date > cur.last) cur.last = date; }
      if (NOTABLE_FORMS.has(form) && listed < 25) {
        listed++;
        const acc = rec.accessionNumber[i]!.replace(/-/g, "");
        const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${rec.primaryDocument[i]}`;
        r.edges.push({ subject: name, predicate: "filed", object: `${form} ${date}`, at: date, qualifiers: { form, url, ...(rec.primaryDocDescription?.[i] ? { description: rec.primaryDocDescription[i]! } : {}) } });
      }
    }
    for (const [form, s] of byForm) r.attributes.push({ entity: name, key: `filings:${form}`, value: `${s.n} (${s.first} → ${s.last})` });
    const first = [...rec.filingDate].sort()[0];
    if (first) r.attributes.push({ entity: name, key: "first_sec_filing", value: first });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

interface TickerRow { cik_str: number; ticker: string; title: string }
let tickerCache: TickerRow[] | null = null;
const SEC_HEADERS = { Accept: "application/json" };
const secUa = () => ({ "User-Agent": `worldgraph-research/1.0 ${process.env.SEC_CONTACT_EMAIL ?? process.env.OPENALEX_MAILTO ?? "research@example.com"}` });

/** Resolve a company name / ticker / CIK to a 10-digit CIK. Public companies come from the ticker file;
 *  everything else (private filers, funds, people) from the cik_lookup HTML. Pure matcher exported for tests. */
export function matchTicker(rows: TickerRow[], q: string): TickerRow | undefined {
  const qq = q.trim();
  if (/^\d+$/.test(qq)) return rows.find((r) => r.cik_str === Number(qq)) ?? { cik_str: Number(qq), ticker: "", title: "" };
  const byTicker = rows.find((r) => r.ticker.toLowerCase() === qq.toLowerCase());
  if (byTicker) return byTicker;
  const s = stem(qq);
  return rows.find((r) => stem(r.title) === s) ?? rows.find((r) => stem(r.title).startsWith(s)) ?? rows.find((r) => stem(r.title).includes(s));
}

/** Parse the EDGAR company-browser HTML (name search covers private filers, funds and insiders that the ticker
 *  file lacks); rows are `CIK=0001234567…>0001234567</a></td><td>NAME</td>`. Exact-stem matches sort first. */
export function parseEdgarCompanyList(html: string, q: string): { cik: string; name: string }[] {
  const out: { cik: string; name: string }[] = [];
  const re = /CIK=(\d{10})[^>]*>\d{10}<\/a><\/td>\s*<td[^>]*>([^<]+)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ cik: m[1]!, name: m[2]!.trim() });
  const s = stem(q);
  const score = (n: string) => { const t = stem(n); return t === s ? 3 : t.startsWith(s) ? 2 : t.includes(s) ? 1 : 0; };
  return out.sort((a, b) => score(b.name) - score(a.name) || a.name.length - b.name.length); // exact > prefix > contains; shorter wins ties
}

export async function edgar(q: string): Promise<CapabilityResult> {
  const headers = { ...secUa(), ...SEC_HEADERS };
  if (!tickerCache) tickerCache = Object.values(await getJson<Record<string, TickerRow>>("https://www.sec.gov/files/company_tickers.json", { rateKey: "sec.gov", minIntervalMs: 150, headers }));
  let hit = matchTicker(tickerCache, q);
  if (!hit) {
    const html = await getText(`https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(q)}&owner=include&action=getcompany&count=100`, { rateKey: "sec.gov", minIntervalMs: 150, headers: secUa() });
    const rows = parseEdgarCompanyList(html, q);
    if (rows[0]) hit = { cik_str: Number(rows[0].cik), ticker: "", title: rows[0].name };
  }
  if (!hit) { const r = emptyResult({ capability: "org.edgar", source: "SEC EDGAR", fetched_at: now(), grade: "A", tier: "easy", note: `no EDGAR filer matched "${q}"` }); return r; }
  const cik = String(hit.cik_str).padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const j = await getJson<EdgarSubmissions>(url, { rateKey: "sec.gov", minIntervalMs: 150, headers });
  const r = parseEdgarSubmissions(j);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// D2. GLEIF — Legal Entity Identifiers + corporate parent/child tree (keyless, global)
// ---------------------------------------------------------------------------
export interface GleifRecord {
  id: string;
  attributes: {
    lei: string;
    entity: {
      legalName: { name: string }; otherNames?: { name: string; type?: string }[];
      legalAddress?: { addressLines?: string[]; city?: string; region?: string; country?: string; postalCode?: string };
      headquartersAddress?: { addressLines?: string[]; city?: string; region?: string; country?: string };
      registeredAt?: { id?: string }; registeredAs?: string; jurisdiction?: string; category?: string; legalForm?: { id?: string }; status?: string;
      creationDate?: string | null;
    };
    registration?: { initialRegistrationDate?: string; lastUpdateDate?: string; status?: string };
  };
  relationships?: Record<string, unknown>;
}
export interface GleifTree { record: GleifRecord; directParent?: GleifRecord | null; ultimateParent?: GleifRecord | null; children: GleifRecord[]; childrenTotal?: number }

const addr = (a?: { addressLines?: string[]; city?: string; region?: string; country?: string }) => a ? [...(a.addressLines ?? []), a.city, a.region, a.country].filter(Boolean).join(", ") : undefined;

export function parseGleif(t: GleifTree): CapabilityResult {
  const prov: CapProvenance = { capability: "org.gleif", source: "GLEIF", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = t;
  const e = t.record.attributes.entity;
  const name = e.legalName.name;
  r.entities.push({ type: "organization", kind: "company", name, hints: { lei: t.record.attributes.lei } });
  r.attributes.push({ entity: name, key: "lei", value: t.record.attributes.lei });
  if (e.jurisdiction) r.attributes.push({ entity: name, key: "jurisdiction", value: e.jurisdiction });
  if (e.status) r.attributes.push({ entity: name, key: "entity_status", value: e.status });
  if (e.registeredAs) r.attributes.push({ entity: name, key: "registry_number", value: e.registeredAs });
  if (e.legalForm?.id) r.attributes.push({ entity: name, key: "legal_form", value: e.legalForm.id });
  if (e.creationDate) r.attributes.push({ entity: name, key: "founded", value: e.creationDate.slice(0, 10) });
  const la = addr(e.legalAddress), ha = addr(e.headquartersAddress);
  if (la) r.attributes.push({ entity: name, key: "legal_address", value: la });
  if (ha && ha !== la) r.attributes.push({ entity: name, key: "headquarters", value: ha });
  for (const o of e.otherNames ?? []) if (o.name && o.name !== name) r.attributes.push({ entity: name, key: o.type === "PREVIOUS_LEGAL_NAME" ? "former_name" : "alias", value: o.name });
  const link = (rec: GleifRecord, predicate: string, reverse = false) => {
    const n = rec.attributes.entity.legalName.name;
    if (n === name) return;
    r.entities.push({ type: "organization", kind: "company", name: n, hints: { lei: rec.attributes.lei, ...(rec.attributes.entity.jurisdiction ? { jurisdiction: rec.attributes.entity.jurisdiction } : {}) } });
    r.edges.push(reverse ? { subject: n, predicate, object: name } : { subject: name, predicate, object: n });
    r.pivots.push({ kind: "org", value: n });
  };
  if (t.directParent) link(t.directParent, "subsidiary_of");
  if (t.ultimateParent && t.ultimateParent.id !== t.directParent?.id) link(t.ultimateParent, "ultimately_owned_by");
  for (const c of t.children) link(c, "subsidiary_of", true);
  if (t.childrenTotal && t.childrenTotal > t.children.length) prov.note = `${t.childrenTotal} direct children; first ${t.children.length} listed`;
  r.pivots = dedupePivots(r.pivots);
  return r;
}

const GLEIF = "https://api.gleif.org/api/v1";
const gleifOpts = { rateKey: "api.gleif.org", minIntervalMs: 1000 };
export async function gleif(q: string): Promise<CapabilityResult> {
  let record: GleifRecord | undefined;
  if (/^[A-Z0-9]{20}$/i.test(q.trim())) record = (await getJsonOrNull<{ data: GleifRecord }>(`${GLEIF}/lei-records/${q.trim().toUpperCase()}`, gleifOpts))?.data;
  else {
    const j = await getJson<{ data: GleifRecord[] }>(`${GLEIF}/lei-records?filter%5Bfulltext%5D=${encodeURIComponent(q)}&page%5Bsize%5D=10`, gleifOpts);
    const s = stem(q);
    record = j.data.find((d) => stem(d.attributes.entity.legalName.name) === s) ?? j.data.find((d) => d.attributes.entity.status === "ACTIVE") ?? j.data[0];
  }
  if (!record) return emptyResult({ capability: "org.gleif", source: "GLEIF", fetched_at: now(), grade: "A", tier: "easy", note: `no LEI record matched "${q}"` });
  const lei = record.attributes.lei;
  const rel = async (path: string) => (await getJsonOrNull<{ data: GleifRecord }>(`${GLEIF}/lei-records/${lei}/${path}`, gleifOpts))?.data ?? null;
  const [directParent, ultimateParent, kids] = await Promise.all([
    rel("direct-parent"), rel("ultimate-parent"),
    getJsonOrNull<{ data: GleifRecord[]; meta?: { pagination?: { total?: number } } }>(`${GLEIF}/lei-records/${lei}/direct-children?page%5Bsize%5D=50`, gleifOpts),
  ]);
  const r = parseGleif({ record, directParent, ultimateParent, children: kids?.data ?? [], childrenTotal: kids?.meta?.pagination?.total });
  r.provenance.url = `${GLEIF}/lei-records/${lei}`;
  return r;
}

// ---------------------------------------------------------------------------
// D3. Wikidata — the crowd-sourced knowledge graph for orgs AND people (keyless, grade B: referenced but open-edit)
// ---------------------------------------------------------------------------
interface WdSnak { datavalue?: { type: string; value: unknown } }
interface WdClaim { mainsnak: WdSnak; qualifiers?: Record<string, WdSnak[]>; rank?: string }
export interface WdEntity { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Record<string, WdClaim[]> }

/** property → (predicate, direction, object entity type). Orgs + people share one table so a Wikidata lookup works for either. */
const WD_RELS: Record<string, { predicate: string; type: string; kind?: string; reverse?: boolean }> = {
  P112: { predicate: "founded_by", type: "person" },
  P169: { predicate: "led_by", type: "person", kind: "ceo" },
  P488: { predicate: "chaired_by", type: "person" },
  P3320: { predicate: "board_member", type: "person", reverse: true },
  P749: { predicate: "subsidiary_of", type: "organization" },
  P127: { predicate: "owned_by", type: "organization" },
  P355: { predicate: "subsidiary_of", type: "organization", reverse: true },
  P1830: { predicate: "owns", type: "organization" },
  P159: { predicate: "headquartered_in", type: "place" },
  P17: { predicate: "located_in_country", type: "place" },
  P452: { predicate: "operates_in_industry", type: "concept" },
  P108: { predicate: "works_at", type: "organization" },
  P69: { predicate: "educated_at", type: "organization", kind: "school" },
  P26: { predicate: "spouse_of", type: "person" },
  P39: { predicate: "holds_position", type: "concept" },
  P463: { predicate: "member_of", type: "organization" },
  P1037: { predicate: "led_by", type: "person" },
  P1327: { predicate: "partner_of", type: "organization" },
  P1889: { predicate: "distinct_from", type: "organization" },
  P1366: { predicate: "replaced_by", type: "organization" },
  P1365: { predicate: "replaces", type: "organization" },
  P27: { predicate: "citizen_of", type: "place" },
  P19: { predicate: "born_in", type: "place" },
  P551: { predicate: "resides_in", type: "place" },
  P800: { predicate: "created", type: "work" },
};
const WD_ATTRS: Record<string, string> = { P571: "founded", P576: "dissolved", P856: "website", P1128: "employees", P2139: "revenue", P2295: "net_profit", P569: "date_of_birth", P570: "date_of_death", P1454: "legal_form", P1448: "official_name", P2427: "grid_id", P1278: "lei", P1297: "irs_ein", P3347: "permid", P2622: "companies_house_number", P5531: "cik", P4156: "czech_id", P1320: "opencorporates_id", P2657: "eu_transparency_register", P1005: "ptbnp", P2088: "crunchbase_org", P2003: "instagram", P2002: "twitter", P2013: "facebook", P2037: "github", P4264: "linkedin_company", P6634: "linkedin_person", P496: "orcid", P213: "isni", P227: "gnd", P214: "viaf", P106: "occupation", P1412: "language", P21: "gender", P734: "family_name", P735: "given_name" };
const WD_ENTITY_ATTRS = new Set(["P106", "P1454", "P21", "P734", "P735", "P1412"]); // attribute values that are themselves items (need label resolution)

/** "+2010-00-00T00:00:00Z" precision 9 → "2010"; 10 → "2010-05"; 11 → "2010-05-03" */
export function wdTime(v: { time: string; precision: number }): string {
  const m = /^\+?(-?\d+)-(\d\d)-(\d\d)/.exec(v.time);
  if (!m) return v.time;
  if (v.precision >= 11) return `${m[1]}-${m[2]}-${m[3]}`;
  if (v.precision === 10) return `${m[1]}-${m[2]}`;
  return m[1]!;
}
const snakVal = (s?: WdSnak) => s?.datavalue?.value;
const asId = (v: unknown) => (v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : undefined);
const asTime = (v: unknown) => (v && typeof v === "object" && "time" in v ? wdTime(v as { time: string; precision: number }) : undefined);
const asAmount = (v: unknown) => (v && typeof v === "object" && "amount" in v ? String((v as { amount: string }).amount).replace(/^\+/, "") : undefined);
const qualTime = (c: WdClaim, p: string) => asTime(snakVal(c.qualifiers?.[p]?.[0]));

/** Collect every linked item id a claims set refers to (so the runner can resolve labels in one batch call). */
export function wdLinkedIds(e: WdEntity): string[] {
  const ids = new Set<string>();
  for (const [p, claims] of Object.entries(e.claims ?? {})) {
    if (!(p in WD_RELS) && !WD_ENTITY_ATTRS.has(p)) continue;
    for (const c of claims) { const id = asId(snakVal(c.mainsnak)); if (id) ids.add(id); }
  }
  return [...ids];
}

export function parseWikidata(e: WdEntity, resolved: Record<string, WdResolved | string>): CapabilityResult {
  const labels: Record<string, string> = Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));
  const kindOf = (id: string) => { const v = resolved[id]; return typeof v === "object" ? v : undefined; };
  const prov: CapProvenance = { capability: "org.wikidata", source: "Wikidata", fetched_at: now(), grade: "B", tier: "easy", url: `https://www.wikidata.org/wiki/${e.id}` };
  const r = emptyResult(prov);
  r.raw = { id: e.id, labels: e.labels, descriptions: e.descriptions, aliases: e.aliases };
  const name = e.labels?.en?.value;
  if (!name) { prov.note = "no English label"; return r; }
  const instanceOf = (e.claims?.P31 ?? []).map((c) => asId(snakVal(c.mainsnak))).filter(Boolean) as string[];
  const isHuman = instanceOf.includes("Q5");
  r.entities.push({ type: isHuman ? "person" : "organization", name, hints: { wikidata: e.id } });
  r.attributes.push({ entity: name, key: "wikidata", value: e.id });
  const desc = e.descriptions?.en?.value; if (desc) r.attributes.push({ entity: name, key: "description", value: desc });
  for (const a of e.aliases?.en ?? []) if (a.value !== name) r.attributes.push({ entity: name, key: "alias", value: a.value });
  const lbl = (id: string) => labels[id] ?? id;
  for (const [p, claims] of Object.entries(e.claims ?? {})) {
    const live = claims.filter((c) => c.rank !== "deprecated");
    const rel = WD_RELS[p];
    if (rel) {
      for (const c of live) {
        const id = asId(snakVal(c.mainsnak)); if (!id) continue;
        const other = lbl(id); if (other === id) continue; // unresolved label — skip rather than emit a Q-id as a name
        const from = qualTime(c, "P580"), to = qualTime(c, "P582"), at = qualTime(c, "P585");
        const role = asId(snakVal(c.qualifiers?.P39?.[0])) ?? asId(snakVal(c.qualifiers?.P2868?.[0]));
        const qualifiers: Record<string, string> = {}; if (role && labels[role]) qualifiers.role = labels[role];
        const k = kindOf(id);
        const type = k?.human ? "person" : k?.org && rel.type === "person" ? "organization" : rel.type; // the item decides when it can
        r.entities.push({ type, kind: type === rel.type ? rel.kind : undefined, name: other, hints: { wikidata: id } });
        r.edges.push(rel.reverse ? { subject: other, predicate: rel.predicate, object: name, from, to, at, qualifiers: Object.keys(qualifiers).length ? qualifiers : undefined }
                                 : { subject: name, predicate: rel.predicate, object: other, from, to, at, qualifiers: Object.keys(qualifiers).length ? qualifiers : undefined });
        if (type === "person") r.pivots.push({ kind: "name", value: other });
        if (type === "organization") r.pivots.push({ kind: "org", value: other });
      }
      continue;
    }
    const key = WD_ATTRS[p];
    if (!key) continue;
    for (const c of live) {
      const v = snakVal(c.mainsnak);
      const value = WD_ENTITY_ATTRS.has(p) ? (asId(v) ? lbl(asId(v)!) : undefined) : asTime(v) ?? asAmount(v) ?? (typeof v === "string" ? v : undefined);
      if (!value || /^Q\d+$/.test(value)) continue;
      r.attributes.push({ entity: name, key, value, at: qualTime(c, "P585") ?? qualTime(c, "P580") });
      if (key === "website") { const d = domainOf(value); if (d) r.pivots.push({ kind: "domain", value: d }); }
      if (key === "twitter" || key === "github" || key === "instagram") r.pivots.push({ kind: "username", value });
      if (key === "orcid" || key === "lei" || key === "cik" || key === "irs_ein" || key === "companies_house_number") r.entities[0]!.hints![key] = value;
    }
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

const WD_API = "https://www.wikidata.org/w/api.php";
const wdOpts = { rateKey: "wikidata.org", minIntervalMs: 300 };
export interface WdResolved { label: string; human?: boolean; org?: boolean }

/** One SPARQL round-trip: English label + whether the item is a human (P31 Q5) or an organization-ish thing. */
export async function wdResolve(ids: string[]): Promise<Record<string, WdResolved>> {
  const out: Record<string, WdResolved> = {};
  const uniq = [...new Set(ids)].filter((x) => /^Q\d+$/.test(x));
  for (let i = 0; i < uniq.length; i += 200) {
    const batch = uniq.slice(i, i + 200);
    const sparql = `SELECT ?item ?itemLabel (SAMPLE(?h) AS ?human) (SAMPLE(?o) AS ?org) WHERE { VALUES ?item { ${batch.map((x) => `wd:${x}`).join(" ")} }
      OPTIONAL { ?item wdt:P31 wd:Q5 . BIND(true AS ?h) }
      OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q43229 . BIND(true AS ?o) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?item ?itemLabel`;
    const j = await getJson<{ results: { bindings: { item: { value: string }; itemLabel?: { value: string }; human?: { value: string }; org?: { value: string } }[] } }>(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, { ...wdOpts, rateKey: "query.wikidata.org", minIntervalMs: 1000, headers: { Accept: "application/sparql-results+json" }, timeoutMs: 60_000 });
    for (const b of j.results.bindings) {
      const id = b.item.value.replace(/^.*\//, "");
      const label = b.itemLabel?.value ?? id;
      if (label === id) continue;
      out[id] = { label, human: b.human?.value === "true", org: b.org?.value === "true" };
    }
  }
  return out;
}

export async function wikidata(q: string): Promise<CapabilityResult> {
  let id = /^Q\d+$/i.test(q.trim()) ? q.trim().toUpperCase() : undefined;
  if (!id) {
    const s = await getJson<{ search?: { id: string; label?: string; description?: string }[] }>(`${WD_API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&limit=5`, wdOpts);
    // prefer an exact label match; Wikidata's own ranking is decent otherwise
    const hit = s.search?.find((x) => x.label && norm(x.label) === norm(q)) ?? s.search?.[0];
    id = hit?.id;
  }
  if (!id) return emptyResult({ capability: "org.wikidata", source: "Wikidata", fetched_at: now(), grade: "B", tier: "easy", note: `no Wikidata item matched "${q}"` });
  const ent = await getJson<{ entities: Record<string, WdEntity> }>(`${WD_API}?action=wbgetentities&ids=${id}&props=claims|labels|descriptions|aliases&languages=en&format=json`, wdOpts);
  const e = ent.entities[id]!;
  const linked = wdLinkedIds(e);
  // also resolve role qualifiers (P39 / P2868) so "board member (chair)" reads as a role, not a Q-id
  for (const claims of Object.values(e.claims ?? {})) for (const c of claims) for (const p of ["P39", "P2868"]) { const rid = asId(snakVal(c.qualifiers?.[p]?.[0])); if (rid) linked.push(rid); }
  let resolved: Record<string, WdResolved> = {};
  try { resolved = await wdResolve(linked); }
  catch { // SPARQL down → fall back to plain labels (types then follow the property)
    for (let i = 0; i < linked.length; i += 50) {
      const batch = [...new Set(linked.slice(i, i + 50))];
      const lj = await getJson<{ entities: Record<string, { labels?: { en?: { value: string } } }> }>(`${WD_API}?action=wbgetentities&ids=${batch.join("|")}&props=labels&languages=en&format=json`, wdOpts);
      for (const [k, v] of Object.entries(lj.entities)) if (v.labels?.en?.value) resolved[k] = { label: v.labels.en.value };
    }
  }
  return parseWikidata(e, resolved);
}

// ---------------------------------------------------------------------------
// D4. Nonprofits — ProPublica Nonprofit Explorer (IRS 990 data, keyless)
// ---------------------------------------------------------------------------
export interface ProPublicaOrg {
  organization: { ein: number; name: string; address?: string; city?: string; state?: string; zipcode?: string; ntee_code?: string; subsection_code?: number; ruling_date?: string; tax_period?: string };
  filings_with_data?: { tax_prd_yr: number; totrevenue?: number; totfuncexpns?: number; totassetsend?: number; totliabend?: number; compnsatncurrofcr?: number; pdf_url?: string | null }[];
  filings_without_data?: { tax_prd_yr: number; pdf_url?: string | null }[];
}
const SUBSECTION: Record<number, string> = { 3: "501(c)(3)", 4: "501(c)(4)", 5: "501(c)(5)", 6: "501(c)(6)", 7: "501(c)(7)", 19: "501(c)(19)" };

export function parseProPublica(j: ProPublicaOrg): CapabilityResult {
  const prov: CapProvenance = { capability: "org.nonprofit", source: "ProPublica Nonprofit Explorer (IRS 990)", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  const o = j.organization;
  const name = o.name;
  const ein = String(o.ein).padStart(9, "0").replace(/^(\d\d)(\d{7})$/, "$1-$2");
  r.entities.push({ type: "organization", kind: "nonprofit", name, hints: { ein } });
  r.attributes.push({ entity: name, key: "ein", value: ein });
  if (o.subsection_code != null) r.attributes.push({ entity: name, key: "tax_status", value: SUBSECTION[o.subsection_code] ?? `501(c)(${o.subsection_code})` });
  if (o.ntee_code) r.attributes.push({ entity: name, key: "ntee_code", value: o.ntee_code });
  if (o.ruling_date) r.attributes.push({ entity: name, key: "irs_ruling_date", value: o.ruling_date.slice(0, 7) });
  const loc = [o.address, o.city, o.state, o.zipcode].filter(Boolean).join(", "); if (loc) r.attributes.push({ entity: name, key: "address", value: loc });
  for (const f of j.filings_with_data ?? []) {
    const at = String(f.tax_prd_yr);
    if (f.totrevenue != null) r.attributes.push({ entity: name, key: "revenue", value: String(f.totrevenue), at });
    if (f.totfuncexpns != null) r.attributes.push({ entity: name, key: "expenses", value: String(f.totfuncexpns), at });
    if (f.totassetsend != null) r.attributes.push({ entity: name, key: "total_assets", value: String(f.totassetsend), at });
    if (f.compnsatncurrofcr) r.attributes.push({ entity: name, key: "officer_compensation", value: String(f.compnsatncurrofcr), at });
    if (f.pdf_url) r.pivots.push({ kind: "url", value: f.pdf_url });
  }
  const years = [...(j.filings_with_data ?? []), ...(j.filings_without_data ?? [])].map((f) => f.tax_prd_yr).sort();
  if (years.length) r.attributes.push({ entity: name, key: "filings:990", value: `${years.length} (${years[0]} → ${years[years.length - 1]})` });
  return r;
}

const PP = "https://projects.propublica.org/nonprofits/api/v2";
const ppOpts = { rateKey: "projects.propublica.org", minIntervalMs: 1000 };
export async function nonprofit(q: string): Promise<CapabilityResult> {
  let ein = q.replace(/-/g, "");
  if (!/^\d{9}$/.test(ein)) {
    const s = await getJson<{ organizations?: { ein: number; name: string; score?: number }[] }>(`${PP}/search.json?q=${encodeURIComponent(q)}`, ppOpts);
    const st = stem(q);
    const hit = s.organizations?.find((o) => stem(o.name) === st) ?? s.organizations?.[0];
    if (!hit) return emptyResult({ capability: "org.nonprofit", source: "ProPublica Nonprofit Explorer (IRS 990)", fetched_at: now(), grade: "A", tier: "easy", note: `no nonprofit matched "${q}"` });
    ein = String(hit.ein);
  }
  const url = `${PP}/organizations/${ein}.json`;
  const j = await getJson<ProPublicaOrg>(url, ppOpts);
  const r = parseProPublica(j); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// D5. USAspending — federal contracts/grants to a recipient (keyless)
// ---------------------------------------------------------------------------
export interface UsaSpendingAward { "Award ID": string; "Recipient Name": string; "Awarding Agency"?: string; "Awarding Sub Agency"?: string; "Award Amount"?: number; "Start Date"?: string; "End Date"?: string; Description?: string; generated_internal_id?: string }

export function parseUsaSpending(awards: UsaSpendingAward[], q: string): CapabilityResult {
  const prov: CapProvenance = { capability: "org.usaspending", source: "USAspending.gov", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = awards;
  if (!awards.length) { prov.note = `no federal awards found for "${q}"`; return r; }
  const recipients = new Map<string, number>();
  for (const a of awards) recipients.set(a["Recipient Name"], (recipients.get(a["Recipient Name"]) ?? 0) + 1);
  const subject = [...recipients.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  r.entities.push({ type: "organization", kind: "company", name: subject });
  for (const n of recipients.keys()) if (n !== subject) { r.entities.push({ type: "organization", kind: "company", name: n }); r.attributes.push({ entity: subject, key: "related_recipient", value: n }); }
  const perAgency: CapEdge[] = [];
  const top = [...awards].sort((a, b) => (b["Award Amount"] ?? 0) - (a["Award Amount"] ?? 0)).slice(0, 5);
  for (const a of awards) {
    const agency = a["Awarding Sub Agency"] || a["Awarding Agency"]; if (!agency) continue;
    if (a["Awarding Agency"]) r.entities.push({ type: "organization", kind: "government_agency", name: a["Awarding Agency"] });
    if (a["Awarding Sub Agency"]) { r.entities.push({ type: "organization", kind: "government_agency", name: a["Awarding Sub Agency"] }); if (a["Awarding Agency"]) r.edges.push({ subject: a["Awarding Sub Agency"], predicate: "part_of", object: a["Awarding Agency"] }); }
    const url = a.generated_internal_id ? `https://www.usaspending.gov/award/${a.generated_internal_id}` : undefined;
    perAgency.push({ subject: a["Recipient Name"], predicate: "awarded_contract_by", object: agency, at: a["Start Date"], value: a["Award Amount"] != null ? String(a["Award Amount"]) : undefined });
    if (top.includes(a)) r.edges.push({ subject: a["Recipient Name"], predicate: "holds_contract", object: `${a["Award ID"]} (${agency})`, from: a["Start Date"], to: a["End Date"], value: a["Award Amount"] != null ? String(a["Award Amount"]) : undefined, qualifiers: { award_id: a["Award ID"], ...(a.Description ? { description: a.Description.slice(0, 200) } : {}), ...(url ? { url } : {}) } });
  }
  r.edges.push(...aggregateRecurring(perAgency, 2)); // many task orders from one agency → one relationship with count/total/span
  const seen = new Set<string>(); r.entities = r.entities.filter((e) => !seen.has(e.name) && seen.add(e.name));
  const seenE = new Set<string>(); r.edges = r.edges.filter((e) => { const k = `${e.subject}|${e.predicate}|${e.object}`; return !seenE.has(k) && seenE.add(k); });
  return r;
}

export async function usaspending(q: string): Promise<CapabilityResult> {
  const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
  const o = { rateKey: "api.usaspending.gov", minIntervalMs: 1000 };
  const fields = ["Award ID", "Recipient Name", "Awarding Agency", "Awarding Sub Agency", "Award Amount", "Start Date", "End Date", "Description", "generated_internal_id"];
  const period = [{ start_date: "2008-01-01", end_date: `${new Date().getFullYear() + 1}-12-31` }];
  // the API refuses mixed award groups in one call: contracts (A–D) and grants (02–05) are fetched separately
  const call = (codes: string[]) => postJson<{ results?: UsaSpendingAward[] }>(url, { filters: { recipient_search_text: [q], award_type_codes: codes, time_period: period }, fields, limit: 100, sort: "Award Amount", order: "desc" }, o);
  const [contracts, grants] = await Promise.all([call(["A", "B", "C", "D"]), call(["02", "03", "04", "05"])]);
  const r = parseUsaSpending([...(contracts.results ?? []), ...(grants.results ?? [])], q); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// D6. Litigation — CourtListener (opinions + RECAP dockets, keyless; token lifts limits)
// ---------------------------------------------------------------------------
export interface ClDocket { caseName: string; docketNumber?: string; court?: string; dateFiled?: string; dateTerminated?: string | null; party?: string[]; attorney?: string[]; firm?: string[]; docket_absolute_url?: string; suitNature?: string; cause?: string; assignedTo?: string }
export interface ClOpinion { caseName: string; docketNumber?: string; court?: string; dateFiled?: string; absolute_url?: string; citation?: string[]; status?: string; judge?: string }

/** Party names carry no type; guess person for "Given Surname"-shaped names, organization otherwise (resolver re-types downstream). */
const ORG_WORDS = /\b(inc|corp|corporation|llc|ltd|co|company|lp|llp|plc|pbc|trust|fund|bank|group|university|college|school|hospital|city|county|state|states|department|agency|commission|board|association|partners|holdings|se|ag|gmbh|sa|nv|bv|oy|ab|pty|bhd|srl|spa)\b\.?/i;
export const partyType = (p: string) => (ORG_WORDS.test(p) || /\d/.test(p) || /\b(of|the|and|&)\b/i.test(p)) ? "organization" : p.trim().split(/\s+/).length <= 4 ? "person" : "organization";

export function parseCourtListener(dockets: ClDocket[], opinions: ClOpinion[], q: string): CapabilityResult {
  const prov: CapProvenance = { capability: "org.court", source: "CourtListener (RECAP + opinions)", fetched_at: now(), grade: "A", tier: "easy", note: "name-matched; a common name will pull unrelated cases — confirm parties before trusting" };
  const r = emptyResult(prov);
  r.raw = { dockets, opinions };
  const s = stem(q);
  const matches = (txt?: string) => !!txt && stem(txt).includes(s);
  r.entities.push({ type: "organization", name: q });
  let n = 0;
  for (const d of dockets) {
    const party = (d.party ?? []).find(matches) ?? (matches(d.caseName) ? q : undefined);
    if (!party) continue;
    n++;
    const caseName = d.caseName;
    const url = d.docket_absolute_url ? `https://www.courtlistener.com${d.docket_absolute_url}` : undefined;
    r.entities.push({ type: "legal_case", name: caseName, hints: { ...(d.docketNumber ? { docket: d.docketNumber } : {}), ...(d.court ? { court: d.court } : {}) } });
    r.edges.push({ subject: q, predicate: "party_to", object: caseName, from: d.dateFiled, to: d.dateTerminated ?? undefined, qualifiers: { ...(d.court ? { court: d.court } : {}), ...(d.docketNumber ? { docket: d.docketNumber } : {}), ...(d.suitNature ? { nature: d.suitNature } : {}), ...(url ? { url } : {}) } });
    // RECAP lists parties without sides, so co-defendants and plaintiffs alike are "co-litigants"; the caption ("A v. B") carries the sides
    for (const p of d.party ?? []) if (p !== party && p && !matches(p)) { r.entities.push({ type: partyType(p), name: p }); r.edges.push({ subject: q, predicate: "co_litigant", object: p, at: d.dateFiled, qualifiers: { case: caseName } }); }
    for (const f of d.firm ?? []) if (f) { r.entities.push({ type: "organization", kind: "law_firm", name: f }); r.edges.push({ subject: f, predicate: "counsel_in", object: caseName }); }
  }
  for (const o of opinions) {
    if (!matches(o.caseName)) continue;
    n++;
    const url = o.absolute_url ? `https://www.courtlistener.com${o.absolute_url}` : undefined;
    r.entities.push({ type: "legal_case", name: o.caseName, hints: { ...(o.docketNumber ? { docket: o.docketNumber } : {}), ...(o.court ? { court: o.court } : {}) } });
    r.edges.push({ subject: q, predicate: "party_to", object: o.caseName, at: o.dateFiled, qualifiers: { kind: "opinion", ...(o.court ? { court: o.court } : {}), ...(o.citation?.length ? { citation: o.citation.join("; ") } : {}), ...(url ? { url } : {}) } });
  }
  if (!n) prov.note = `no cases naming "${q}" (dockets ${dockets.length}, opinions ${opinions.length} searched)`;
  const seen = new Set<string>(); r.entities = r.entities.filter((e) => !seen.has(e.name) && seen.add(e.name));
  const seenE = new Set<string>(); r.edges = r.edges.filter((e) => { const k = `${e.subject}|${e.predicate}|${e.object}`; return !seenE.has(k) && seenE.add(k); });
  return r;
}

const CL = "https://www.courtlistener.com/api/rest/v4/search/";
export async function courtCases(q: string): Promise<CapabilityResult> {
  const headers = process.env.COURTLISTENER_TOKEN ? { Authorization: `Token ${process.env.COURTLISTENER_TOKEN}` } : undefined;
  const o = { rateKey: "courtlistener.com", minIntervalMs: 1500, headers };
  const [d, op] = await Promise.all([
    getJson<{ results?: ClDocket[] }>(`${CL}?q=${encodeURIComponent(`"${q}"`)}&type=r&order_by=dateFiled%20desc`, o),
    getJson<{ results?: ClOpinion[] }>(`${CL}?q=${encodeURIComponent(`"${q}"`)}&type=o&order_by=dateFiled%20desc`, o),
  ]);
  const r = parseCourtListener(d.results ?? [], op.results ?? [], q); r.provenance.url = `${CL}?q="${q}"`; return r;
}

// ---------------------------------------------------------------------------
// D7. Companies House (UK) — company, officers, persons with significant control (free key)
// ---------------------------------------------------------------------------
export interface ChCompany { company_name: string; company_number: string; company_status?: string; type?: string; date_of_creation?: string; date_of_cessation?: string; sic_codes?: string[]; registered_office_address?: { address_line_1?: string; locality?: string; postal_code?: string; country?: string }; previous_company_names?: { name: string; ceased_on?: string; effective_from?: string }[] }
export interface ChOfficer { name: string; officer_role?: string; appointed_on?: string; resigned_on?: string; nationality?: string; occupation?: string; date_of_birth?: { month?: number; year?: number }; country_of_residence?: string; links?: { officer?: { appointments?: string } } }
export interface ChPsc { name?: string; kind?: string; natures_of_control?: string[]; notified_on?: string; ceased_on?: string; nationality?: string; country_of_residence?: string; date_of_birth?: { month?: number; year?: number }; identification?: { registration_number?: string; country_registered?: string } }

/** Companies House stores officer names as "SURNAME, Given Names" — flip to natural order. */
const titleCaps = (s: string) => s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
export const chName = (n: string) => { const m = /^([^,]+),\s*(.+)$/.exec(n.trim()); return m ? `${titleCaps(m[2]!.trim())} ${titleCaps(m[1]!.trim())}` : n.trim(); };

export function parseCompaniesHouse(c: ChCompany, officers: ChOfficer[], pscs: ChPsc[]): CapabilityResult {
  const prov: CapProvenance = { capability: "org.companies_house", source: "Companies House", fetched_at: now(), grade: "A", tier: "easy", url: `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}` };
  const r = emptyResult(prov);
  r.raw = { company: c, officers, pscs };
  const name = c.company_name;
  r.entities.push({ type: "organization", kind: "company", name, hints: { companies_house: c.company_number } });
  r.attributes.push({ entity: name, key: "companies_house_number", value: c.company_number });
  if (c.company_status) r.attributes.push({ entity: name, key: "entity_status", value: c.company_status });
  if (c.type) r.attributes.push({ entity: name, key: "legal_form", value: c.type });
  if (c.date_of_creation) r.attributes.push({ entity: name, key: "founded", value: c.date_of_creation });
  if (c.date_of_cessation) r.attributes.push({ entity: name, key: "dissolved", value: c.date_of_cessation });
  for (const s of c.sic_codes ?? []) r.attributes.push({ entity: name, key: "sic", value: s });
  const a = c.registered_office_address; const ad = a && [a.address_line_1, a.locality, a.postal_code, a.country].filter(Boolean).join(", "); if (ad) r.attributes.push({ entity: name, key: "registered_address", value: ad });
  for (const p of c.previous_company_names ?? []) r.edges.push({ subject: name, predicate: "formerly_known_as", object: p.name, from: p.effective_from, to: p.ceased_on });
  for (const o of officers) {
    const isCorp = /corporate/i.test(o.officer_role ?? "");
    const on = isCorp ? o.name : chName(o.name);
    const hints: Record<string, string> = {}; if (o.date_of_birth?.year) hints.birth_year = String(o.date_of_birth.year); if (o.nationality) hints.nationality = o.nationality;
    r.entities.push({ type: isCorp ? "organization" : "person", name: on, hints });
    r.edges.push({ subject: on, predicate: "officer_of", object: name, from: o.appointed_on, to: o.resigned_on, qualifiers: { ...(o.officer_role ? { role: o.officer_role } : {}), ...(o.occupation ? { occupation: o.occupation } : {}) } });
    if (o.date_of_birth?.year) r.attributes.push({ entity: on, key: "birth_year_month", value: `${o.date_of_birth.year}${o.date_of_birth.month ? "-" + String(o.date_of_birth.month).padStart(2, "0") : ""}` });
    if (o.nationality) r.attributes.push({ entity: on, key: "nationality", value: o.nationality });
    if (o.country_of_residence) r.attributes.push({ entity: on, key: "country_of_residence", value: o.country_of_residence });
    if (!isCorp) r.pivots.push({ kind: "name", value: on }); else r.pivots.push({ kind: "org", value: on });
  }
  for (const p of pscs) {
    if (!p.name) continue;
    const isCorp = /corporate|legal-person/i.test(p.kind ?? "");
    const pn = isCorp ? p.name : chName(p.name);
    r.entities.push({ type: isCorp ? "organization" : "person", name: pn, hints: p.identification?.registration_number ? { registration_number: p.identification.registration_number } : {} });
    r.edges.push({ subject: pn, predicate: "controls", object: name, from: p.notified_on, to: p.ceased_on, qualifiers: p.natures_of_control?.length ? { nature: p.natures_of_control.join("; ") } : undefined });
    r.pivots.push({ kind: isCorp ? "org" : "name", value: pn });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

const CH = "https://api.company-information.service.gov.uk";
export async function companiesHouse(q: string): Promise<CapabilityResult> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return emptyResult({ capability: "org.companies_house", source: "Companies House", fetched_at: now(), grade: "A", tier: "easy", note: "COMPANIES_HOUSE_API_KEY not set (free at developer.company-information.service.gov.uk)" });
  const o = { rateKey: "company-information.service.gov.uk", minIntervalMs: 600, headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` } };
  let num = q.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(num)) {
    const s = await getJson<{ items?: { title: string; company_number: string; company_status?: string }[] }>(`${CH}/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`, o);
    const st = stem(q);
    const hit = s.items?.find((i) => stem(i.title) === st && i.company_status === "active") ?? s.items?.find((i) => stem(i.title) === st) ?? s.items?.[0];
    if (!hit) return emptyResult({ capability: "org.companies_house", source: "Companies House", fetched_at: now(), grade: "A", tier: "easy", note: `no UK company matched "${q}"` });
    num = hit.company_number;
  }
  const [c, off, psc] = await Promise.all([
    getJson<ChCompany>(`${CH}/company/${num}`, o),
    getJsonOrNull<{ items?: ChOfficer[] }>(`${CH}/company/${num}/officers?items_per_page=100`, o),
    getJsonOrNull<{ items?: ChPsc[] }>(`${CH}/company/${num}/persons-with-significant-control?items_per_page=100`, o),
  ]);
  return parseCompaniesHouse(c, off?.items ?? [], psc?.items ?? []);
}

// ---------------------------------------------------------------------------
// D8. OpenCorporates — the global company registry aggregate (keyed; the reverse-officer pivot is the prize)
// ---------------------------------------------------------------------------
export interface OcCompany { name: string; company_number: string; jurisdiction_code: string; incorporation_date?: string | null; dissolution_date?: string | null; company_type?: string; current_status?: string; registered_address_in_full?: string; opencorporates_url?: string; previous_names?: { company_name: string; start_date?: string; end_date?: string }[]; officers?: { officer: { name: string; position?: string; start_date?: string | null; end_date?: string | null } }[]; registry_url?: string }
export interface OcOfficerHit { officer: { name: string; position?: string; start_date?: string | null; end_date?: string | null; company: { name: string; jurisdiction_code: string; company_number: string; opencorporates_url?: string } } }

export function parseOpenCorporates(c: OcCompany | null, officerHits: OcOfficerHit[], q: string): CapabilityResult {
  const prov: CapProvenance = { capability: "org.opencorporates", source: "OpenCorporates", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = { company: c, officerHits };
  if (c) {
    const name = c.name;
    r.entities.push({ type: "organization", kind: "company", name, hints: { opencorporates: `${c.jurisdiction_code}/${c.company_number}` } });
    r.attributes.push({ entity: name, key: "jurisdiction", value: c.jurisdiction_code.toUpperCase().replace("_", "-") });
    r.attributes.push({ entity: name, key: "registry_number", value: c.company_number });
    if (c.incorporation_date) r.attributes.push({ entity: name, key: "founded", value: c.incorporation_date });
    if (c.dissolution_date) r.attributes.push({ entity: name, key: "dissolved", value: c.dissolution_date });
    if (c.current_status) r.attributes.push({ entity: name, key: "entity_status", value: c.current_status });
    if (c.company_type) r.attributes.push({ entity: name, key: "legal_form", value: c.company_type });
    if (c.registered_address_in_full) r.attributes.push({ entity: name, key: "registered_address", value: c.registered_address_in_full.replace(/\n/g, ", ") });
    for (const p of c.previous_names ?? []) r.edges.push({ subject: name, predicate: "formerly_known_as", object: p.company_name, from: p.start_date, to: p.end_date });
    for (const { officer: o } of c.officers ?? []) {
      const on = /,/.test(o.name) ? chName(o.name) : o.name;
      r.entities.push({ type: "person", name: on });
      r.edges.push({ subject: on, predicate: "officer_of", object: name, from: o.start_date ?? undefined, to: o.end_date ?? undefined, qualifiers: o.position ? { role: o.position } : undefined });
      r.pivots.push({ kind: "name", value: on });
    }
    if (c.opencorporates_url) prov.url = c.opencorporates_url;
  }
  // reverse officer search: a person name → every company they're an officer of (the shell-network pivot)
  for (const { officer: o } of officerHits) {
    const on = /,/.test(o.name) ? chName(o.name) : o.name;
    r.entities.push({ type: "person", name: on });
    r.entities.push({ type: "organization", kind: "company", name: o.company.name, hints: { opencorporates: `${o.company.jurisdiction_code}/${o.company.company_number}` } });
    r.edges.push({ subject: on, predicate: "officer_of", object: o.company.name, from: o.start_date ?? undefined, to: o.end_date ?? undefined, qualifiers: { ...(o.position ? { role: o.position } : {}), jurisdiction: o.company.jurisdiction_code.toUpperCase() } });
    r.pivots.push({ kind: "org", value: o.company.name });
  }
  if (!c && !officerHits.length) prov.note = `no OpenCorporates company or officer matched "${q}"`;
  const seen = new Set<string>(); r.entities = r.entities.filter((e) => !seen.has(`${e.type}|${e.name}`) && seen.add(`${e.type}|${e.name}`));
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function openCorporates(q: string, mode: "company" | "officer" = "company"): Promise<CapabilityResult> {
  const tok = process.env.OPENCORPORATES_API_TOKEN;
  if (!tok) return emptyResult({ capability: "org.opencorporates", source: "OpenCorporates", fetched_at: now(), grade: "A", tier: "easy", note: "OPENCORPORATES_API_TOKEN not set (api.opencorporates.com)" });
  const o = { rateKey: "api.opencorporates.com", minIntervalMs: 1500 };
  if (mode === "officer") {
    const j = await getJson<{ results?: { officers?: OcOfficerHit[] } }>(`https://api.opencorporates.com/v0.4/officers/search?q=${encodeURIComponent(q)}&api_token=${tok}&per_page=50`, o);
    return parseOpenCorporates(null, j.results?.officers ?? [], q);
  }
  const s = await getJson<{ results?: { companies?: { company: OcCompany }[] } }>(`https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(q)}&api_token=${tok}&per_page=10`, o);
  const st = stem(q);
  const hit = s.results?.companies?.find((x) => stem(x.company.name) === st && x.company.current_status?.toLowerCase().includes("active")) ?? s.results?.companies?.find((x) => stem(x.company.name) === st) ?? s.results?.companies?.[0];
  if (!hit) return parseOpenCorporates(null, [], q);
  const full = await getJson<{ results?: { company: OcCompany } }>(`https://api.opencorporates.com/v0.4/companies/${hit.company.jurisdiction_code}/${hit.company.company_number}?api_token=${tok}`, o);
  return parseOpenCorporates(full.results?.company ?? hit.company, [], q);
}

// ---------------------------------------------------------------------------
// D9. Sanctions / PEP — OpenSanctions (keyed; free for non-commercial on request)
// ---------------------------------------------------------------------------
export interface OsResult { id: string; caption: string; schema: string; datasets?: string[]; properties?: Record<string, string[]>; first_seen?: string; last_seen?: string; target?: boolean }

export function parseOpenSanctions(results: OsResult[], q: string): CapabilityResult {
  const prov: CapProvenance = { capability: "org.sanctions", source: "OpenSanctions", fetched_at: now(), grade: "A", tier: "easy", note: "name-matched screening; a hit is a lead to confirm (DOB/nationality), not a finding" };
  const r = emptyResult(prov);
  r.raw = results;
  const s = stem(q);
  const hits = results.filter((x) => stem(x.caption).includes(s) || (x.properties?.alias ?? []).some((a) => stem(a).includes(s)) || (x.properties?.name ?? []).some((a) => stem(a).includes(s)));
  if (!hits.length) { prov.note = `no OpenSanctions match for "${q}" (${results.length} candidates screened)`; return r; }
  for (const h of hits) {
    const type = h.schema === "Person" ? "person" : h.schema === "Company" || h.schema === "Organization" || h.schema === "LegalEntity" ? "organization" : "thing";
    const name = h.caption;
    r.entities.push({ type, name, hints: { opensanctions: h.id } });
    const p = h.properties ?? {};
    const topics = p.topics ?? [];
    for (const t of topics) r.attributes.push({ entity: name, key: "risk_topic", value: t });
    if (h.target) r.attributes.push({ entity: name, key: "sanctions_target", value: "true" });
    for (const d of h.datasets ?? []) r.edges.push({ subject: name, predicate: "listed_in", object: d, from: h.first_seen?.slice(0, 10) });
    for (const k of ["birthDate", "nationality", "country", "position", "gender", "incorporationDate", "registrationNumber", "leiCode", "address"] as const) for (const v of p[k] ?? []) r.attributes.push({ entity: name, key: k.replace(/([A-Z])/g, "_$1").toLowerCase(), value: v });
    for (const a of p.alias ?? []) if (a !== name) r.attributes.push({ entity: name, key: "alias", value: a });
    for (const e of p.email ?? []) r.pivots.push({ kind: "email", value: e });
    for (const w of p.website ?? []) { const d = domainOf(w); if (d) r.pivots.push({ kind: "domain", value: d }); }
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function sanctions(q: string): Promise<CapabilityResult> {
  const key = process.env.OPENSANCTIONS_API_KEY;
  if (!key) return emptyResult({ capability: "org.sanctions", source: "OpenSanctions", fetched_at: now(), grade: "A", tier: "easy", note: "OPENSANCTIONS_API_KEY not set (free non-commercial key at opensanctions.org/api)" });
  const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(q)}&limit=10`;
  const j = await getJson<{ results?: OsResult[] }>(url, { rateKey: "api.opensanctions.org", minIntervalMs: 500, headers: { Authorization: `ApiKey ${key}` } });
  const r = parseOpenSanctions(j.results ?? [], q); r.provenance.url = url; return r;
}
