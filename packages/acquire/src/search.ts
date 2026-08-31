// Search capabilities (M2 §8): turn a query into candidate URLs. SerpAPI (Google) for keyword search, Exa for
// semantic/neural discovery. Each returns a normalized SearchHit list; results become Sources like any page.
// No graph writes here — the loop decides what to fetch.
import { env } from "@worldgraph/core";
import { rateLimit } from "./ratelimit.ts";

export interface SearchHit { url: string; title: string | null; snippet: string | null; published_at?: string | null; rank: number }
export interface SearchResult { engine: string; query: string; hits: SearchHit[]; usd: number }

/** Google via SerpAPI. Keyword search; ~$0.01–0.015 per query on paid tiers, free tier 100/mo. */
export async function serpApiSearch(query: string, opts: { num?: number; location?: string } = {}): Promise<SearchResult> {
  if (!env.serpApiKey) throw new Error("no SERPAPI_KEY in .env");
  await rateLimit("serpapi", 1200);
  const params = new URLSearchParams({ engine: "google", q: query, api_key: env.serpApiKey, num: String(opts.num ?? 10) });
  if (opts.location) params.set("location", opts.location);
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { organic_results?: { link?: string; title?: string; snippet?: string; date?: string }[]; error?: string };
  if (j.error) throw new Error(`serpapi: ${j.error}`);
  const hits: SearchHit[] = (j.organic_results ?? [])
    .filter((r) => r.link)
    .map((r, i) => ({ url: r.link!, title: r.title ?? null, snippet: r.snippet ?? null, published_at: r.date ?? null, rank: i + 1 }));
  return { engine: "search.serpapi.google", query, hits, usd: 0.01 };
}

/** Exa neural/semantic search. type:auto balances relevance and speed; highlights kept for the loop's triage. */
export async function exaSearch(query: string, opts: { num?: number; type?: string; includeDomains?: string[]; excludeDomains?: string[] } = {}): Promise<SearchResult> {
  if (!env.exaKey) throw new Error("no EXA_API_KEY in .env");
  await rateLimit("exa", 1000);
  const body: Record<string, unknown> = { query, type: opts.type ?? "auto", numResults: opts.num ?? 10, contents: { highlights: true } };
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
  const hits: SearchHit[] = (j.results ?? [])
    .filter((r) => r.url)
    .map((r, i) => ({ url: r.url!, title: r.title ?? null, snippet: (r.highlights ?? []).join(" … ") || null, published_at: r.publishedDate ?? null, rank: i + 1 }));
  return { engine: "search.exa", query, hits, usd: 0.005 };
}

export const SEARCH_ENGINES: Record<string, (q: string, o?: { num?: number }) => Promise<SearchResult>> = {
  "search.serpapi.google": serpApiSearch,
  "search.exa": exaSearch,
};
