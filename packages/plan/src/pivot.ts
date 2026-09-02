// The pivot engine (HANDOFF §4 B1): a typed value (domain / email / username / name / org / …) fans out to every
// enabled capability that consumes its kind; each result is written into the graph as claims (through the same
// buildClaims path page facts take, so they get resolved and graded exactly like page-extracted facts) and its
// emitted pivot-values re-enter the queue. Cache-first (source_cache, per-capability TTL), deduped per
// investigation via the actions log, bounded by depth (per kind), total runs and concurrency. Deterministic; no LLM.
import { uuidv7, type ExtractionOutput } from "@worldgraph/core";
import { query, listCapabilities, getCachedSearch, putCachedSearch, insertSource, findSourceByHash, insertClaimsBatch, updateSourceStatus, setSourcePublisher, type SourceRow, type CapabilityRow } from "@worldgraph/db";
import { buildClaims, promptVersion, type ExtractContext } from "@worldgraph/extract";
import { capabilityToExtraction, GRADE_TIER, runnersFor, sha256, type CapabilityResult, type CapPivot, type PivotKind, type CapRunner } from "@worldgraph/acquire";
import type { Graph } from "@worldgraph/knowledge";

export interface PivotSeed extends CapPivot { depth?: number; from?: string }
export interface PivotOpts {
  ctx: ExtractContext;
  /** how far a chain may go, per kind. Infra kinds chain deep (domain→hostname→ip→domain); people/org kinds are the sprawl risk and stop at 1 by default. */
  maxDepth?: Partial<Record<PivotKind, number>>;
  maxRuns?: number;
  concurrency?: number;
  /** restrict to these capability ids / skip these */
  only?: string[];
  skip?: string[];
  /** follow weak (CDN-derived) pivots too */
  includeWeak?: boolean;
  /** re-run even if this investigation already ran the capability on this value */
  refetch?: boolean;
  dry?: boolean;
  log?: (s: string) => void;
}
export interface PivotRun { capability: string; kind: PivotKind; value: string; depth: number; status: "ok" | "cached" | "empty" | "error" | "skipped" | "duplicate" | "dry"; claims: number; pivots: number; source_id?: string; ms: number; note?: string }
export interface PivotSummary { runs: PivotRun[]; claims: number; sources: number; discovered: PivotSeed[]; stopped?: string }

export const DEFAULT_DEPTH: Record<PivotKind, number> = { domain: 3, hostname: 2, ip: 2, asn: 1, email: 2, username: 1, phone: 1, name: 1, org: 1, url: 1, image: 1, coordinates: 1 };
const norm = (kind: PivotKind, v: string) => (kind === "name" || kind === "org" ? v.trim().replace(/\s+/g, " ") : kind === "username" ? v.trim().toLowerCase().replace(/^@/, "") : v.trim().toLowerCase());
export const cacheKeyFor = (cap: string, kind: PivotKind, value: string) => `${cap}|${kind}|${norm(kind, value).toLowerCase()}`;

/** Write one CapabilityResult into an investigation as a source + claims. Returns the source and how many claims landed. */
export async function ingestCapability(inv: string, ctx: ExtractContext, r: CapabilityResult, input: string): Promise<{ source: SourceRow; claims: number; status: "new" | "duplicate" }> {
  const { output, text, title } = capabilityToExtraction(r, input, ctx.registry);
  const hash = sha256(text);
  const dup = await findSourceByHash(inv, hash);
  if (dup) return { source: dup, claims: 0, status: "duplicate" }; // identical result already in this investigation
  const p = r.provenance;
  const url = p.url ?? `capability://${p.capability}/${encodeURIComponent(input)}`;
  const domain = (() => { try { return new URL(url).hostname; } catch { return p.capability; } })();
  const source = await insertSource({
    investigation_id: inv, url, final_url: url, domain, kind: "api", fetch_method: "connector", http_status: 200, content_hash: hash, blob_key: null, text, link_table: [],
    title, published_at: new Date(p.fetched_at), lang: null, status: "fetched", error: null,
    meta: { capability: p.capability, source: p.source, input, grade: p.grade, tier: p.tier, gated: !!p.gated, note: p.note ?? null, counts: { entities: r.entities.length, edges: r.edges.length, attributes: r.attributes.length, pivots: r.pivots.length } },
    tier: GRADE_TIER[p.grade] ?? "E", tier_kind: "capability", snapshot_key: null, captured_at: new Date(),
  });
  await setSourcePublisher(source.id, output.page.publisher_name, output.page.publisher_kind);
  const chunk = { index: 0, start: 0, end: text.length, text, hash };
  const { claims } = buildClaims({ ...ctx, model: { ...ctx.model, id: `capability:${p.capability}` } }, source, chunk, output as ExtractionOutput, promptVersion(ctx.registry), 0, new Set(), p.fetched_at.slice(0, 10));
  await insertClaimsBatch(claims);
  await updateSourceStatus(source.id, "extracted");
  return { source, claims: claims.filter((c) => c.status === "raw").length, status: "new" };
}

async function priorRuns(inv: string): Promise<Set<string>> {
  const rows = await query<{ dedupe_key: string }>(`SELECT dedupe_key FROM actions WHERE investigation_id=$1 AND kind='capability' AND state='done' AND dedupe_key IS NOT NULL`, [inv]);
  return new Set(rows.map((r) => r.dedupe_key));
}

/** Run the chain from a set of seed pivots. */
export async function runPivots(inv: string, seeds: PivotSeed[], opts: PivotOpts): Promise<PivotSummary> {
  const log = opts.log ?? (() => {});
  const maxDepth = { ...DEFAULT_DEPTH, ...(opts.maxDepth ?? {}) };
  const maxRuns = opts.maxRuns ?? 40, concurrency = opts.concurrency ?? 4;
  const caps = new Map<string, CapabilityRow>((await listCapabilities()).map((c) => [c.id, c]));
  const allowed = (r: CapRunner) => {
    const row = caps.get(r.id);
    if (!row?.enabled) return false;
    if (opts.only?.length && !opts.only.includes(r.id)) return false;
    if (opts.skip?.includes(r.id)) return false;
    return true;
  };
  const done = opts.refetch ? new Set<string>() : await priorRuns(inv);
  const seen = new Set<string>();
  const perCap = new Map<string, number>();
  const runs: PivotRun[] = [];
  const discovered: PivotSeed[] = [];
  let claimsTotal = 0, sourcesTotal = 0, launched = 0, stopped: string | undefined;

  type Job = { seed: PivotSeed; runner: CapRunner };
  let wave: PivotSeed[] = seeds.map((s) => ({ ...s, depth: s.depth ?? 0 })).filter((s) => { const k = `${s.kind}|${norm(s.kind, s.value)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  while (wave.length && !stopped) {
    const jobs: Job[] = [];
    for (const seed of wave) {
      if (seed.weak && !opts.includeWeak) continue;
      for (const runner of runnersFor(seed.kind)) {
        if (!allowed(runner)) continue;
        const key = `${runner.id}|${seed.kind}|${norm(seed.kind, seed.value)}`;
        if (done.has(key)) { runs.push({ capability: runner.id, kind: seed.kind, value: seed.value, depth: seed.depth!, status: "skipped", claims: 0, pivots: 0, ms: 0, note: "already run in this investigation" }); continue; }
        const n = perCap.get(runner.id) ?? 0;
        if (runner.maxPerRun && n >= runner.maxPerRun) { runs.push({ capability: runner.id, kind: seed.kind, value: seed.value, depth: seed.depth!, status: "skipped", claims: 0, pivots: 0, ms: 0, note: `per-run cap ${runner.maxPerRun}` }); continue; }
        perCap.set(runner.id, n + 1);
        done.add(key);
        jobs.push({ seed, runner });
      }
    }
    const next: PivotSeed[] = [];
    let i = 0;
    const worker = async () => {
      while (i < jobs.length && !stopped) {
        const job = jobs[i++]!;
        if (launched >= maxRuns) { stopped = `run budget ${maxRuns} reached`; break; }
        launched++;
        const { seed, runner } = job;
        const t0 = Date.now();
        const run: PivotRun = { capability: runner.id, kind: seed.kind, value: seed.value, depth: seed.depth!, status: "ok", claims: 0, pivots: 0, ms: 0 };
        runs.push(run);
        if (opts.dry) { run.status = "dry"; continue; }
        try {
          const ck = cacheKeyFor(runner.id, seed.kind, seed.value);
          let result: CapabilityResult | null = null;
          const cached = opts.refetch ? null : await getCachedSearch(ck);   // --refetch bypasses the cache too, not just the run log
          if (cached) { result = cached.result as CapabilityResult; run.status = "cached"; }
          else {
            result = await runner.run([seed.value], seed.kind);
            const ttl = caps.get(runner.id)?.cache_ttl ?? "7 days";
            await putCachedSearch(ck, runner.id, { kind: seed.kind, value: seed.value }, { ...result, raw: undefined }, typeof ttl === "string" ? ttl : "7 days");
          }
          const facts = result.entities.length + result.edges.length + result.attributes.length;
          if (!facts) run.status = "empty";
          else {
            const ing = await ingestCapability(inv, opts.ctx, result, seed.value);
            run.source_id = ing.source.id; run.claims = ing.claims;
            if (ing.status === "duplicate") run.status = "duplicate"; else { sourcesTotal++; claimsTotal += ing.claims; }
          }
          run.note = result.provenance.note;
          const depth = seed.depth! + 1;
          for (const pv of result.pivots) {
            const k = `${pv.kind}|${norm(pv.kind, pv.value)}`;
            if (seen.has(k)) continue;
            seen.add(k);
            run.pivots++;
            const s: PivotSeed = { ...pv, depth, from: runner.id };
            discovered.push(s);
            if (depth <= (maxDepth[pv.kind] ?? 0)) next.push(s);
          }
          await query(`UPDATE capabilities SET yield_runs = yield_runs + 1, yield_hits = yield_hits + $2 WHERE id=$1`, [runner.id, run.claims > 0 ? 1 : 0]);
        } catch (e) {
          run.status = "error"; run.note = String((e as Error).message).slice(0, 200);
        }
        run.ms = Date.now() - t0;
        await query(
          `INSERT INTO actions (id, investigation_id, kind, target, capability_id, state, result, result_refs, cost_usd, seconds, dedupe_key, started_at, finished_at)
           VALUES ($1,$2,'capability',$3,$4,'done',$5,$6,0,$7,$8,to_timestamp($9/1000.0),now())`,
          [uuidv7(), inv, JSON.stringify({ kind: seed.kind, value: seed.value, depth: seed.depth, from: seed.from ?? null }), runner.id, `${run.status}: ${run.claims} claims, ${run.pivots} pivots${run.note ? " — " + run.note : ""}`, JSON.stringify(run.source_id ? [run.source_id] : []), run.ms / 1000, `${runner.id}|${seed.kind}|${norm(seed.kind, seed.value)}`, t0],
        );
        log(`  ${run.status.padEnd(9)} ${runner.id.padEnd(24)} ${seed.kind}:${seed.value.slice(0, 40)}  → ${run.claims} claims, ${run.pivots} pivots${run.note ? `  (${run.note.slice(0, 80)})` : ""}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    wave = next;
  }
  return { runs, claims: claimsTotal, sources: sourcesTotal, discovered, stopped };
}

/** Pivots already sitting in the graph: account nodes (email/domain/ip/username), the subject itself, and the
 *  organizations one professional hop from it. This is how the loop re-arms the engine each pass without an LLM. */
export function harvestPivots(g: Graph, subjectId?: string | null): PivotSeed[] {
  const out: PivotSeed[] = [];
  const push = (kind: PivotKind, value: string, from: string) => { if (value) out.push({ kind, value, depth: 0, from }); };
  const ACCOUNT_KIND: Record<string, PivotKind> = { email: "email", domain: "domain", hostname: "hostname", ip: "ip", username: "username", handle: "username", phone: "phone" };
  // an account is worth pivoting on only when it hangs off the subject or a person/org — not when its only tie is
  // another account (a co-hosted domain on a shared IP, a nameserver's nameserver): that is how the chain sprawls
  const anchored = (id: string) => [...(g.out.get(id) ?? []), ...(g.inn.get(id) ?? [])].some((l) => {
    const other = l.src === id ? l.dst : l.src;
    if (other === subjectId) return true;
    const t = g.entities.get(other)?.type;
    return t === "person" || t === "organization";
  });
  for (const e of g.entities.values()) {
    if (e.type !== "account" || e.id === subjectId) continue;
    const k = ACCOUNT_KIND[e.kind ?? ""];
    if (k && anchored(e.id)) push(k, e.keys.identifier?.[0] ?? e.name, "graph:account");
  }
  if (subjectId) {
    const s = g.entities.get(subjectId);
    if (s) {
      push(s.type === "organization" ? "org" : "name", s.name, "graph:subject");
      for (const k of ["email", "domain", "handle"] as const) for (const v of s.keys[k] ?? []) push(k === "handle" ? "username" : k, v, "graph:subject");
      // the people and organizations bound to the subject structurally (owner, founder, members, subsidiaries) get the
      // full arsenal too: their names AND their handles/emails — this is the "deep dive on the owner"
      const PRO = new Set(["works_at", "founded", "board_member", "member_of", "owns", "manages", "subsidiary_of", "controls", "part_of", "related_to", "spouse_of", "parent_of", "knows", "uses_account"]);
      // when the subject is an account (a domain seed), the org/person that owns or uses it is the real subject:
      // walk one hop to those anchors, then harvest the people and orgs bound to each anchor
      const anchors = new Set<string>([subjectId]);
      if (s.type === "account") for (const l of [...(g.out.get(subjectId) ?? []), ...(g.inn.get(subjectId) ?? [])]) {
        const other = g.entities.get(l.src === subjectId ? l.dst : l.src);
        if (other && (other.type === "organization" || other.type === "person") && ["owns", "uses_account", "part_of", "controls"].includes(l.predicate)) anchors.add(other.id);
      }
      for (const a of anchors) {
        const an = g.entities.get(a)!;
        if (a !== subjectId) { push(an.type === "organization" ? "org" : "name", an.name, "graph:anchor"); for (const k of ["email", "domain", "handle"] as const) for (const v of an.keys[k] ?? []) push(k === "handle" ? "username" : k, v, "graph:anchor"); }
        for (const l of [...(g.out.get(a) ?? []), ...(g.inn.get(a) ?? [])]) {
          if (!PRO.has(l.predicate)) continue;
          const other = g.entities.get(l.src === a ? l.dst : l.src);
          if (!other || (other.type !== "organization" && other.type !== "person")) continue;
          push(other.type === "organization" ? "org" : "name", other.name, `graph:${l.predicate}`);
          for (const k of ["email", "domain", "handle"] as const) for (const v of other.keys[k] ?? []) push(k === "handle" ? "username" : k, v, `graph:${l.predicate}`);
        }
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => { const k = `${p.kind}|${norm(p.kind, p.value)}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Seeds from an investigation's seed record: the name (as person or org) plus any typed hints. */
export function seedPivots(seed: { kind: string; name: string; hints?: Record<string, string> }): PivotSeed[] {
  const out: PivotSeed[] = [];
  const kind = seed.kind.toLowerCase();
  if (kind === "domain") out.push({ kind: "domain", value: seed.name.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), depth: 0, from: "seed" });
  else if (kind === "organization" || kind === "org" || kind === "company") out.push({ kind: "org", value: seed.name, depth: 0, from: "seed" });
  else if (kind === "email") out.push({ kind: "email", value: seed.name, depth: 0, from: "seed" });
  else if (kind === "username") out.push({ kind: "username", value: seed.name, depth: 0, from: "seed" });
  else out.push({ kind: "name", value: seed.name, depth: 0, from: "seed" });
  for (const [k, v] of Object.entries(seed.hints ?? {})) {
    const kk = k === "handle" ? "username" : k;
    if (["domain", "email", "username", "ip", "phone", "url", "image", "org"].includes(kk)) out.push({ kind: kk as PivotKind, value: v, depth: 0, from: "seed" });
  }
  return out;
}
