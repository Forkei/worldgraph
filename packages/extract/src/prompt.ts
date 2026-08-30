// Extraction prompt v2 (INVESTIGATION_MODEL §7 door 1; M1_DESIGN §2 rules). Stable, cacheable system prefix
// generated from the registry; investigation context in a second block; the chunk in the user turn.
import { createHash } from "node:crypto";
import type { Registry } from "@worldgraph/core";

export function systemPrompt(registry: Registry): string {
  return `You extract a knowledge graph from one chunk of one web page (or document, or media transcript) for an investigation tool.

Output four things:
- mentions: every distinct thing the text names that could matter to an investigator (people, organizations, places, events, documents, accounts, artifacts, assets, positions, credentials, legal matters, transactions). "surface" is the exact wording in the text ("Mrs Doe", "the company", "she"); "name" is your best full canonical name for what is meant ("Jane Doe", "Acme Corp"). "kind" is the subtype if the text makes it clear. Put identity hints in hints (email, phone, handle, url, org, location, dob, registry ids...). If no type fits, use type "candidate" with a short type_label and the closest type_parent.
- relations: links between two mentions. Use the MOST SPECIFIC predicate that fits (works_at rather than member_of; board_member rather than works_at; parent_of rather than related_to). Put roles, titles, amounts, shares, capacities in qualifiers as key/value pairs — never in the predicate name. If no predicate fits, use predicate "candidate" with a snake_case candidate_label and the closest candidate_parent; never use associated_with directly.
- attributes: facts about ONE thing that are not links (date_of_birth, nationality, status, website, registry_id "scheme:value", follower_count, description...). Use a listed key when one fits; otherwise a new snake_case key with key_parent.
- page: published_at (EDTF if the page states a date, else empty) and a one-sentence summary.

Time, on every relation and attribute:
- temporal_kind: interval (true for a period: works_at, lives_at, owns, spouse_of), instant (a point event: participated_in, paid, created), snapshot (an observation at a time: title, follower_count, status, description), timeless (date_of_birth, founded_on, registry_id).
- valid_from / valid_to / date: EDTF exactly as the text supports it — 2019, 2019-05, 2019-05-16, 2019~ (approximate), 2019? (uncertain), [1984,1985] (one of). Empty when the text gives nothing; never invent. An interval that is ongoing has empty valid_to.
- time_qualifier: exact | circa | before | after | unknown.
- NEVER emit derived quantities. "age 34" → attribute date_of_birth with value [YYYY-35,YYYY-34] relative to the page date, derivation "age_at_date". "10 years at Acme" → valid_from ≈ page year − 10 with time_qualifier circa, derivation "duration". "former" / "previously" → valid_to unknown but before the page date (time_qualifier before).
- inferred: true when you concluded something the text does not state outright; false when the text states it.

Rules:
1. Only what the text states. Do not infer across sentences unless the connective is explicit; if you do infer, mark inferred: true.
2. Every relation and attribute carries a verbatim quote copied exactly from the text (max 300 chars) that supports it. It must be findable character for character (whitespace and punctuation aside). Do not stitch words from different places, add commas, or paraphrase. Pronouns or partial names inside the quote are fine as long as "name" says who is meant.
3. Be complete: every relation and attribute the text supports, including minor ones. Skip navigation, boilerplate, site chrome.
4. confidence is 0..1 for how clearly the text supports the item (it is recorded, not used for ranking).
5. attribute_class per the classes below; choose the more protective class when in doubt; anything identifying a minor is restricted.
6. Tables and rosters: one relation or attribute per row; the quote is the row text.

${registry.promptGuide()}`;
}

export function promptVersion(registry: Registry): string {
  return createHash("sha256").update(systemPrompt(registry)).update(registry.hash).digest("hex").slice(0, 12);
}

export interface PageContext { url: string; title: string | null; published_at: string | null; chunk_index: number; chunk_count: number }
export interface InvestigationContext { seed: { kind: string; name: string; hints?: Record<string, string> }; goal_text: string }

export function contextBlock(inv: InvestigationContext): string {
  const hints = Object.entries(inv.seed.hints ?? {}).map(([k, v]) => `${k}: ${v}`).join("; ");
  return `INVESTIGATION CONTEXT
Focus: ${inv.seed.name} (${inv.seed.kind})${hints ? ` — ${hints}` : ""}
Goal: ${inv.goal_text}
Extract everything the page supports, not only facts about the focus; never drop a fact about the focus.`;
}

export function userPrompt(page: PageContext, chunkText: string): string {
  const head = [`URL: ${page.url}`, `TITLE: ${page.title ?? ""}`];
  if (page.published_at) head.push(`PAGE DATE: ${page.published_at}`);
  if (page.chunk_count > 1) head.push(`CHUNK: ${page.chunk_index + 1} of ${page.chunk_count}`);
  return `${head.join("\n")}\n\n<text>\n${chunkText}\n</text>`;
}
