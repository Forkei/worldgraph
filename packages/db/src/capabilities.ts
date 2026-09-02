// Capability registry access + source cache. The rows are the truth about cost/tier/cache/requires; the code
// that runs a capability lives in acquire/. Seeding is idempotent (ON CONFLICT DO UPDATE on the stable spec).
import { query } from "./client.ts";

export interface CapabilityRow {
  id: string; kind: string; inputs: string[]; outputs: string[]; cost_usd: number; cost_seconds: number;
  tier: string; cache_ttl: string | null; requires: Record<string, string>; enabled: boolean; added_by: string;
  spec: Record<string, unknown>; yield_hits: number; yield_runs: number;
}

const SEED: Omit<CapabilityRow, "yield_hits" | "yield_runs">[] = [
  { id: "fetch.page", kind: "fetch", inputs: ["url"], outputs: ["*"], cost_usd: 0, cost_seconds: 8, tier: "L0", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: {} },
  { id: "search.serpapi.google", kind: "search", inputs: ["query"], outputs: ["url"], cost_usd: 0.01, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: { key: "SERPAPI_KEY" }, enabled: true, added_by: "hand", spec: {} },
  { id: "search.exa", kind: "search", inputs: ["query"], outputs: ["url"], cost_usd: 0.005, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: { key: "EXA_API_KEY" }, enabled: true, added_by: "hand", spec: {} },

  // Cluster A — Domain / Infrastructure (research/17 §A). All keyless (L0); code in acquire/capabilities/domain.ts.
  { id: "infra.rdap", kind: "pivot", inputs: ["domain"], outputs: ["registrar", "registration_date", "nameserver"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "RDAP" } },
  { id: "infra.dns", kind: "pivot", inputs: ["domain", "hostname"], outputs: ["ip", "mail_provider", "service"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "6 hours", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "Google DoH" } },
  { id: "infra.cert_transparency", kind: "pivot", inputs: ["domain"], outputs: ["hostname"], cost_usd: 0, cost_seconds: 4, tier: "L0", cache_ttl: "1 day", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "certSpotter (crt.sh fallback)" } },
  { id: "infra.wayback", kind: "pivot", inputs: ["domain", "url"], outputs: ["url", "first_archived"], cost_usd: 0, cost_seconds: 4, tier: "L0", cache_ttl: "1 day", requires: {}, enabled: true, added_by: "hand", spec: { grade: "B", tier: "easy", source: "Wayback CDX" } },
  { id: "infra.urlscan", kind: "pivot", inputs: ["domain", "url"], outputs: ["ip", "contacted_domain"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "12 hours", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "urlscan.io (search)" } },
  { id: "infra.reverse_ip", kind: "pivot", inputs: ["ip"], outputs: ["domain"], cost_usd: 0, cost_seconds: 2, tier: "L2", cache_ttl: "1 day", requires: {}, enabled: true, added_by: "hand", spec: { grade: "C", tier: "normal", source: "HackerTarget", note: "CDN-gated; weak" } },
  { id: "infra.asn", kind: "pivot", inputs: ["ip"], outputs: ["asn", "is_cdn"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "BGPView" } },
  { id: "infra.web_primitives", kind: "pivot", inputs: ["domain"], outputs: ["url", "email"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "1 day", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "robots/sitemap/security.txt" } },

  // Cluster B — People / Email (research/17 §B). Code in acquire/capabilities/people.ts.
  { id: "people.gravatar", kind: "pivot", inputs: ["email"], outputs: ["name", "username", "url"], cost_usd: 0, cost_seconds: 1, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "B", tier: "easy", source: "Gravatar" } },
  { id: "people.fec", kind: "pivot", inputs: ["name"], outputs: ["donated_to", "employer", "location"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "FEC (DEMO_KEY; set FEC_API_KEY to lift rate limit)" } },
  { id: "people.academic", kind: "pivot", inputs: ["name"], outputs: ["affiliated_with", "coauthor", "topic"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "14 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "OpenAlex / ORCID" } },
  { id: "people.username", kind: "pivot", inputs: ["username"], outputs: ["has_account_on", "url"], cost_usd: 0, cost_seconds: 20, tier: "L2", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "C", tier: "normal", source: "WhatsMyName (716 sites)", note: "grey-ToS; throttled" } },
  { id: "people.breach", kind: "pivot", inputs: ["email"], outputs: ["breached_in"], cost_usd: 0, cost_seconds: 2, tier: "L1", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "B", tier: "easy", source: "HIBP", note: "catalog keyless; email account-check needs HIBP_API_KEY (appearance only, never dumps)" } },
  { id: "people.email_pattern", kind: "pivot", inputs: ["domain"], outputs: ["email", "email_pattern"], cost_usd: 0, cost_seconds: 2, tier: "L1", cache_ttl: "30 days", requires: { key: "HUNTER_API_KEY" }, enabled: true, added_by: "hand", spec: { grade: "B", tier: "normal", source: "Hunter.io" } },
  { id: "people.relatives", kind: "pivot", inputs: ["name"], outputs: ["parent_of", "spouse_of"], cost_usd: 0, cost_seconds: 2, tier: "L1", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "C", tier: "normal", source: "WikiTree", note: "response shape assumed — verify live" } },

  // Cluster C — Media / Geo (research/17 §C). Code in acquire/capabilities/media.ts.
  { id: "media.exif", kind: "tool", inputs: ["image"], outputs: ["coordinates", "taken_at", "device"], cost_usd: 0, cost_seconds: 1, tier: "L0", cache_ttl: null, requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "ExifTool", note: "needs the exiftool binary on PATH" } },
  { id: "media.reverse_image", kind: "pivot", inputs: ["image"], outputs: ["appears_on", "url"], cost_usd: 0.01, cost_seconds: 3, tier: "L0", cache_ttl: "7 days", requires: { key: "SERPAPI_KEY" }, enabled: true, added_by: "hand", spec: { grade: "B", tier: "easy", source: "SerpAPI (Lens/Yandex/Bing)" } },
  { id: "geo.geocode", kind: "pivot", inputs: ["address", "place"], outputs: ["coordinates"], cost_usd: 0, cost_seconds: 1, tier: "L0", cache_ttl: "365 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "Nominatim" } },
  { id: "geo.map", kind: "pivot", inputs: ["coordinates"], outputs: ["place"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "Overpass / OSM" } },
  { id: "geo.chronolocation", kind: "pivot", inputs: ["coordinates"], outputs: ["corroboration"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "365 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "SunCalc + Open-Meteo" } },
  { id: "geo.aircraft", kind: "pivot", inputs: ["coordinates"], outputs: ["aircraft"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "1 hour", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "OpenSky", note: "heavily rate-limited" } },

  // Cluster D — Organizations (research/17 §D). Code in acquire/capabilities/org.ts.
  { id: "org.edgar", kind: "pivot", inputs: ["org"], outputs: ["filed", "formerly_known_as", "industry", "domain"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "SEC EDGAR", note: "set SEC_CONTACT_EMAIL for the required User-Agent" } },
  { id: "org.gleif", kind: "pivot", inputs: ["org"], outputs: ["subsidiary_of", "lei", "jurisdiction"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "GLEIF" } },
  { id: "org.wikidata", kind: "pivot", inputs: ["org", "name"], outputs: ["founded_by", "led_by", "subsidiary_of", "works_at", "domain"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "14 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "B", tier: "easy", source: "Wikidata", note: "crowd-sourced; referenced but open-edit" } },
  { id: "org.nonprofit", kind: "pivot", inputs: ["org"], outputs: ["ein", "revenue", "tax_status"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "ProPublica Nonprofit Explorer (IRS 990)" } },
  { id: "org.usaspending", kind: "pivot", inputs: ["org"], outputs: ["awarded_contract_by", "holds_contract"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "30 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "USAspending.gov" } },
  { id: "org.court", kind: "pivot", inputs: ["org", "name"], outputs: ["party_to", "co_litigant"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "7 days", requires: {}, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "CourtListener", note: "name-matched; COURTLISTENER_TOKEN lifts limits" } },
  { id: "org.companies_house", kind: "pivot", inputs: ["org"], outputs: ["officer_of", "controls", "formerly_known_as"], cost_usd: 0, cost_seconds: 2, tier: "L0", cache_ttl: "7 days", requires: { key: "COMPANIES_HOUSE_API_KEY" }, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "Companies House (UK)" } },
  { id: "org.opencorporates", kind: "pivot", inputs: ["org", "name"], outputs: ["officer_of", "formerly_known_as"], cost_usd: 0, cost_seconds: 3, tier: "L0", cache_ttl: "7 days", requires: { key: "OPENCORPORATES_API_TOKEN" }, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "OpenCorporates", note: "officer reverse-search (--mode officer) is the shell-network pivot" } },
  { id: "org.sanctions", kind: "pivot", inputs: ["org", "name"], outputs: ["listed_in", "risk_topic"], cost_usd: 0, cost_seconds: 1, tier: "L0", cache_ttl: "1 day", requires: { key: "OPENSANCTIONS_API_KEY" }, enabled: true, added_by: "hand", spec: { grade: "A", tier: "easy", source: "OpenSanctions", note: "PEP/sanctions screening; hit = lead to confirm" } },
];

/** Insert/update the built-in capability rows; disable those whose required env key is absent. */
export async function syncCapabilities(hasKey: (name: string) => boolean): Promise<number> {
  for (const c of SEED) {
    const enabled = !c.requires.key || hasKey(c.requires.key);
    await query(
      `INSERT INTO capabilities (id, kind, inputs, outputs, cost_usd, cost_seconds, tier, cache_ttl, requires, enabled, added_by, spec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::interval,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, inputs=EXCLUDED.inputs, outputs=EXCLUDED.outputs, cost_usd=EXCLUDED.cost_usd,
         cost_seconds=EXCLUDED.cost_seconds, tier=EXCLUDED.tier, cache_ttl=EXCLUDED.cache_ttl, requires=EXCLUDED.requires,
         enabled=EXCLUDED.enabled, spec=EXCLUDED.spec`,
      [c.id, c.kind, c.inputs, c.outputs, c.cost_usd, c.cost_seconds, c.tier, c.cache_ttl, JSON.stringify(c.requires), enabled, c.added_by, JSON.stringify(c.spec)],
    );
  }
  return SEED.length;
}

export async function listCapabilities(): Promise<CapabilityRow[]> {
  return query<CapabilityRow>(`SELECT * FROM capabilities ORDER BY kind, id`);
}

export async function getCachedSearch(cacheKey: string): Promise<{ result: unknown; fetched_at: Date } | null> {
  const rows = await query<{ result: unknown; fetched_at: Date }>(`SELECT result, fetched_at FROM source_cache WHERE cache_key=$1 AND (expires_at IS NULL OR expires_at > now())`, [cacheKey]);
  return rows[0] ?? null;
}

export async function putCachedSearch(cacheKey: string, capabilityId: string, inputsNorm: unknown, result: unknown, ttlText: string | null): Promise<void> {
  await query(
    `INSERT INTO source_cache (cache_key, capability_id, inputs_norm, result, expires_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END)
     ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result, fetched_at=now(), expires_at=EXCLUDED.expires_at`,
    [cacheKey, capabilityId, JSON.stringify(inputsNorm), JSON.stringify(result), ttlText],
  );
}
