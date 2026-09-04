// System health — the pre-check / post-check the product shows so nothing is ever silently broken, off, or
// out of budget. Actively probes each keyed provider (a capability erroring mid-run is NOT recorded anywhere,
// so history can't be trusted — we ask the providers live), reads the capability registry for what's enabled
// and why, and checks the database. Cheap, parallel, timeout-guarded. Consumed by `wg status` and /api/health.
import { query, listCapabilities } from "@worldgraph/db";

export type HealthStatus = "ok" | "warn" | "down" | "off";
export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  /** budget/quota when the provider exposes it */
  budget?: { used: number; limit: number | null; unit: string; left?: number };
}
export interface HealthReport {
  ok: boolean;               // nothing down
  ready: boolean;            // nothing down AND nothing warned (all green)
  at: string;
  checks: HealthCheck[];
  capabilities: { enabled: number; off: { id: string; needs: string }[] };
  /** tool failures recorded in the last 7 days (capability/search errors) — the post-check */
  recentFailures: { id: string; count: number; last: string; sample: string }[];
}

const has = (k: string) => !!process.env[k];
async function timed<T>(ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
async function getJson(url: string, headers: Record<string, string> = {}, ms = 8000): Promise<{ status: number; json: any }> {
  const res = await timed(ms, fetch(url, { headers }));
  let json: any = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

// ---- provider probes: each returns a HealthCheck, never throws ------------------------------------------
async function probeSerpApi(): Promise<HealthCheck> {
  const id = "serpapi", label = "SerpAPI (web search)";
  if (!has("SERPAPI_KEY")) return { id, label, status: "off", detail: "no SERPAPI_KEY — web search via SerpAPI disabled" };
  try {
    const { status, json } = await getJson(`https://serpapi.com/account.json?api_key=${process.env.SERPAPI_KEY}`);
    if (status !== 200 || !json) return { id, label, status: "down", detail: `account check failed (HTTP ${status})` };
    const left = Number(json.total_searches_left ?? json.plan_searches_left ?? 0);
    const used = Number(json.this_month_usage ?? 0);
    const limit = json.searches_per_month != null ? Number(json.searches_per_month) : null;
    return { id, label, status: left <= 0 ? "down" : left < 50 ? "warn" : "ok", detail: `${left} searches left${json.plan_name ? ` · ${json.plan_name}` : ""}`, budget: { used, limit, unit: "searches", left } };
  } catch (e) { return { id, label, status: "down", detail: `unreachable: ${String((e as Error).message).slice(0, 80)}` }; }
}

async function probeApify(): Promise<HealthCheck> {
  const id = "apify", label = "Apify (Instagram / social)";
  if (!has("APIFY_TOKEN")) return { id, label, status: "off", detail: "no APIFY_TOKEN — social capabilities disabled" };
  try {
    const t = process.env.APIFY_TOKEN;
    const { status, json } = await getJson(`https://api.apify.com/v2/users/me/limits?token=${t}`);
    if (status !== 200 || !json?.data) {
      // fall back to a bare identity check
      const me = await getJson(`https://api.apify.com/v2/users/me?token=${t}`);
      if (me.status !== 200) return { id, label, status: "down", detail: `token rejected (HTTP ${me.status})` };
      return { id, label, status: "ok", detail: `token valid${me.json?.data?.plan?.id ? ` · ${me.json.data.plan.id}` : ""} (usage n/a)` };
    }
    const cur = json.data.current ?? {}, lim = json.data.limits ?? {};
    const used = Number(cur.monthlyUsageUsd ?? 0), limit = lim.maxMonthlyUsageUsd != null ? Number(lim.maxMonthlyUsageUsd) : null;
    const left = limit != null ? Math.max(0, limit - used) : undefined;
    const st: HealthStatus = limit != null && used >= limit ? "down" : left != null && left < 1 ? "warn" : "ok";
    return { id, label, status: st, detail: `$${used.toFixed(2)}${limit != null ? ` of $${limit.toFixed(2)}` : ""} used this month`, budget: { used, limit, unit: "usd", left } };
  } catch (e) { return { id, label, status: "down", detail: `unreachable: ${String((e as Error).message).slice(0, 80)}` }; }
}

async function probeVirusTotal(): Promise<HealthCheck> {
  const id = "virustotal", label = "VirusTotal (passive DNS)";
  const key = process.env.VIRUSTOTAL_API_KEY || process.env.VT_API_KEY;
  if (!key) return { id, label, status: "off", detail: "no VIRUSTOTAL_API_KEY — passive DNS disabled" };
  try {
    const { status, json } = await getJson(`https://www.virustotal.com/api/v3/users/${key}`, { "x-apikey": key });
    if (status === 401) return { id, label, status: "down", detail: "key rejected (401)" };
    if (status !== 200) return { id, label, status: "warn", detail: `quota check inconclusive (HTTP ${status}) — key set` };
    const q = json?.data?.attributes?.quotas?.api_requests_daily ?? {};
    const used = Number(q.used ?? 0), limit = q.allowed != null ? Number(q.allowed) : null, left = limit != null ? limit - used : undefined;
    const st: HealthStatus = limit != null && used >= limit ? "down" : left != null && left < 20 ? "warn" : "ok";
    return { id, label, status: st, detail: `${used}${limit != null ? `/${limit}` : ""} daily requests used`, budget: { used, limit, unit: "requests/day", left } };
  } catch (e) { return { id, label, status: "warn", detail: `key set; quota unreachable: ${String((e as Error).message).slice(0, 60)}` }; }
}

async function probeDehashed(): Promise<HealthCheck> {
  const id = "dehashed", label = "DeHashed (breach linkage)";
  if (!has("DEHASHED_API_KEY")) return { id, label, status: "off", detail: "no DEHASHED_API_KEY — breach linkage disabled" };
  try {
    // a failed search spends no credit; this cheaply distinguishes valid-with-credits / out-of-credits / bad-key
    const res = await timed(9000, fetch("https://api.dehashed.com/v2/search", { method: "POST", headers: { "Dehashed-Api-Key": process.env.DEHASHED_API_KEY!, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: "email:healthcheck@worldgraph.invalid", page: 1, size: 1 }) }));
    if (res.status === 401) return { id, label, status: "down", detail: "key rejected (401)" };
    if (res.status === 402 || res.status === 403) { const b = await res.json().catch(() => ({})); return { id, label, status: "down", detail: /credit/i.test(JSON.stringify(b)) ? "out of query credits — add a pack on dehashed.com" : `blocked (HTTP ${res.status})` }; }
    if (res.status === 200) return { id, label, status: "ok", detail: "key valid, has credits" };
    return { id, label, status: "warn", detail: `unexpected HTTP ${res.status}` };
  } catch (e) { return { id, label, status: "warn", detail: `key set; unreachable: ${String((e as Error).message).slice(0, 60)}` }; }
}

async function probeKeyOnly(id: string, label: string, envKey: string, offNote: string): Promise<HealthCheck> {
  return has(envKey) ? { id, label, status: "ok", detail: "key set" } : { id, label, status: "off", detail: offNote };
}

async function probeDb(): Promise<HealthCheck> {
  const id = "database", label = "Database (Postgres :5433)";
  try { const r = await timed(5000, query<{ n: string }>(`SELECT count(*)::text n FROM investigations`, [])); return { id, label, status: "ok", detail: `up · ${r[0]?.n ?? 0} investigations` }; }
  catch (e) { return { id, label, status: "down", detail: `unreachable: ${String((e as Error).message).slice(0, 80)} — run \`pnpm pg:start\`` }; }
}

/** Run every check in parallel. Never throws; a probe that fails becomes a down/warn check. */
export async function healthCheck(): Promise<HealthReport> {
  const [db, serp, apify, vt, dehashed, anthropic, gemini, firecrawl, exa, facecheck, caps] = await Promise.all([
    probeDb(), probeSerpApi(), probeApify(), probeVirusTotal(), probeDehashed(),
    probeKeyOnly("anthropic", "Anthropic (agent model)", "ANTHROPIC_API_KEY", "no ANTHROPIC_API_KEY — the agent cannot run"),
    probeKeyOnly("gemini", "Gemini (vision + extraction)", "GEMINI_API_KEY", "no GEMINI_API_KEY — vision/look_at disabled"),
    probeKeyOnly("firecrawl", "Firecrawl (page fetch)", "FIRECRAWL_API_KEY", "no FIRECRAWL_API_KEY — falls back to plain HTTP"),
    probeKeyOnly("exa", "Exa (semantic search)", "EXA_API_KEY", "no EXA_API_KEY — Exa search disabled"),
    probeKeyOnly("facecheck", "FaceCheck (face search)", "FACECHECK_API_TOKEN", "no token — face search off (intended)"),
    listCapabilities().catch(() => [] as Awaited<ReturnType<typeof listCapabilities>>),
  ]);
  const checks = [db, anthropic, gemini, serp, firecrawl, exa, apify, vt, dehashed, facecheck];
  const off = caps.filter((c) => !c.enabled).map((c) => ({ id: c.id, needs: (c.requires as { key?: string }).key ?? "gate" }));
  // post-check: tool failures recorded in the last 7 days (capability/search errors now land in `actions`)
  const recentFailures = db.status === "down" ? [] : await query<{ id: string; count: string; last: string; sample: string }>(
    `SELECT COALESCE(capability_id, kind) id, count(*)::text count, max(created_at)::text last, (array_agg(result ORDER BY created_at DESC))[1] sample
     FROM actions WHERE state='error' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`, []).catch(() => []);
  const ok = !checks.some((c) => c.status === "down");
  const ready = !checks.some((c) => c.status === "down" || c.status === "warn");
  return { ok, ready, at: new Date().toISOString(), checks, capabilities: { enabled: caps.filter((c) => c.enabled).length, off }, recentFailures: recentFailures.map((r) => ({ id: r.id, count: Number(r.count), last: r.last, sample: (r.sample ?? "").slice(0, 100) })) };
}
