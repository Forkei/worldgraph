// Fetch the benchmark pages once through Firecrawl and cache them locally (pages/<id>.json).
import path from "node:path";
import { existsSync } from "node:fs";
import { PAGES_DIR, MAX_CHARS, here, readJSON, writeJSON, sleep } from "./shared.mjs";

const pages = readJSON(path.join(here, "pages.json"));
const key = process.env.FIRECRAWL_API_KEY;
if (!key) throw new Error("FIRECRAWL_API_KEY missing");

function cap(text) {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.lastIndexOf("\n\n", MAX_CHARS);
  return text.slice(0, cut > MAX_CHARS * 0.7 ? cut : MAX_CHARS);
}

for (const p of pages) {
  const out = path.join(PAGES_DIR, `${p.id}.json`);
  if (existsSync(out)) { console.log("cached", p.id); continue; }
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: p.url, formats: ["markdown"], onlyMainContent: true }),
  });
  const j = await res.json();
  if (!j.success) { console.log("FAIL", p.id, j.error); await sleep(7000); continue; }
  const md = j.data.markdown || "";
  const meta = j.data.metadata || {};
  writeJSON(out, {
    ...p,
    title: meta.title || "",
    published_at: meta.publishedTime || meta["article:published_time"] || null,
    full_chars: md.length,
    text: cap(md),
  });
  console.log("fetched", p.id, md.length, "chars ->", Math.min(md.length, MAX_CHARS));
  await sleep(7000); // Firecrawl free-tier rate limit (~10 req/min)
}
