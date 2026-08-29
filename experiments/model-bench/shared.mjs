// Shared config for the model benchmark: env, prices, the extraction schema + prompt, quote validation.
import { config } from "dotenv";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
// Keys live in a shared .env (set WG_KEYS_ENV to point at it); we read them, never copy them.
config({ path: process.env.WG_KEYS_ENV ?? path.join(here, "../../.env"), quiet: true });

export const PAGES_DIR = path.join(here, "pages");
export const RUNS_DIR = path.join(here, "runs");
for (const d of [PAGES_DIR, RUNS_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

export const MAX_CHARS = 24_000; // ~6k tokens: one chunk per page, same for every model

// USD per 1M tokens (input, output). Output includes thinking tokens for both providers.
export const PRICES = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
  "gemini-3.7-flash": [0.75, 3.75],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-3.1-pro-preview": [2, 12],
  "gemini-2.5-flash": [0.3, 2.5],
};
export const cost = (model, inTok, outTok) => {
  const [i, o] = PRICES[model];
  return (inTok * i + outTok * o) / 1e6;
};

export const MODELS = [
  { id: "claude-haiku-4-5", provider: "anthropic", label: "Haiku 4.5" },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Sonnet 5 (low)", effort: "low" },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Sonnet 5 (medium)", effort: "medium" },
  { id: "claude-opus-5", provider: "anthropic", label: "Opus 5 (low)", effort: "low" },
  { id: "gemini-3.7-flash", provider: "gemini", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.5-flash-lite", provider: "gemini", label: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.1-pro-preview", provider: "gemini", label: "Gemini 3.1 Pro" },
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash" },
];
export const modelKey = (m) => m.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export const NODE_TYPES = ["person", "organization", "place", "event", "document", "account", "artifact", "credential", "legal_matter", "money_flow", "other"];
export const PREDICATES = ["works_at", "studied_at", "lives_at", "located_in", "related_to", "associated_with", "participated_in", "authored", "mentions", "owns", "member_of", "funded", "other"];
export const DATATYPES = ["string", "number", "date", "date_range", "url", "email", "phone", "money", "geo"];

const kv = { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"], additionalProperties: false };
export const SCHEMA = {
  type: "object",
  properties: {
    mentions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: { type: "string", description: "short local handle, e.g. m1" },
          surface: { type: "string", description: "exactly as written in the text" },
          name: { type: "string", description: "best full canonical name for who/what is meant" },
          type: { type: "string", enum: NODE_TYPES },
          type_label: { type: "string", description: "free text when type is other, else empty" },
          hints: { type: "array", items: kv },
        },
        required: ["ref", "surface", "name", "type", "type_label", "hints"],
        additionalProperties: false,
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject: { type: "string", description: "mention ref" },
          predicate: { type: "string", enum: PREDICATES },
          predicate_label: { type: "string", description: "free text when predicate is other, else empty" },
          object: { type: "string", description: "mention ref" },
          properties: { type: "array", items: kv },
          quote: { type: "string", description: "verbatim sentence(s) from the text supporting this, max 300 chars" },
          confidence: { type: "number" },
        },
        required: ["subject", "predicate", "predicate_label", "object", "properties", "quote", "confidence"],
        additionalProperties: false,
      },
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity: { type: "string", description: "mention ref" },
          key: { type: "string" },
          value: { type: "string" },
          datatype: { type: "string", enum: DATATYPES },
          quote: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["entity", "key", "value", "datatype", "quote", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["mentions", "relations", "attributes"],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You extract a knowledge graph from one web page for an investigation tool.

Output three lists:
- mentions: every distinct person, organization, place, event, document, account, artifact, credential, legal matter, or money flow that the text names and that matters. "surface" is the exact wording in the text ("Mrs Doe", "the company"); "name" is your best full canonical name for what is meant ("Jane Doe", "Acme Corp"). Use type "other" with a type_label when nothing fits.
- relations: links between two mentions. Use the most specific predicate; "associated_with" only when nothing else fits; "other" with a predicate_label when the relationship is real but not in the list. Put role, dates (ISO, plus precision), amounts, etc. in properties as key/value pairs.
- attributes: facts about one mention that are not links (age, birth date, title, nationality, phone, bio facts, counts, prices...).

Rules:
1. Only what the text states. Do not infer across sentences unless the connective is explicit.
2. Every relation and attribute carries a verbatim quote copied exactly from the text (max 300 chars) that supports it. The quote must be findable in the text character for character (whitespace aside). Pronouns or partial names in the quote are fine as long as the mention's "name" says who is meant.
3. Be complete: extract every relation and attribute the text supports, including minor ones. Skip navigation, boilerplate, and site chrome.
4. confidence is 0..1 for how clearly the text supports the item.`;

export const userPrompt = (page) =>
  `URL: ${page.url}\nTITLE: ${page.title}\n${page.published_at ? `PUBLISHED: ${page.published_at}\n` : ""}\n<text>\n${page.text}\n</text>`;

// ---- quote validation (the same gate M0 will use, minus fuzzy fallback) ----
// Markdown \u2192 plain text the way a reader sees it: drop images, keep link text, drop URLs/escapes.
export function plain(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")          // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")         // [text](url) \u2192 text
    .replace(/<[^>]+>/g, " ")                         // html tags
    .replace(/\\/g, "")                               // markdown escapes
    .replace(/[*_`#>|]/g, " ");                        // emphasis/heading/table chrome
}
// Comparison form: unicode-normalized, lowercase, punctuation-insensitive, single-spaced.
export function norm(s) {
  return plain(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function quoteFound(quote, text) {
  const q = norm(quote);
  if (q.length < 8) return false;
  return norm(text).includes(q);
}
export function surfaceInQuote(surface, quote) {
  const s = norm(surface);
  return s.length > 0 && norm(quote).includes(s);
}

export const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
export const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
