// Shared HTTP helpers for capability runners: rate-limited, timed-out, with a real User-Agent (several sources —
// Nominatim, crt.sh — reject blank UAs) and terse error messages that name the source. Mirrors the fetch shape
// used in search.ts so every capability behaves consistently.
import { rateLimit } from "../ratelimit.ts";

export const CAP_UA = "worldgraph-research/1.0 (+https://github.com/worldgraph)";

export interface HttpOpts {
  /** rate-limit bucket key (usually the source host), and the minimum gap between hits to it */
  rateKey: string;
  minIntervalMs?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function run(url: string, init: RequestInit, o: HttpOpts): Promise<Response> {
  await rateLimit(o.rateKey, o.minIntervalMs ?? 1000);
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": CAP_UA, ...(init.headers as Record<string, string>), ...o.headers },
    signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`${o.rateKey} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function getJson<T>(url: string, o: HttpOpts): Promise<T> {
  const res = await run(url, { method: "GET" }, o);
  return (await res.json()) as T;
}

export async function getText(url: string, o: HttpOpts): Promise<string> {
  const res = await run(url, { method: "GET" }, o);
  return await res.text();
}

export async function postJson<T>(url: string, body: unknown, o: HttpOpts): Promise<T> {
  const res = await run(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, o);
  return (await res.json()) as T;
}

/** GET that returns null on 404/empty instead of throwing — for existence-style checks (Gravatar, profiles). */
export async function getJsonOrNull<T>(url: string, o: HttpOpts): Promise<T | null> {
  try {
    await rateLimit(o.rateKey, o.minIntervalMs ?? 1000);
    const res = await fetch(url, { headers: { "User-Agent": CAP_UA, ...o.headers }, signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${o.rateKey} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const txt = await res.text();
    return txt ? (JSON.parse(txt) as T) : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null; // non-JSON body → treat as "not found"
    throw e;
  }
}
