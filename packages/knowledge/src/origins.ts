// Origin clustering: claims that assert the same fact from near-duplicate passages, or from sources in the
// same family, share one origin. Independent sources for a fact = number of distinct origin clusters.
// Pure function over in-memory rows; the DB glue lives in ./clusterDb.ts.

export interface ClaimForClustering {
  id: string;            // uuidv7 — the smallest id in a cluster becomes the cluster id
  fact_key: string;      // what the claim asserts, normalized (kind|subject|predicate|object or kind|entity|key|value)
  source_id: string;
  family_id: string | null;
  passage: string;       // normalized passage around the quote
}

export interface ClusterOptions { jaccard?: number; shingle?: number }

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function shingles(text: string, k = 5): Set<string> {
  const toks = normalize(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (toks.length < k) { if (toks.length) out.add(toks.join(" ")); return out; }
  for (let i = 0; i + k <= toks.length; i++) out.add(toks.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Returns claim id → origin cluster id. Claims with the same fact_key are compared pairwise. */
export function clusterOrigins(claims: ClaimForClustering[], opts: ClusterOptions = {}): Map<string, string> {
  const threshold = opts.jaccard ?? 0.6;
  const k = opts.shingle ?? 5;
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra === rb) return; parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  for (const c of claims) parent.set(c.id, c.id);

  const groups = new Map<string, ClaimForClustering[]>();
  for (const c of claims) { const g = groups.get(c.fact_key) ?? []; g.push(c); groups.set(c.fact_key, g); }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sh = new Map(group.map((c) => [c.id, shingles(c.passage, k)]));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!, b = group[j]!;
        if (a.source_id === b.source_id) { union(a.id, b.id); continue; }                 // same page = same origin
        if (a.family_id && a.family_id === b.family_id) { union(a.id, b.id); continue; }   // same family = one source
        if (jaccard(sh.get(a.id)!, sh.get(b.id)!) >= threshold) union(a.id, b.id);          // copied passage
      }
    }
  }
  const out = new Map<string, string>();
  for (const c of claims) out.set(c.id, find(c.id));
  return out;
}

/** Number of independent origins per fact_key. */
export function independentOrigins(claims: ClaimForClustering[], assignment: Map<string, string>): Map<string, number> {
  const per = new Map<string, Set<string>>();
  for (const c of claims) { const s = per.get(c.fact_key) ?? new Set(); s.add(assignment.get(c.id)!); per.set(c.fact_key, s); }
  return new Map([...per].map(([k, s]) => [k, s.size]));
}
