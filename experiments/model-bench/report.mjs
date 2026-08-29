// Aggregate runs/ into RESULTS.md (+ results.json) and a spot-check sheet for a human reviewer.
import path from "node:path";
import { readdirSync, writeFileSync } from "node:fs";
import { RUNS_DIR, PAGES_DIR, here, readJSON, quoteFound, surfaceInQuote } from "./shared.mjs";

const pages = Object.fromEntries(readdirSync(PAGES_DIR).filter((f) => f.endsWith(".json")).map((f) => { const p = readJSON(path.join(PAGES_DIR, f)); return [p.id, p]; }));
const rows = [];
const spot = [];
for (const mk of readdirSync(RUNS_DIR)) {
  const dir = path.join(RUNS_DIR, mk);
  const runs = readdirSync(dir).map((f) => readJSON(path.join(dir, f)));
  // re-score quotes with the current normalizer so gate changes never require re-running models
  for (const r of runs) if (r.raw && r.items) {
    const refs = new Map(r.raw.mentions.map((x) => [x.ref, x]));
    const text = pages[r.page].text;
    let k = 0;
    for (const rel of r.raw.relations) { const it = r.items[k++]; const s = refs.get(rel.subject), o = refs.get(rel.object); it.quote_ok = quoteFound(rel.quote, text); it.surface_ok = !!(s && o && surfaceInQuote(s.surface, rel.quote) && surfaceInQuote(o.surface, rel.quote)); }
    for (const a of r.raw.attributes) { const it = r.items[k++]; const e = refs.get(a.entity); it.quote_ok = quoteFound(a.quote, text); it.surface_ok = !!(e && surfaceInQuote(e.surface, a.quote)); }
  }
  const ok = runs.filter((r) => !r.error && !r.parse_error);
  const items = ok.flatMap((r) => r.items);
  const judged = items.filter((i) => i.verdict);
  const n = (arr, f) => arr.filter(f).length;
  const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
  const label = runs[0]?.label ?? mk;
  rows.push({
    key: mk, label,
    pages_ok: ok.length, pages_failed: runs.length - ok.length,
    errors: runs.filter((r) => r.error).map((r) => `${r.page}: ${r.error.slice(0, 80)}`),
    relations: sum(ok, (r) => r.n_relations), attributes: sum(ok, (r) => r.n_attributes),
    items: items.length,
    quote_ok: items.length ? n(items, (i) => i.quote_ok) / items.length : 0,
    surface_ok: items.length ? n(items, (i) => i.surface_ok) / items.length : 0,
    other_types: sum(ok, (r) => r.n_other_types), other_preds: sum(ok, (r) => r.n_other_preds),
    judged: judged.length,
    supported: judged.length ? n(judged, (i) => i.verdict === "supported") / judged.length : null,
    partial: judged.length ? n(judged, (i) => i.verdict === "partial") / judged.length : null,
    unsupported: judged.length ? n(judged, (i) => i.verdict === "unsupported") / judged.length : null,
    ms_mean: ok.length ? sum(ok, (r) => r.ms) / ok.length : 0,
    ms_max: Math.max(0, ...ok.map((r) => r.ms)),
    usd_total: sum(ok, (r) => r.usd),
    usd_per_page: ok.length ? sum(ok, (r) => r.usd) / ok.length : 0,
    out_tok_mean: ok.length ? sum(ok, (r) => r.outTok) / ok.length : 0,
  });
  // spot-check: 3 random-ish items per page per model
  for (const r of ok) for (const i of [0, Math.floor(r.items.length / 2), r.items.length - 1]) if (r.items[i]) spot.push({ model: label, page: r.page, ...r.items[i] });
}
// Good facts per dollar: supported items (extrapolated from judged share) / total usd
for (const r of rows) {
  r.supported_items_est = r.supported == null ? null : Math.round(r.items * r.supported);
  r.good_per_usd = r.supported_items_est == null || !r.usd_total ? null : r.supported_items_est / r.usd_total;
}
rows.sort((a, b) => (b.supported ?? 0) - (a.supported ?? 0));

const pct = (x) => (x == null ? "—" : (x * 100).toFixed(0) + "%");
const md = [];
md.push("# Extraction model benchmark — results\n");
md.push(`Generated ${new Date().toISOString().slice(0, 16)}Z. Same prompt, same JSON schema, same 10 real pages (capped at 24k chars each). Judge: Claude Opus 5, grading up to 60 items per page against the page text.\n`);
md.push("| Model | Pages | Items (rel+attr) | Quote verbatim | Judge: supported | partial | unsupported | Mean s/page | Max s | $/page | $ total | Good items / $ |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  md.push(`| ${r.label} | ${r.pages_ok}/${r.pages_ok + r.pages_failed} | ${r.items} (${r.relations}+${r.attributes}) | ${pct(r.quote_ok)} | **${pct(r.supported)}** | ${pct(r.partial)} | ${pct(r.unsupported)} | ${(r.ms_mean / 1000).toFixed(1)} | ${(r.ms_max / 1000).toFixed(0)} | $${r.usd_per_page.toFixed(4)} | $${r.usd_total.toFixed(3)} | ${r.good_per_usd == null ? "—" : Math.round(r.good_per_usd)} |`);
}
md.push("\n**How to read it**\n- *Items*: relations + attributes emitted. More is not better by itself — see *supported*.\n- *Quote verbatim*: share of items whose quote is found character-for-character (after whitespace/quote-mark normalization) in the page. This is the M0 hard gate; anything below ~90% means the model paraphrases quotes.\n- *Judge supported*: share of items an independent Opus 5 judge says the page actually states. This is the accuracy number.\n- *Good items / $*: estimated supported items per dollar — the cost-efficiency number.\n");
const errs = rows.filter((r) => r.errors.length);
if (errs.length) { md.push("\n**Errors**\n"); for (const r of errs) for (const e of r.errors) md.push(`- ${r.label}: ${e}`); }
md.push("\n**Other/proposed types & predicates emitted** (open-ontology escape hatch usage)\n");
for (const r of rows) md.push(`- ${r.label}: ${r.other_types} other types, ${r.other_preds} other predicates`);
writeFileSync(path.join(here, "RESULTS.md"), md.join("\n") + "\n");
writeFileSync(path.join(here, "results.json"), JSON.stringify(rows, null, 2));

const sp = ["# Spot-check sheet\n", "Mark each ✅ / ❌ after reading the quote (and the page if needed).\n"];
let cur = "";
for (const s of spot) {
  if (s.model !== cur) { cur = s.model; sp.push(`\n## ${cur}\n`); }
  sp.push(`- [ ] **${s.page}** · ${s.kind}: ${s.text}${s.props?.length ? " {" + s.props.map((p) => `${p.key}=${p.value}`).join(", ") + "}" : ""}\n  > ${s.quote.replace(/\n/g, " ")}\n  quote_ok=${s.quote_ok ? "✓" : "✗"} judge=${s.verdict ?? "—"}`);
}
writeFileSync(path.join(here, "SPOT_CHECK.md"), sp.join("\n") + "\n");
console.log(md.join("\n"));
