// LLM door 3 (model §7): judge an ambiguous identity pair. The graph poses the question with both sides'
// evidence; the model returns a categorical verdict with a reason — never a probability, never an assertion
// the graph didn't ask for. A different model family from the extractor, so errors don't correlate.
import { callModel, getModel, type ModelSpec } from "./providers.ts";

export interface Side {
  name: string; type: string; kind: string | null; aliases: string[]; keys: Record<string, string[]>;
  facts: string[];        // "works_at ACORN {General Partner} 2018→ (acorncap.com)" …
  quotes: string[];       // up to 3 verbatim quotes with their source domain
}
export interface Verdict { verdict: "same" | "different" | "related" | "unsure"; related_kind: string; reason: string; decisive_evidence: string }

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["same", "different", "related", "unsure"] },
    related_kind: { type: "string", description: "when related, phrased from A's side: manages (A manages B) | part_of (A is part of B) | parent (A is the parent of B) | subsidiary (A is a subsidiary of B) | sibling | namesake (same name, unrelated) | alias (two names for one thing); else empty" },
    reason: { type: "string", description: "one or two sentences" },
    decisive_evidence: { type: "string", description: "the single fact or quote that decided it; empty if unsure" },
  },
  required: ["verdict", "related_kind", "reason", "decisive_evidence"],
  additionalProperties: false,
};

const SYSTEM = `You judge whether two records from different web pages refer to the SAME real-world thing. Rules, in order:
1. A name alone is never identity. Two people with the same name are different unless something else lines up: a shared identifier (email, handle, URL, licence, registry id), the same employer or organization in the same period, the same city, the same role, co-mentioned people, or one page explicitly referencing the other.
2. Only HARD contradictions decide 'different': different identifiers of the same kind, different birth years, being in two distant places at the same time. Differences in role, seniority, title, interests, or writing style are NOT contradictions — a student can also be a 'Chief AI Engineer' in a bio, an athlete can also be a developer, a person's profile pages describe different facets of one life. Do not reason from what seems likely for an age or a job.
3. Organizations: a brand and its legal entity ("ACORN" / "Acorn Capital Management LP"), a fund and its manager, a school and its university are RELATED, not the same — say related and name the kind. Numbered vehicles in a series (Fund II / Fund III) are siblings.
4. If the evidence is thin on both sides, say unsure — do not guess. Unsure is a good answer.
Judge only from the evidence given. Keep the reason short and cite the decisive fact.`;

export async function judgePair(a: Side, b: Side, model: ModelSpec = getModel("haiku-4-5")): Promise<{ v: Verdict; usd: number }> {
  const side = (s: Side, label: string) => [
    `${label}: ${s.name} [${s.type}${s.kind ? "/" + s.kind : ""}]`,
    s.aliases.length ? `  also written: ${s.aliases.join(" | ")}` : "",
    Object.keys(s.keys).length ? `  identifiers: ${Object.entries(s.keys).map(([k, v]) => `${k}=${v.join(",")}`).join("  ")}` : "  identifiers: none",
    s.facts.length ? `  facts:\n    ${s.facts.slice(0, 14).join("\n    ")}` : "  facts: none",
    s.quotes.length ? `  quotes:\n    ${s.quotes.slice(0, 3).map((q) => `“${q}”`).join("\n    ")}` : "",
  ].filter(Boolean).join("\n");
  const user = `${side(a, "A")}\n\n${side(b, "B")}\n\nAre A and B the same ${a.type}?`;
  const r = await callModel(model, { system: [SYSTEM], user, schema: SCHEMA, maxOutputTokens: 1200 });
  const v = JSON.parse(r.text) as Verdict;
  return { v, usd: r.usd };
}
