// Extraction prompt (§6.2). The system prompt is stable (cache-friendly) and generated from the
// ontology registry; investigation context goes in a second system block; the chunk in the user turn.
import { createHash } from "node:crypto";
import type { Registry } from "@worldgraph/core";

export function systemPrompt(registry: Registry): string {
  return `You extract a knowledge graph from one chunk of one web page for an investigation tool.

Output three lists plus a page note:
- mentions: every distinct person, organization, place, event, document, account, artifact, credential, legal matter, money flow, or other thing the text names and that could matter to an investigator. "surface" is the exact wording used in the text ("Mrs Doe", "the company", "she"); "name" is your best full canonical name for what is meant ("Jane Doe", "Acme Corp"). Put identity hints in hints (email, phone, handle, url, org, location, role, dob...). Use type "other" with a type_label when nothing fits.
- relations: links between two mentions. Use the most specific predicate; "associated_with" only when nothing else fits; "other" with a predicate_label when the relationship is real but not in the list. Put role, dates (ISO where possible, plus date_precision = year|month|day), amounts, etc. in properties as key/value pairs.
- attributes: facts about one mention that are not links (age, birth date, title, nationality, phone, address text, counts, prices, descriptions...). datatype describes the value.
- page: published_at if the page states a date (ISO, else empty string) and a one-sentence summary of what the page is.

Rules:
1. Only what the text states. Do not infer across sentences unless the connective is explicit.
2. Every relation and attribute carries a verbatim quote copied exactly from the text (max 300 chars) that supports it. The quote must be findable in the text character for character (whitespace and punctuation aside). Do not stitch words from different places; do not add commas or words. Pronouns or partial names inside the quote are fine as long as the mention's "name" says who is meant.
3. Be complete: extract every relation and attribute the text supports, including minor ones. Skip navigation, boilerplate, and site chrome.
4. confidence is 0..1 for how clearly the text supports the item.
5. attribute_class: tag each relation and attribute using the classes below. When in doubt, choose the more protective class.

${registry.promptGuide()}`;
}

export function promptVersion(registry: Registry): string {
  return createHash("sha256").update(systemPrompt(registry)).update(registry.hash).digest("hex").slice(0, 12);
}

export interface PageContext {
  url: string;
  title: string | null;
  published_at: string | null;
  chunk_index: number;
  chunk_count: number;
}
export interface InvestigationContext {
  seed: { kind: string; name: string; hints?: Record<string, string> };
  goal_text: string;
}

export function contextBlock(inv: InvestigationContext): string {
  const hints = Object.entries(inv.seed.hints ?? {}).map(([k, v]) => `${k}: ${v}`).join("; ");
  return `INVESTIGATION CONTEXT
Focus: ${inv.seed.name} (${inv.seed.kind})${hints ? ` — ${hints}` : ""}
Goal: ${inv.goal_text}
Extract everything the page supports, not only facts about the focus; but never drop a fact about the focus.`;
}

export function userPrompt(page: PageContext, chunkText: string): string {
  const head = [`URL: ${page.url}`, `TITLE: ${page.title ?? ""}`];
  if (page.published_at) head.push(`PUBLISHED: ${page.published_at}`);
  if (page.chunk_count > 1) head.push(`CHUNK: ${page.chunk_index + 1} of ${page.chunk_count}`);
  return `${head.join("\n")}\n\n<text>\n${chunkText}\n</text>`;
}
