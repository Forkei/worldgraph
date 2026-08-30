// Fetch cascade (A1): Firecrawl (primary) → plain HTTP + Readability → Wayback archive.
// Returns one normalized result shape regardless of path.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { env } from "@worldgraph/core";
import { markdownToText } from "./markdown.ts";
import { rateLimit } from "./ratelimit.ts";

export interface FetchResult {
  url: string;
  final_url: string;
  method: "firecrawl" | "http" | "archive";
  kind: "html" | "pdf" | "unknown";
  http_status: number | null;
  title: string | null;
  published_at: string | null;
  lang: string | null;
  /** reader-visible plain text */
  text: string;
  /** raw payload to archive in the blob store (markdown for firecrawl, html for http) */
  raw: string;
  raw_ext: "md" | "html";
  /** rendered HTML snapshot when available (captured before extraction) */
  rendered: string | null;
  links: string[];
  attempts: { method: string; ok: boolean; note: string }[];
}

export interface FetchOptions {
  timeoutMs?: number;
  minTextChars?: number;
  /** skip Firecrawl (e.g. for tests / cost) */
  noFirecrawl?: boolean;
}

const UA = "WorldGraph/0.1 (+research; contact: see repo)";
const MIN_TEXT = 400;

export async function fetchUrl(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const attempts: FetchResult["attempts"] = [];
  const minText = opts.minTextChars ?? MIN_TEXT;
  const timeout = opts.timeoutMs ?? 60_000;

  if (!opts.noFirecrawl && env.firecrawlKey) {
    try {
      const r = await viaFirecrawl(url, timeout);
      if (r.text.length >= minText) { r.attempts = [...attempts, { method: "firecrawl", ok: true, note: `${r.text.length} chars` }]; return r; }
      attempts.push({ method: "firecrawl", ok: false, note: `too short: ${r.text.length} chars` });
    } catch (e) {
      attempts.push({ method: "firecrawl", ok: false, note: String((e as Error).message).slice(0, 200) });
    }
  }
  try {
    const r = await viaHttp(url, timeout);
    if (r.text.length >= minText) { r.attempts = [...attempts, { method: "http", ok: true, note: `${r.text.length} chars` }]; return r; }
    attempts.push({ method: "http", ok: false, note: `too short: ${r.text.length} chars (status ${r.http_status})` });
  } catch (e) {
    attempts.push({ method: "http", ok: false, note: String((e as Error).message).slice(0, 200) });
  }
  try {
    const r = await viaArchive(url, timeout);
    if (r.text.length >= minText) { r.attempts = [...attempts, { method: "archive", ok: true, note: `${r.text.length} chars` }]; return r; }
    attempts.push({ method: "archive", ok: false, note: `too short: ${r.text.length} chars` });
  } catch (e) {
    attempts.push({ method: "archive", ok: false, note: String((e as Error).message).slice(0, 200) });
  }
  const err = new Error(`all fetch methods failed for ${url}: ` + attempts.map((a) => `${a.method}: ${a.note}`).join(" | "));
  (err as Error & { attempts: typeof attempts }).attempts = attempts;
  throw err;
}

async function viaFirecrawl(url: string, timeoutMs: number): Promise<FetchResult> {
  await rateLimit("firecrawl", 6500); // free tier ≈ 10 req/min
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "html", "links"], onlyMainContent: true, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 10_000),
  });
  const j = (await res.json()) as { success?: boolean; error?: string; data?: { markdown?: string; html?: string; links?: string[]; metadata?: Record<string, unknown> } };
  if (!res.ok || !j.success || !j.data) throw new Error(`firecrawl ${res.status}: ${j.error ?? "no data"}`);
  const meta = j.data.metadata ?? {};
  const md = j.data.markdown ?? "";
  const status = typeof meta.statusCode === "number" ? meta.statusCode : null;
  return {
    url,
    final_url: (meta.sourceURL as string) ?? (meta.url as string) ?? url,
    method: "firecrawl",
    kind: /\.pdf(\?|$)/i.test(url) || String(meta.contentType ?? "").includes("pdf") ? "pdf" : "html",
    http_status: status,
    title: (meta.title as string) ?? null,
    published_at: pickDate(meta),
    lang: (meta.language as string) ?? null,
    text: markdownToText(md),
    raw: md,
    raw_ext: "md",
    rendered: j.data.html ?? null,
    links: (j.data.links ?? []).slice(0, 500),
    attempts: [],
  };
}

async function viaHttp(url: string, timeoutMs: number): Promise<FetchResult> {
  await rateLimit(new URL(url).hostname, 2000);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("xml") && !ct.includes("text/plain")) {
    return { url, final_url: res.url || url, method: "http", kind: ct.includes("pdf") ? "pdf" : "unknown", http_status: res.status, title: null, published_at: null, lang: null, text: "", raw: "", raw_ext: "html", rendered: null, links: [], attempts: [] };
  }
  const html = await res.text();
  return { ...readable(html, res.url || url), url, method: "http", http_status: res.status, raw: html, raw_ext: "html", rendered: html, attempts: [] };
}

async function viaArchive(url: string, timeoutMs: number): Promise<FetchResult> {
  await rateLimit("archive.org", 3000);
  const avail = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
  const j = (await avail.json()) as { archived_snapshots?: { closest?: { url?: string; timestamp?: string; available?: boolean } } };
  const snap = j.archived_snapshots?.closest;
  if (!snap?.available || !snap.url) throw new Error("no wayback snapshot");
  const res = await fetch(snap.url.replace(/^http:/, "https:"), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  const html = await res.text();
  const r = readable(html, url);
  const ts = snap.timestamp ?? "";
  const published = ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : null;
  return { ...r, url, final_url: snap.url, method: "archive", http_status: res.status, published_at: r.published_at ?? published, raw: html, raw_ext: "html", rendered: html, attempts: [] };
}

function readable(html: string, baseUrl: string): Omit<FetchResult, "url" | "method" | "http_status" | "raw" | "raw_ext" | "rendered" | "attempts"> {
  const { document } = parseHTML(html);
  const links: string[] = [];
  for (const a of document.querySelectorAll("a[href]")) {
    try { links.push(new URL(a.getAttribute("href")!, baseUrl).href); } catch { /* ignore */ }
    if (links.length >= 500) break;
  }
  const lang = document.documentElement?.getAttribute("lang") ?? null;
  const metaDate = document.querySelector('meta[property="article:published_time"], meta[name="date"], meta[name="pubdate"], time[datetime]');
  const published = metaDate?.getAttribute("content") ?? metaDate?.getAttribute("datetime") ?? null;
  // linkedom's document is close enough to the DOM for Readability; no DOM lib in tsconfig on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const article = new Readability(document as any).parse();
  const text = article?.textContent ? article.textContent.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  return { final_url: baseUrl, kind: "html", title: article?.title ?? document.title ?? null, published_at: published, lang, text, links };
}

function pickDate(meta: Record<string, unknown>): string | null {
  for (const k of ["publishedTime", "article:published_time", "datePublished", "date", "og:updated_time", "modifiedTime"]) {
    const v = meta[k];
    if (typeof v === "string" && v.length >= 8) return v;
  }
  return null;
}
