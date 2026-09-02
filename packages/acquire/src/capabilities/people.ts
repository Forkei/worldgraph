// Cluster B — People / Email capabilities. Each is a pure runner (fetch + parse) split so the parse half is
// unit-tested against real captured responses. Endpoints, grades and caveats: research/17 §Cluster B. The
// correlation cluster: a name/email/username fans out into a person's whole footprint. Runners are pure and
// self-rate-limited; caching is orchestrated by the caller. Keys (Hunter, HIBP) are read from process.env
// directly since core/config only exposes the base set.
import { createHash } from "node:crypto";
import { getJson, getJsonOrNull, getText } from "./http.ts";
import { type CapabilityResult, type CapProvenance, type CapPivot, type GatedCapability, dedupePivots, emptyResult } from "./types.ts";

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// B3. Gravatar — the one keyless email → identity link
// ---------------------------------------------------------------------------
interface GravatarResponse { entry?: { displayName?: string; aboutMe?: string; currentLocation?: string; accounts?: { shortname?: string; url?: string; username?: string }[]; urls?: { value?: string; title?: string }[] }[] }

export function parseGravatar(j: GravatarResponse | null, email: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.gravatar", source: "Gravatar", fetched_at: now(), grade: "B", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  const e = j?.entry?.[0];
  if (!e) { prov.note = "no public Gravatar for this email"; return r; }
  const name = e.displayName?.trim();
  if (name) { r.entities.push({ type: "person", name, hints: { email } }); r.attributes.push({ entity: name, key: "email", value: email }); }
  const subject = name ?? email;
  if (e.currentLocation) r.attributes.push({ entity: subject, key: "location", value: e.currentLocation });
  if (e.aboutMe) r.attributes.push({ entity: subject, key: "description", value: e.aboutMe.slice(0, 300) });
  for (const acc of e.accounts ?? []) {
    const handle = acc.username ?? acc.shortname;
    if (handle) { r.edges.push({ subject, predicate: "uses_account", object: handle, qualifiers: acc.shortname ? { platform: acc.shortname } : undefined }); r.pivots.push({ kind: "username", value: handle }); }
    if (acc.url) r.pivots.push({ kind: "url", value: acc.url });
  }
  for (const u of e.urls ?? []) if (u.value) r.pivots.push({ kind: "url", value: u.value });
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function gravatar(email: string): Promise<CapabilityResult> {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  const url = `https://gravatar.com/${hash}.json`;
  const j = await getJsonOrNull<GravatarResponse>(url, { rateKey: "gravatar.com", minIntervalMs: 500 });
  const r = parseGravatar(j, email);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// B6. Political donations (FEC) — public PII: employer, occupation, location, amounts
// ---------------------------------------------------------------------------
interface FecResponse { results?: { contributor_name?: string; contributor_employer?: string; contributor_occupation?: string; contributor_city?: string; contributor_state?: string; contribution_receipt_amount?: number; contribution_receipt_date?: string; committee?: { name?: string } }[] }

export function parseFec(j: FecResponse, name: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.fec", source: "FEC", fetched_at: now(), grade: "A", tier: "easy", note: "US-only public record; DEMO_KEY is heavily rate-limited — use an api.data.gov key. Disambiguate by employer/city." };
  const r = emptyResult(prov);
  r.raw = j;
  const results = j.results ?? [];
  if (results.length) r.entities.push({ type: "person", name });
  const seenEmployer = new Set<string>(), seenOcc = new Set<string>(), seenLoc = new Set<string>();
  for (const d of results) {
    const committee = d.committee?.name;
    if (committee) r.edges.push({ subject: name, predicate: "donated_to", object: committee, at: d.contribution_receipt_date ?? undefined, value: d.contribution_receipt_amount != null ? String(d.contribution_receipt_amount) : undefined });
    if (d.contributor_employer && !seenEmployer.has(d.contributor_employer)) { seenEmployer.add(d.contributor_employer); r.attributes.push({ entity: name, key: "employer", value: d.contributor_employer }); r.edges.push({ subject: name, predicate: "works_at", object: d.contributor_employer }); }
    if (d.contributor_occupation && !seenOcc.has(d.contributor_occupation)) { seenOcc.add(d.contributor_occupation); r.attributes.push({ entity: name, key: "occupation", value: d.contributor_occupation }); }
    const loc = [d.contributor_city, d.contributor_state].filter(Boolean).join(", ");
    if (loc && !seenLoc.has(loc)) { seenLoc.add(loc); r.attributes.push({ entity: name, key: "location", value: loc }); }
  }
  return r;
}

export async function fecDonations(name: string): Promise<CapabilityResult> {
  const key = process.env.FEC_API_KEY || "DEMO_KEY";
  const url = `https://api.open.fec.gov/v1/schedules/schedule_a/?contributor_name=${encodeURIComponent(name)}&per_page=50&sort=-contribution_receipt_date&api_key=${key}`;
  const j = await getJson<FecResponse>(url, { rateKey: "api.open.fec.gov", minIntervalMs: 2000 });
  const r = parseFec(j, name);
  r.provenance.url = `https://api.open.fec.gov/v1/schedules/schedule_a/?contributor_name=${encodeURIComponent(name)}`;
  return r;
}

// ---------------------------------------------------------------------------
// B7. Academic footprint (OpenAlex) — works, coauthors, affiliations
// ---------------------------------------------------------------------------
interface OpenAlexResponse { results?: { display_name?: string; works_count?: number; cited_by_count?: number; orcid?: string | null; last_known_institutions?: { display_name?: string }[]; x_concepts?: { display_name?: string; score?: number }[] }[] }

export function parseOpenAlex(j: OpenAlexResponse, name: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.academic", source: "OpenAlex", fetched_at: now(), grade: "A", tier: "easy", note: "name-match; disambiguate by ORCID/institution before trusting" };
  const r = emptyResult(prov);
  r.raw = j;
  const a = j.results?.[0];
  if (!a?.display_name) { prov.note = "no OpenAlex author matched"; return r; }
  const subject = a.display_name;
  r.entities.push({ type: "person", name: subject });
  if (a.works_count != null) r.attributes.push({ entity: subject, key: "works_count", value: String(a.works_count) });
  if (a.cited_by_count != null) r.attributes.push({ entity: subject, key: "cited_by_count", value: String(a.cited_by_count) });
  if (a.orcid) r.attributes.push({ entity: subject, key: "orcid", value: a.orcid.replace(/^https?:\/\/orcid\.org\//, "") });
  for (const inst of a.last_known_institutions ?? []) if (inst.display_name) { r.entities.push({ type: "organization", kind: "school", name: inst.display_name }); r.edges.push({ subject, predicate: "affiliated_with", object: inst.display_name }); }
  for (const c of (a.x_concepts ?? []).filter((x) => (x.score ?? 0) >= 40).slice(0, 5)) if (c.display_name) r.attributes.push({ entity: subject, key: "research_topic", value: c.display_name });
  return r;
}

export async function academic(name: string): Promise<CapabilityResult> {
  // the polite-pool email speeds OpenAlex and is good manners; harmless if absent
  const mailto = process.env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(process.env.OPENALEX_MAILTO)}` : "";
  const url = `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=5${mailto}`;
  const j = await getJson<OpenAlexResponse>(url, { rateKey: "api.openalex.org", minIntervalMs: 500 });
  const r = parseOpenAlex(j, name);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// B5. Username → account fan-out (WhatsMyName, native)
// ---------------------------------------------------------------------------
export interface WmnSite { name: string; uri_check: string; e_code?: number; e_string?: string; m_string?: string; m_code?: number; cat?: string; }

/** Apply WhatsMyName detection rules: an account EXISTS when status==e_code and e_string is in the body; it is
 *  MISSING when status==m_code and m_string is in the body; otherwise the result is unknown. Pure + tested. */
export function checkSite(site: WmnSite, status: number, body: string): "exists" | "missing" | "unknown" {
  const existMatch = site.e_code === status && (site.e_string == null || body.includes(site.e_string));
  const missMatch = site.m_code === status && (site.m_string == null || body.includes(site.m_string));
  if (existMatch && !missMatch) return "exists";
  if (missMatch) return "missing";
  return "unknown";
}

let wmnCache: WmnSite[] | null = null;
const WMN_URL = "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";
async function loadWmnSites(): Promise<WmnSite[]> {
  if (wmnCache) return wmnCache;
  const j = await getJson<{ sites: WmnSite[] }>(WMN_URL, { rateKey: "raw.githubusercontent.com", minIntervalMs: 500, timeoutMs: 20_000 });
  wmnCache = j.sites ?? [];
  return wmnCache;
}

/** Bounded-concurrency map with per-task jitter — keeps the probe polite and hard to fingerprint. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await sleep(50 + Math.random() * 150);
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function usernameAccounts(username: string, opts: { concurrency?: number; cats?: string[] } = {}): Promise<CapabilityResult> {
  const prov: CapProvenance = { capability: "people.username", source: "WhatsMyName", fetched_at: now(), grade: "C", tier: "normal", note: "automated profile probing (grey-ToS): throttled, existence is inference — a matched profile upgrades to its publisher's grade once scraped" };
  const r = emptyResult(prov);
  let sites = await loadWmnSites();
  if (opts.cats?.length) sites = sites.filter((s) => opts.cats!.includes(s.cat ?? ""));
  const hits = await pool(sites, opts.concurrency ?? 12, async (site) => {
    const target = site.uri_check.replace(/\{account\}/g, encodeURIComponent(username));
    try {
      const body = await getText(target, { rateKey: new URL(target).host, minIntervalMs: 0, timeoutMs: 12_000 });
      return { site, url: target, verdict: checkSite(site, 200, body) };
    } catch (e) {
      // a 404 (thrown by http helper) is the common "missing" signal; anything else is unknown
      const status = Number(String((e as Error).message).match(/\s(\d{3}):/)?.[1] ?? 0);
      return { site, url: target, verdict: status ? checkSite(site, status, "") : "unknown" as const };
    }
  });
  for (const h of hits) {
    if (h.verdict !== "exists") continue;
    r.edges.push({ subject: username, predicate: "has_account_on", object: h.site.name, qualifiers: h.site.cat ? { category: h.site.cat } : undefined });
    r.pivots.push({ kind: "url", value: h.url, weak: true });
  }
  r.attributes.push({ entity: username, key: "sites_checked", value: String(sites.length) });
  r.pivots = dedupePivots(r.pivots);
  return r;
}

// ---------------------------------------------------------------------------
// B1. Email → breach appearance (HIBP) — catalog keyless; account check needs key. Appearance only, never dumps.
// ---------------------------------------------------------------------------
interface HibpBreach { Name?: string; Title?: string; Domain?: string; BreachDate?: string; PwnCount?: number; Description?: string }

export function parseHibpAccount(breaches: HibpBreach[], email: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.breach", source: "HaveIBeenPwned", fetched_at: now(), grade: "B", tier: "normal", note: "appearance only — the breach dump is never touched" };
  const r = emptyResult(prov);
  r.raw = breaches;
  r.entities.push({ type: "email", name: email });
  for (const b of breaches) {
    const svc = b.Domain || b.Name || b.Title;
    if (!svc) continue;
    r.edges.push({ subject: email, predicate: "breached_in", object: svc, at: b.BreachDate ?? undefined });
    if (b.Domain) r.pivots.push({ kind: "domain", value: b.Domain, weak: true });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

/** Keyless catalog of all known breaches — describes any breach without an account key. */
export async function hibpCatalog(): Promise<CapabilityResult> {
  const url = "https://haveibeenpwned.com/api/v3/breaches";
  const breaches = await getJson<HibpBreach[]>(url, { rateKey: "haveibeenpwned.com", minIntervalMs: 2000 });
  const prov: CapProvenance = { capability: "people.breach", source: "HaveIBeenPwned (catalog)", fetched_at: now(), url, grade: "B", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = breaches;
  r.attributes.push({ entity: "(catalog)", key: "breaches_known", value: String(breaches.length) });
  return r;
}

/** Email → the breaches it appears in. Requires HIBP_API_KEY (paid). */
export async function hibpAccount(email: string): Promise<CapabilityResult> {
  const key = process.env.HIBP_API_KEY;
  if (!key) throw new Error("people.breach account check needs HIBP_API_KEY (paid, $4.39/mo) — the keyless catalog is hibpCatalog()");
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  const breaches = (await getJsonOrNull<HibpBreach[]>(url, { rateKey: "haveibeenpwned.com", minIntervalMs: 2000, headers: { "hibp-api-key": key } })) ?? [];
  const r = parseHibpAccount(breaches, email);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// B4. Domain → corporate emails + pattern (Hunter) — needs a free key
// ---------------------------------------------------------------------------
interface HunterResponse { data?: { pattern?: string; organization?: string; emails?: { value?: string; first_name?: string; last_name?: string; position?: string }[] } }

export function parseHunter(j: HunterResponse, domain: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.email_pattern", source: "Hunter.io", fetched_at: now(), grade: "B", tier: "normal" };
  const r = emptyResult(prov);
  r.raw = j;
  const d = j.data ?? {};
  if (d.pattern) r.attributes.push({ entity: domain, key: "email_pattern", value: d.pattern });
  const org = d.organization ?? domain;
  for (const e of d.emails ?? []) {
    if (!e.value) continue;
    r.entities.push({ type: "email", name: e.value });
    r.pivots.push({ kind: "email", value: e.value });
    const person = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
    if (person) {
      r.entities.push({ type: "person", name: person, hints: { email: e.value } });
      r.edges.push({ subject: person, predicate: "works_at", object: org });
      r.pivots.push({ kind: "name", value: person });
      if (e.position) r.attributes.push({ entity: person, key: "occupation", value: e.position });
    }
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function hunter(domain: string): Promise<CapabilityResult> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error("people.email_pattern needs HUNTER_API_KEY (free tier: 25/mo)");
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${key}`;
  const j = await getJson<HunterResponse>(url, { rateKey: "api.hunter.io", minIntervalMs: 1500 });
  const r = parseHunter(j, domain);
  r.provenance.url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}`;
  return r;
}

// ---------------------------------------------------------------------------
// B9. Relatives / genealogy (WikiTree) — public trees
// ---------------------------------------------------------------------------
// WikiTree getProfiles returns [{ profiles: { <id>: { Name, RealName, LastNameAtBirth, Father, Mother, Spouses, Children } } }].
// The exact shape varies by fields requested; we parse a normalized subset and note the assumption.
interface WikitreePerson { Name?: string; RealName?: string; BirthNamePrivate?: string; Spouses?: Record<string, { RealName?: string; BirthName?: string }>; Children?: Record<string, { RealName?: string; BirthName?: string }>; Father?: number; Mother?: number }
interface WikitreeResponse { 0?: { profiles?: Record<string, WikitreePerson> } }
const wtName = (p: { RealName?: string; BirthName?: string } | WikitreePerson): string | undefined => (p as WikitreePerson).RealName ?? (p as { BirthName?: string }).BirthName ?? (p as WikitreePerson).BirthNamePrivate;

export function parseWikitree(j: WikitreeResponse, name: string): CapabilityResult {
  const prov: CapProvenance = { capability: "people.relatives", source: "WikiTree", fetched_at: now(), grade: "C", tier: "normal", note: "user-contributed public trees; response shape assumed (getProfiles) — verify before trusting" };
  const r = emptyResult(prov);
  r.raw = j;
  const profiles = j[0]?.profiles ?? {};
  const person = Object.values(profiles)[0];
  if (!person) { prov.note = "no WikiTree profile matched"; return r; }
  const subject = wtName(person) ?? name;
  r.entities.push({ type: "person", name: subject });
  for (const sp of Object.values(person.Spouses ?? {})) { const n = wtName(sp); if (n) { r.edges.push({ subject, predicate: "spouse_of", object: n }); r.entities.push({ type: "person", name: n }); r.pivots.push({ kind: "name", value: n }); } }
  for (const ch of Object.values(person.Children ?? {})) { const n = wtName(ch); if (n) { r.edges.push({ subject, predicate: "parent_of", object: n }); r.entities.push({ type: "person", name: n }); r.pivots.push({ kind: "name", value: n }); } }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function relatives(name: string): Promise<CapabilityResult> {
  const url = `https://api.wikitree.com/api.php?action=getProfiles&keyPairs=${encodeURIComponent(name)}&fields=Name,RealName,Spouses,Children,Father,Mother&format=json`;
  const j = await getJson<WikitreeResponse>(url, { rateKey: "api.wikitree.com", minIntervalMs: 1500 });
  const r = parseWikitree(j, name);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// Restricted / darker (reading-data-only, gated) — registered for later wiring, not called live here.
// ---------------------------------------------------------------------------
export const GATED_PEOPLE: GatedCapability[] = [
  { id: "people.broker", source: "TruePeopleSearch/Spokeo/BeenVerified", consumes: "name|phone|email", emits: "address,relatives,age,past_addresses", grade: "C", tier: "spicy", gated: true, note: "FCRA/GLBA/DPPA-restricted — lawful only for permitted purposes; gate on purpose+jurisdiction" },
  { id: "people.breach_records", source: "DeHashed/IntelX/Snusbase", consumes: "email|username", emits: "breach_records", grade: "C", tier: "spicy", gated: true, note: "query service, returns records (darker than HIBP appearance); still never raw-dump hosting" },
  { id: "people.enrichment", source: "PeopleDataLabs/FullContact", consumes: "email|name|phone", emits: "unified_profile", grade: "C", tier: "spicy", gated: true, note: "restricted enrichment; keyed" },
];
