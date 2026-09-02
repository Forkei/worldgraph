// CapabilityResult → core ExtractionOutput. This is the bridge that lets capability facts enter the graph through
// the SAME path as page-extracted facts (buildClaims → claims → rebuild → resolve → grade): every capability
// fact becomes a claim with a quote (the rendered fact line), a source (the API call) and a grade (the
// adapter's declared reliability). Vocabulary mapping is explicit; anything unmapped becomes a
// `candidate:<label>` under the closest registry parent (never dropped, never invented). Pure + tested.
import { registry as loadRegistry, type ExtractionOutput, type Registry, type TimeOut } from "@worldgraph/core";
import type { CapabilityResult, CapEdge, CapEntity } from "./types.ts";

type Out = ExtractionOutput;
type Rel = Out["relations"][number];
type Attr = Out["attributes"][number];
type Mention = Out["mentions"][number];

const kv = (o?: Record<string, string>) => Object.entries(o ?? {}).filter(([, v]) => v != null && v !== "").map(([key, value]) => ({ key, value: String(value) }));
const NO_TIME: TimeOut = { temporal_kind: "timeless", valid_from: "", valid_to: "", date: "", time_qualifier: "unknown", inferred: false, derivation: "" };
const timeOf = (e: { from?: string; to?: string; at?: string }): TimeOut =>
  e.from || e.to ? { ...NO_TIME, temporal_kind: "interval" as const, valid_from: e.from ?? "", valid_to: e.to ?? "", time_qualifier: "exact" as const }
  : e.at ? { ...NO_TIME, temporal_kind: "instant" as const, date: e.at, time_qualifier: "exact" as const }
  : NO_TIME;

// ---------------------------------------------------------------------------
// Entity types: capability type/kind → registry node type + kind (+ identity hints the resolver keys on)
// ---------------------------------------------------------------------------
const ORG_KIND: Record<string, string> = { public_company: "company", government_agency: "agency", law_firm: "company", registrar: "company", nonprofit: "nonprofit", school: "school", company: "company", fund: "fund", court: "court" };
const ACCOUNT_KIND: Record<string, string> = { domain: "domain", hostname: "hostname", ip: "ip", ip_address: "ip", email: "email", username: "username", handle: "handle", phone: "phone", wallet: "wallet" };
const DOC_KIND: Record<string, string> = { image: "photo", url: "page", page: "page", document: "page", filing: "filing", article: "article" };
/** the strongest external identifier wins the single `registry_id` identity slot; the rest stay attributes */
const REGISTRY_ID_ORDER = ["lei", "cik", "ein", "companies_house", "companies_house_number", "opencorporates", "registration_number", "docket", "wikidata", "opensanctions"];

export function mapEntityType(e: CapEntity): { type: string; kind: string; type_label: string; type_parent: string } {
  const t = e.type.toLowerCase();
  if (t === "person") return { type: "person", kind: e.kind ?? "", type_label: "", type_parent: "" };
  if (t === "organization" || t === "org") return { type: "organization", kind: ORG_KIND[e.kind ?? ""] ?? e.kind ?? "", type_label: "", type_parent: "" };
  if (t in ACCOUNT_KIND) return { type: "account", kind: ACCOUNT_KIND[t]!, type_label: "", type_parent: "" };
  if (t === "account") return { type: "account", kind: e.kind ?? "", type_label: "", type_parent: "" };
  if (t === "place") return { type: "place", kind: e.kind ?? "", type_label: "", type_parent: "" };
  if (t === "legal_case" || t === "legal_matter") return { type: "legal_matter", kind: e.kind ?? "case", type_label: "", type_parent: "" };
  if (t in DOC_KIND) return { type: "document", kind: e.kind ?? DOC_KIND[t]!, type_label: "", type_parent: "" };
  if (["event", "asset", "transaction", "position", "credential", "artifact"].includes(t)) return { type: t, kind: e.kind ?? "", type_label: "", type_parent: "" };
  return { type: "candidate", kind: e.kind ?? "", type_label: t, type_parent: "artifact" }; // concept / work / thing / unknown
}

export function mapHints(e: CapEntity, type: string): Record<string, string> {
  const h = e.hints ?? {};
  const out: Record<string, string> = {};
  for (const k of REGISTRY_ID_ORDER) if (h[k]) { out.registry_id = `${k.replace(/_number$/, "")}:${h[k]}`; break; }
  if (h.email) out.email = h.email;
  if (h.orcid) out.orcid = h.orcid;
  if (h.url) out.url = h.url;
  if (h.domain) out.domain = h.domain;
  if (type === "account") out.identifier = e.name;
  for (const [k, v] of Object.entries(h)) if (!(k in out) && !REGISTRY_ID_ORDER.includes(k)) out[k] = v; // keep the rest as soft hints
  return out;
}

// ---------------------------------------------------------------------------
// Predicates: capability predicate → registry predicate (possibly swapped / with a role qualifier), or → attribute
// ---------------------------------------------------------------------------
interface PredMap { predicate: string; swap?: boolean; parent?: string; qualifiers?: Record<string, string>; objectType?: { type: string; kind: string } }
const PLACE_PREDS = new Set(["headquartered_in", "located_in_country", "born_in", "resides_in", "located_in", "based_in"]);
const AS_ATTRIBUTE: Record<string, string> = { formerly_known_as: "aliases", listed_in: "listed_in", operates_in_industry: "industry", holds_position: "occupation", citizen_of: "nationality" };
const PRED: Record<string, PredMap> = {
  subsidiary_of: { predicate: "subsidiary_of" },
  ultimately_owned_by: { predicate: "ultimately_owned_by", parent: "subsidiary_of" },
  part_of: { predicate: "part_of" },
  owned_by: { predicate: "owns", swap: true },
  owns: { predicate: "owns" },
  controls: { predicate: "controls" },
  founded_by: { predicate: "founded", swap: true },
  led_by: { predicate: "manages", swap: true, qualifiers: { role: "chief executive" } },
  chaired_by: { predicate: "board_member", swap: true, qualifiers: { role: "chair" } },
  board_member: { predicate: "board_member" },
  works_at: { predicate: "works_at" },
  affiliated_with: { predicate: "affiliated_with", parent: "member_of" },
  educated_at: { predicate: "studied_at" },
  studied_at: { predicate: "studied_at" },
  spouse_of: { predicate: "spouse_of" },
  parent_of: { predicate: "parent_of" },
  member_of: { predicate: "member_of" },
  donated_to: { predicate: "paid" },
  paid: { predicate: "paid" },
  awarded_contract_by: { predicate: "paid", swap: true, qualifiers: { for: "contract" } },
  holds_contract: { predicate: "participated_in", objectType: { type: "transaction", kind: "contract_award" } },
  party_to: { predicate: "party_to" },
  co_litigant: { predicate: "co_litigant", parent: "associated_with" },
  counsel_in: { predicate: "party_to", qualifiers: { role: "counsel" } },
  filed: { predicate: "authored", objectType: { type: "document", kind: "filing" } },
  registered_by: { predicate: "owns", swap: true, qualifiers: { via: "registrant" } },
  appears_on: { predicate: "mentions", swap: true },
  uses_account: { predicate: "uses_account" },
  replaced_by: { predicate: "preceded_by", swap: true },
  replaces: { predicate: "preceded_by" },
  partner_of: { predicate: "transacted_with" },
  created: { predicate: "authored" },
  coauthor_of: { predicate: "knows", qualifiers: { via: "coauthor" } },
};
/** an officer's role decides the registry predicate: directors sit on the board, executives manage, others are members */
function officerPred(role?: string): PredMap {
  const r = (role ?? "").toLowerCase();
  if (/director|board|chair|trustee/.test(r)) return { predicate: "board_member" };
  if (/president|chief|ceo|cfo|coo|cto|secretary|treasurer|manager|managing|partner|principal|officer|executive/.test(r)) return { predicate: "manages" };
  return { predicate: "officer_of", parent: "member_of" };
}

// ---------------------------------------------------------------------------
// Attributes: capability key → registry key (or candidate under a parent), datatype
// ---------------------------------------------------------------------------
const REGISTRY_ID_KEYS = new Set(["cik", "lei", "ein", "companies_house_number", "registry_number", "opencorporates", "wikidata", "opensanctions", "orcid", "docket", "lei_code", "irs_ein", "permid", "grid_id", "isni", "viaf", "gnd", "crunchbase_org", "eu_transparency_register"]);
const PLACE_KEYS = new Set(["location", "headquarters", "address", "registered_address", "legal_address", "country_of_residence"]);
const ACCOUNT_KEYS: Record<string, string> = { email: "email", twitter: "handle", github: "username", instagram: "handle", facebook: "handle", linkedin_company: "handle", linkedin_person: "handle" };
const KEY: Record<string, { key: string; parent?: string; datatype?: Attr["datatype"] }> = {
  founded: { key: "founded_on", datatype: "date" }, founded_on: { key: "founded_on", datatype: "date" }, incorporation_date: { key: "founded_on", datatype: "date" }, creation_date: { key: "founded_on", datatype: "date" },
  dissolved: { key: "dissolved_on", datatype: "date" }, dissolved_on: { key: "dissolved_on", datatype: "date" },
  date_of_birth: { key: "date_of_birth", datatype: "date" }, birth_date: { key: "date_of_birth", datatype: "date" }, birth_year_month: { key: "date_of_birth", datatype: "date" }, date_of_death: { key: "date_of_death", datatype: "date" },
  entity_status: { key: "status" }, domain_status: { key: "status" }, status: { key: "status" }, company_status: { key: "status" },
  website: { key: "website", datatype: "url" }, url: { key: "url", datatype: "url" },
  employees: { key: "employee_count", datatype: "number" }, employee_count: { key: "employee_count", datatype: "number" },
  revenue: { key: "revenue", datatype: "money" }, expenses: { key: "expenses", parent: "revenue", datatype: "money" }, total_assets: { key: "total_assets", parent: "revenue", datatype: "money" }, net_profit: { key: "net_profit", parent: "revenue", datatype: "money" }, officer_compensation: { key: "officer_compensation", parent: "revenue", datatype: "money" },
  alias: { key: "aliases" }, former_name: { key: "aliases" }, official_name: { key: "aliases" }, related_recipient: { key: "related_recipient", parent: "aliases" },
  description: { key: "description" }, industry: { key: "industry" }, sic: { key: "sic", parent: "industry" }, ntee_code: { key: "ntee", parent: "industry" },
  ticker: { key: "ticker" }, exchange: { key: "exchange", parent: "ticker" },
  jurisdiction: { key: "jurisdiction" }, state_of_incorporation: { key: "jurisdiction" }, legal_form: { key: "legal_form" }, tax_status: { key: "tax_status", parent: "legal_form" }, filer_category: { key: "filer_category", parent: "legal_form" },
  nationality: { key: "nationality" }, occupation: { key: "occupation" }, position: { key: "occupation" }, gender: { key: "gender" },
  registration_date: { key: "registration_date", parent: "founded_on", datatype: "date" }, expiration_date: { key: "expiration_date", parent: "ends_on", datatype: "date" },
  first_sec_filing: { key: "first_sec_filing", parent: "starts_on", datatype: "date" }, irs_ruling_date: { key: "irs_ruling_date", parent: "founded_on", datatype: "date" },
  risk_topic: { key: "risk_topic", parent: "status" }, sanctions_target: { key: "status" },
  coordinates: { key: "coordinates", datatype: "geo" },
};
const looksDate = (v: string) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v);
const looksUrl = (v: string) => /^https?:\/\//i.test(v);
const looksNumber = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

// ---------------------------------------------------------------------------
// Rendering (the quote is the rendered fact line; the source text is all lines — quotes are found verbatim)
// ---------------------------------------------------------------------------
const renderEdge = (e: CapEdge) => {
  const t = e.from || e.to ? ` (${e.from ?? "?"} → ${e.to ?? "…"})` : e.at ? ` (${e.at})` : "";
  const v = e.value != null ? ` = ${e.value}` : "";
  const q = e.qualifiers && Object.keys(e.qualifiers).length ? ` {${Object.entries(e.qualifiers).map(([k, x]) => `${k}: ${x}`).join("; ")}}` : "";
  return `${e.subject} —${e.predicate}→ ${e.object}${t}${v}${q}`;
};
const renderAttr = (a: { entity: string; key: string; value: string; at?: string }) => `${a.entity}: ${a.key} = ${a.value}${a.at ? ` (${a.at})` : ""}`;

export interface CapExtraction { output: Out; text: string; title: string }

/** Convert one CapabilityResult into the extractor's output shape + the synthetic source text its quotes live in. */
export function capabilityToExtraction(r: CapabilityResult, input: string, reg: Registry = loadRegistry()): CapExtraction {
  const p = r.provenance;
  const mentions: Mention[] = [];
  const refOf = new Map<string, string>();
  const byName = new Map<string, CapEntity>();
  for (const e of r.entities) if (!byName.has(e.name)) byName.set(e.name, e);
  const ref = (name: string, fallback?: { type: string; kind: string }): string => {
    const k = name.trim();
    const have = refOf.get(k); if (have) return have;
    const e = byName.get(k) ?? { type: fallback?.type ?? "organization", kind: fallback?.kind, name: k };
    const mt = fallback && !byName.has(k) ? { type: fallback.type, kind: fallback.kind, type_label: "", type_parent: "" } : mapEntityType(e);
    const id = `m${mentions.length + 1}`;
    mentions.push({ ref: id, surface: k, name: k, type: mt.type, type_label: mt.type_label, type_parent: mt.type_parent, kind: mt.kind, hints: kv(mapHints(e, mt.type)) });
    refOf.set(k, id);
    return id;
  };
  const typeOfRef = (id: string) => { const m = mentions.find((x) => x.ref === id)!; return m.type === "candidate" ? m.type_parent : m.type; };
  const lines = new Set<string>([`${p.source} · ${p.capability} · ${input}${p.note ? ` · note: ${p.note}` : ""}`]);
  const relations: Rel[] = [];
  const attributes: Attr[] = [];
  const base = { attributed_to: "", confidence: 1, attribute_class: "public" as const };

  const pushRel = (subj: string, predicate: string, obj: string, quote: string, time: TimeOut, qualifiers: Record<string, string>, m: PredMap, original: string) => {
    let predEmit = m.predicate, label = "", parent = "";
    if (m.parent || !reg.extractablePredicates.includes(m.predicate)) { predEmit = "candidate"; label = m.predicate; parent = m.parent ?? "associated_with"; }
    if (predEmit !== "candidate") {
      const v = reg.validateRelation(typeOfRef(subj), m.predicate, typeOfRef(obj));
      if (!v.ok) { predEmit = "candidate"; label = original; parent = "associated_with"; } // keep the fact, mark it as an unplaced candidate
    }
    relations.push({ subject: subj, predicate: predEmit, candidate_label: label, candidate_parent: parent, object: obj, qualifiers: kv(qualifiers), quote, ...base, ...time });
  };
  const pushAttr = (entityRef: string, key: string, value: string, quote: string, at?: string, datatypeHint?: Attr["datatype"]) => {
    const spec = KEY[key];
    const k = spec?.key ?? key, parent = spec?.parent ?? (reg.attributeKeys[k] ? "" : "description");
    const datatype: Attr["datatype"] = spec?.datatype ?? (reg.attributeKeys[k]?.datatype as Attr["datatype"] | undefined) ?? datatypeHint ?? (looksDate(value) ? "date" : looksUrl(value) ? "url" : looksNumber(value) ? "number" : "string");
    const time: TimeOut = at ? { ...NO_TIME, temporal_kind: "snapshot", date: at, time_qualifier: "exact" } : NO_TIME;
    attributes.push({ entity: entityRef, key: k, key_parent: parent, value, datatype, quote, ...base, ...time });
  };

  for (const e of r.edges) {
    const quote = renderEdge(e); lines.add(quote);
    const time = timeOf(e);
    const quals: Record<string, string> = { ...(e.qualifiers ?? {}) };
    if (e.value != null) quals.value = e.value;
    const attrKey = AS_ATTRIBUTE[e.predicate];
    if (attrKey) { pushAttr(ref(e.subject), attrKey, e.object, quote, e.at ?? e.from); continue; }
    if (PLACE_PREDS.has(e.predicate)) {
      const sRef = ref(e.subject), oRef = ref(e.object, { type: "place", kind: e.predicate === "located_in_country" ? "country" : e.predicate === "born_in" || e.predicate === "resides_in" ? "city" : "city" });
      pushRel(sRef, "located_in", oRef, quote, time, { ...quals, kind: e.predicate }, { predicate: "located_in" }, e.predicate); continue;
    }
    const m: PredMap = e.predicate === "officer_of" ? officerPred(e.qualifiers?.role) : PRED[e.predicate] ?? { predicate: e.predicate, parent: "associated_with" };
    const sRef = ref(e.subject), oRef = ref(e.object, m.objectType);
    const [a, b] = m.swap ? [oRef, sRef] : [sRef, oRef];
    pushRel(a, m.predicate, b, quote, time, { ...(m.qualifiers ?? {}), ...quals }, m, e.predicate);
  }
  for (const a of r.attributes) {
    const quote = renderAttr(a); lines.add(quote);
    const eRef = ref(a.entity);
    if (REGISTRY_ID_KEYS.has(a.key)) { pushAttr(eRef, "registry_id", `${a.key.replace(/_number$/, "").replace(/^lei_code$/, "lei").replace(/^irs_ein$/, "ein")}:${a.value}`, quote, a.at); continue; }
    if (PLACE_KEYS.has(a.key)) {
      const pRef = ref(a.value, { type: "place", kind: a.key === "country_of_residence" ? "country" : "address" });
      pushRel(eRef, "located_in", pRef, quote, a.at ? { ...NO_TIME, temporal_kind: "snapshot", date: a.at, time_qualifier: "exact" } : NO_TIME, { kind: a.key }, { predicate: "located_in" }, a.key); continue;
    }
    const acct = ACCOUNT_KEYS[a.key];
    if (acct) {
      const aRef = ref(a.value, { type: "account", kind: acct });
      const am = mentions.find((x) => x.ref === aRef)!; if (!am.hints.some((h) => h.key === "identifier")) am.hints.push({ key: "identifier", value: a.value });
      if (a.key !== "email") am.hints.push({ key: "platform", value: a.key.replace(/_.*$/, "") });
      pushRel(eRef, "uses_account", aRef, quote, NO_TIME, { platform: a.key === "email" ? "email" : a.key.replace(/_.*$/, "") }, { predicate: "uses_account" }, a.key); continue;
    }
    if (a.key === "sanctions_target") { pushAttr(eRef, "status", "sanctioned", quote, a.at); continue; }
    pushAttr(eRef, a.key, a.value, quote, a.at);
  }
  // entities that carry facts only via hints (e.g. a lone profile) still deserve a mention
  for (const e of r.entities) ref(e.name);

  const output: Out = { mentions, relations, attributes, page: { published_at: p.fetched_at.slice(0, 10), summary: `${p.capability} on ${input}`, publisher_name: p.source, publisher_kind: PUBLISHER_KIND[p.grade] ?? "unknown" } };
  return { output, text: [...lines].join("\n"), title: `${p.source}: ${input}` };
}

/** display-only mapping of the adapter's grade onto the publisher ladder; the tier itself comes from the source row */
export const PUBLISHER_KIND: Record<string, string> = { A: "authority", B: "independent", C: "platform", low: "anonymous" };
/** the Admiralty letter a capability source is filed under (override tier on its source row) */
export const GRADE_TIER: Record<string, string> = { A: "A", B: "B", C: "C", low: "E" };
