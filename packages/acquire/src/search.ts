// Search capabilities (M2 §8): turn a query into candidate URLs. `google` is Serper.dev (real Google SERP, ~$1/1k)
// with SerpAPI as automatic fallback; SerpAPI alone fronts Bing, DuckDuckGo, Yandex and Yahoo (each with its own
// pagination parameter); Exa is semantic/neural discovery. Every engine returns the same
// SearchHit list, paged, so the investigator can go to page 2, 3, … instead of living on page 1. Results become
// Sources like any page. No graph writes here — the agent decides what to fetch.
import { env } from "@worldgraph/core";
import { rateLimit } from "./ratelimit.ts";

export interface SearchHit { url: string; title: string | null; snippet: string | null; published_at?: string | null; rank: number }
export interface SearchResult { engine: string; query: string; page: number; hits: SearchHit[]; usd: number; /** true when the engine reported more pages */ more?: boolean }
export interface SearchOpts { num?: number; page?: number; location?: string; /** ISO-639 language, where the engine supports it */ lang?: string }

/** SerpAPI engine ids and how each one pages (serpapi.com/blog/serpapi-pagination). */
export const SERP_ENGINES = {
  google: { engine: "google", pageParam: (p: number, n: number) => ({ start: String((p - 1) * n) }), perPage: 10 },
  bing: { engine: "bing", pageParam: (p: number, n: number) => ({ first: String((p - 1) * n + 1), count: String(n) }), perPage: 10 },
  duckduckgo: { engine: "duckduckgo", pageParam: (p: number, n: number) => ({ start: String((p - 1) * n) }), perPage: 10 },
  yandex: { engine: "yandex", pageParam: (p: number) => ({ p: String(p - 1) }), perPage: 10 },
  yahoo: { engine: "yahoo", pageParam: (p: number, n: number) => ({ b: String((p - 1) * n + 1) }), perPage: 10 },
} as const;
export type SerpEngine = keyof typeof SERP_ENGINES;

/** One of the SerpAPI-fronted engines. ~$0.01 per query on paid tiers (free tier 100/mo). */
export async function serpApiSearch(query: string, opts: SearchOpts & { engine?: SerpEngine } = {}): Promise<SearchResult> {
  if (!env.serpApiKey) throw new Error("no SERPAPI_KEY in .env");
  const eng = SERP_ENGINES[opts.engine ?? "google"];
  const page = Math.max(1, opts.page ?? 1), num = opts.num ?? eng.perPage;
  await rateLimit("serpapi", 1200);
  const params = new URLSearchParams({ engine: eng.engine, q: query, api_key: env.serpApiKey, ...eng.pageParam(page, num) });
  if (eng.engine === "google" || eng.engine === "duckduckgo") params.set("num", String(num));
  if (opts.location && eng.engine === "google") params.set("location", opts.location);
  if (opts.lang) { if (eng.engine === "google") params.set("hl", opts.lang); else if (eng.engine === "yandex") params.set("lang", opts.lang); else if (eng.engine === "bing") params.set("setLang", opts.lang); }
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { organic_results?: { link?: string; title?: string; snippet?: string; date?: string }[]; error?: string; serpapi_pagination?: { next?: string } };
  if (j.error && /hasn't returned any results|no results/i.test(j.error)) return { engine: `search.serpapi.${eng.engine}`, query, page, hits: [], usd: 0.01, more: false };
  if (j.error) throw new Error(`serpapi ${eng.engine}: ${j.error}`);
  const base = (page - 1) * num;
  const hits: SearchHit[] = (j.organic_results ?? [])
    .filter((r) => r.link)
    .map((r, i) => ({ url: r.link!, title: r.title ?? null, snippet: r.snippet ?? null, published_at: r.date ?? null, rank: base + i + 1 }));
  return { engine: `search.serpapi.${eng.engine}`, query, page, hits, usd: 0.01, more: !!j.serpapi_pagination?.next };
}

/** Exa neural/semantic search. type:auto balances relevance and speed; highlights kept for triage. Exa has no
 *  pages; page N is emulated by asking for N×num results and slicing (cost is per request, not per result). */
/** Serper.dev — real Google SERP at ~$1 per 1,000 (vs ~$10+ on SerpAPI). Operators (site:, quotes, -term) and
 *  pagination work as written. This is the PRIMARY google engine; SerpAPI is the automatic fallback. */
export async function serperSearch(query: string, opts: SearchOpts = {}): Promise<SearchResult> {
  if (!env.serperKey) throw new Error("no SERPER_API_KEY in .env");
  const page = Math.max(1, opts.page ?? 1), num = opts.num ?? 10;
  await rateLimit("serper", 300);
  const body: Record<string, unknown> = { q: query, num, page };
  if (opts.lang) body.hl = opts.lang;
  if (opts.location) body.location = opts.location;
  const res = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": env.serperKey, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { organic?: { link?: string; title?: string; snippet?: string; date?: string }[] };
  const base = (page - 1) * num;
  const hits: SearchHit[] = (j.organic ?? []).filter((r) => r.link).map((r, i) => ({ url: r.link!, title: r.title ?? null, snippet: r.snippet ?? null, published_at: r.date ?? null, rank: base + i + 1 }));
  return { engine: "search.serper.google", query, page, hits, usd: 0.001, more: hits.length >= num };
}

/** google = Serper first, SerpAPI fallback — one provider running dry can't blind the agent. */
export async function googleSearch(query: string, opts: SearchOpts = {}): Promise<SearchResult> {
  const errs: string[] = [];
  if (env.serperKey) { try { return await serperSearch(query, opts); } catch (e) { errs.push(`serper: ${String((e as Error).message).slice(0, 120)}`); } }
  if (env.serpApiKey) { try { return await serpApiSearch(query, { ...opts, engine: "google" }); } catch (e) { errs.push(`serpapi: ${String((e as Error).message).slice(0, 120)}`); } }
  throw new Error(errs.length ? `google search failed on every provider — ${errs.join(" | ")}` : "no SERPER_API_KEY or SERPAPI_KEY in .env");
}

export async function exaSearch(query: string, opts: SearchOpts & { type?: string; includeDomains?: string[]; excludeDomains?: string[] } = {}): Promise<SearchResult> {
  if (!env.exaKey) throw new Error("no EXA_API_KEY in .env");
  await rateLimit("exa", 1000);
  const page = Math.max(1, opts.page ?? 1), num = opts.num ?? 10;
  const body: Record<string, unknown> = { query, type: opts.type ?? "auto", numResults: Math.min(100, page * num), contents: { highlights: true } };
  if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains;
  if (opts.excludeDomains?.length) body.excludeDomains = opts.excludeDomains;
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.exaKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`exa ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { results?: { url?: string; title?: string; highlights?: string[]; publishedDate?: string }[] };
  const all = (j.results ?? []).filter((r) => r.url);
  const hits: SearchHit[] = all.slice((page - 1) * num, page * num)
    .map((r, i) => ({ url: r.url!, title: r.title ?? null, snippet: (r.highlights ?? []).join(" … ") || null, published_at: r.publishedDate ?? null, rank: (page - 1) * num + i + 1 }));
  return { engine: "search.exa", query, page, hits, usd: 0.005, more: all.length >= page * num && page * num < 100 };
}

/** Engine name as the agent says it → runner. */
export const SEARCH_ENGINES: Record<string, (q: string, o?: SearchOpts) => Promise<SearchResult>> = {
  google: (q, o) => googleSearch(q, o), // Serper first, SerpAPI fallback
  bing: (q, o) => serpApiSearch(q, { ...o, engine: "bing" }),
  duckduckgo: (q, o) => serpApiSearch(q, { ...o, engine: "duckduckgo" }),
  yandex: (q, o) => serpApiSearch(q, { ...o, engine: "yandex" }),
  yahoo: (q, o) => serpApiSearch(q, { ...o, engine: "yahoo" }),
  exa: (q, o) => exaSearch(q, o),
  // legacy ids used by the registry / cache keys
  "search.serpapi.google": (q, o) => serpApiSearch(q, { ...o, engine: "google" }),
  "search.exa": (q, o) => exaSearch(q, o),
};
export const ENGINE_NAMES = ["google", "bing", "duckduckgo", "yandex", "yahoo", "exa"] as const;
