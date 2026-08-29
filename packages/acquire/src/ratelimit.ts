// Per-key (domain / provider) minimum interval between requests, in-process.
const last = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rateLimit(key: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const prev = last.get(key) ?? 0;
  const wait = prev + minIntervalMs - now;
  last.set(key, Math.max(now, prev + minIntervalMs));
  if (wait > 0) await sleep(wait);
}
