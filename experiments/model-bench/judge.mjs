// Independent judge: Claude Opus 5 grades each extracted item against the page text.
// supported = the page states it; partial = roughly right but wrong detail; unsupported = not in the page.
// Writes verdicts back into runs/<model>/<page>.json as item.verdict.
import path from "node:path";
import { readdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { PAGES_DIR, RUNS_DIR, readJSON, writeJSON, sleep } from "./shared.mjs";

const anthropic = new Anthropic();
const MAX_ITEMS = 60; // per page-model; sampled deterministically if more
const JUDGE_MODEL = "claude-opus-5";

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          verdict: { type: "string", enum: ["supported", "partial", "unsupported"] },
          note: { type: "string" },
        },
        required: ["i", "verdict", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const SYSTEM = `You are grading facts that another system extracted from a web page. For each numbered item decide:
- supported: the page text clearly states this (the subject/object identities are right and the relationship or value is right, even if the extractor's quote is imperfect).
- partial: the gist is in the page but a detail is wrong (wrong role, wrong date, wrong direction, entity mixed up with a similar one).
- unsupported: the page does not state this, or it is invented / inferred beyond what is written.
Judge against the PAGE TEXT, not against the extractor's quote. Be strict about invented details. Keep notes to a few words.`;

const pages = Object.fromEntries(readdirSync(PAGES_DIR).filter((f) => f.endsWith(".json")).map((f) => { const p = readJSON(path.join(PAGES_DIR, f)); return [p.id, p]; }));
let totalUsd = 0;

for (const mk of readdirSync(RUNS_DIR)) {
  const dir = path.join(RUNS_DIR, mk);
  for (const f of readdirSync(dir)) {
    const fp = path.join(dir, f);
    const run = readJSON(fp);
    if (run.error || !run.items?.length || run.judged) continue;
    const page = pages[run.page];
    // deterministic sample: every k-th item
    const idx = run.items.map((_, i) => i);
    const step = Math.max(1, Math.ceil(idx.length / MAX_ITEMS));
    const sample = idx.filter((i) => i % step === 0).slice(0, MAX_ITEMS);
    const list = sample.map((i) => {
      const it = run.items[i];
      const props = it.props?.length ? " {" + it.props.map((p) => `${p.key}=${p.value}`).join(", ") + "}" : "";
      return `[${i}] ${it.kind}: ${it.text}${props}`;
    }).join("\n");
    const t0 = Date.now();
    let res;
    try {
      res = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
        system: [{ type: "text", text: SYSTEM }],
        messages: [{ role: "user", content: `PAGE TEXT (${page.url}):\n<text>\n${page.text}\n</text>\n\nITEMS TO GRADE:\n${list}` }],
      });
    } catch (e) {
      console.log("judge error", mk, run.page, String(e.message).slice(0, 120));
      await sleep(5000);
      continue;
    }
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { console.log("judge parse error", mk, run.page); continue; }
    for (const v of parsed.verdicts) if (run.items[v.i]) run.items[v.i].verdict = v.verdict, run.items[v.i].judge_note = v.note;
    run.judged = { model: JUDGE_MODEL, sampled: sample.length, of: run.items.length, ms: Date.now() - t0 };
    const usd = ((res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0)) * 5 + res.usage.output_tokens * 25) / 1e6;
    totalUsd += usd;
    writeJSON(fp, run);
    const sup = parsed.verdicts.filter((v) => v.verdict === "supported").length;
    console.log(`${mk.padEnd(22)} ${run.page.padEnd(12)} supported ${sup}/${parsed.verdicts.length}  ($${usd.toFixed(3)})`);
  }
}
console.log(`judge total $${totalUsd.toFixed(2)}`);
