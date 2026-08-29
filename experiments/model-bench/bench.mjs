// Run every model over every cached page with the same prompt + schema. Writes runs/<model>/<page>.json.
import path from "node:path";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import {
  PAGES_DIR, RUNS_DIR, MODELS, SCHEMA, SYSTEM_PROMPT, userPrompt, cost, modelKey,
  quoteFound, surfaceInQuote, readJSON, writeJSON, sleep,
} from "./shared.mjs";

const anthropic = new Anthropic();
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

async function callAnthropic(m, page) {
  const req = {
    model: m.id,
    max_tokens: 64000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt(page) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };
  if (m.effort) req.output_config.effort = m.effort;
  if (m.id !== "claude-haiku-4-5") req.thinking = { type: "adaptive" };
  const res = await anthropic.messages.create(req);
  if (res.stop_reason === "refusal") throw new Error("refusal: " + JSON.stringify(res.stop_details));
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const u = res.usage;
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return { text, inTok, outTok: u.output_tokens || 0, stop: res.stop_reason };
}

async function callGemini(m, page) {
  const res = await gemini.models.generateContent({
    model: m.id,
    contents: userPrompt(page),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: SCHEMA,
      maxOutputTokens: 65536,
    },
  });
  const u = res.usageMetadata || {};
  return {
    text: res.text,
    inTok: u.promptTokenCount || 0,
    outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    stop: res.candidates?.[0]?.finishReason,
  };
}

function score(parsed, page) {
  const refs = new Map(parsed.mentions.map((x) => [x.ref, x]));
  const items = [];
  for (const r of parsed.relations) {
    const s = refs.get(r.subject), o = refs.get(r.object);
    items.push({
      kind: "relation", text: `${s?.name ?? r.subject} —${r.predicate}${r.predicate_label ? `(${r.predicate_label})` : ""}→ ${o?.name ?? r.object}`,
      props: r.properties, quote: r.quote, confidence: r.confidence,
      quote_ok: quoteFound(r.quote, page.text),
      refs_ok: !!(s && o),
      surface_ok: !!(s && o && surfaceInQuote(s.surface, r.quote) && surfaceInQuote(o.surface, r.quote)),
    });
  }
  for (const a of parsed.attributes) {
    const e = refs.get(a.entity);
    items.push({
      kind: "attribute", text: `${e?.name ?? a.entity} . ${a.key} = ${a.value}`,
      quote: a.quote, confidence: a.confidence,
      quote_ok: quoteFound(a.quote, page.text),
      refs_ok: !!e,
      surface_ok: !!(e && surfaceInQuote(e.surface, a.quote)),
    });
  }
  return items;
}

async function withRetry(fn, label) {
  let delay = 4000;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.message || e);
      const retry = /429|rate|overloaded|503|500|ECONN|timeout/i.test(msg);
      console.log(`  retry ${label}: ${msg.slice(0, 120)}`);
      if (!retry || i === 3) throw e;
      await sleep(delay); delay *= 2;
    }
  }
}

const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".json")).map((f) => readJSON(path.join(PAGES_DIR, f)));

for (const m of MODELS) {
  const mk = modelKey(m);
  if (only && !mk.includes(only)) continue;
  const dir = path.join(RUNS_DIR, mk);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  console.log(`\n== ${m.label} (${m.id})`);
  for (const page of pages) {
    const out = path.join(dir, `${page.id}.json`);
    if (existsSync(out)) { console.log("  cached", page.id); continue; }
    const t0 = Date.now();
    let rec;
    try {
      const r = await withRetry(() => (m.provider === "anthropic" ? callAnthropic(m, page) : callGemini(m, page)), `${mk}/${page.id}`);
      const ms = Date.now() - t0;
      let parsed = null, parse_error = null;
      try { parsed = JSON.parse(r.text); } catch (e) { parse_error = String(e.message).slice(0, 200); }
      const items = parsed ? score(parsed, page) : [];
      rec = {
        model: m.id, label: m.label, effort: m.effort ?? null, page: page.id, ms,
        inTok: r.inTok, outTok: r.outTok, usd: cost(m.id, r.inTok, r.outTok), stop: r.stop,
        parse_error, n_mentions: parsed?.mentions?.length ?? 0,
        n_relations: parsed?.relations?.length ?? 0, n_attributes: parsed?.attributes?.length ?? 0,
        n_other_types: parsed?.mentions?.filter((x) => x.type === "other").length ?? 0,
        n_other_preds: parsed?.relations?.filter((x) => x.predicate === "other").length ?? 0,
        items, raw: parsed,
      };
      const qok = items.filter((i) => i.quote_ok).length;
      console.log(`  ${page.id.padEnd(12)} ${String(ms).padStart(6)}ms  $${rec.usd.toFixed(4)}  rel=${rec.n_relations} attr=${rec.n_attributes}  quote_ok=${qok}/${items.length}${parse_error ? "  PARSE_ERROR" : ""}`);
    } catch (e) {
      rec = { model: m.id, label: m.label, page: page.id, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 500), items: [] };
      console.log(`  ${page.id.padEnd(12)} ERROR ${rec.error.slice(0, 100)}`);
    }
    writeJSON(out, rec);
  }
}
