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
