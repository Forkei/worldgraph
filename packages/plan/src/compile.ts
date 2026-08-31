// Door 1b — compile a free-text goal into a Question: indicators (what to look for), a stop rule, a kill
// criterion. The model proposes; the graph keeps only predicates/record-classes that exist in the registry
// (unknown → dropped). User-visible and editable. Cheap and re-runnable.
import type { Registry } from "@worldgraph/core";
import { callModel, getModel, type ModelSpec } from "@worldgraph/extract";

export interface Indicator { name: string; predicates: string[]; record_classes: string[]; weight: number }
export interface StopRule { min_independent_on: string[]; mandatory_searched: boolean; stability_actions: number; max_open_contradictions: number }
export interface CompiledQuestion { sought: string; indicators: Indicator[]; kill_criterion: string; stop_rule: StopRule }

const SCHEMA = {
  type: "object",
  properties: {
    sought: { type: "string", description: "one sentence restating what the investigation must establish" },
    indicators: {
      type: "array",
      description: "the handful of things that, if found, answer the question — each a named bundle of predicates/record classes with a weight 0..1",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "short snake_case label, e.g. board_seats" },
          predicates: { type: "array", items: { type: "string" }, description: "predicates from the ontology this indicator is filled by" },
          record_classes: { type: "array", items: { type: "string" }, description: "expected record types (e.g. sec_filing, licence), or empty" },
          weight: { type: "number", description: "0..1 importance to the question" },
        },
        required: ["name", "predicates", "record_classes", "weight"],
        additionalProperties: false,
      },
    },
    kill_criterion: { type: "string", description: "when to abandon the investigation as unanswerable (e.g. the seed can't be verified after mandatory records)" },
    stop_rule: {
      type: "object",
      properties: {
        min_independent_on: { type: "array", items: { type: "string" }, description: "predicates that must reach ≥2 independent origins before stopping" },
        mandatory_searched: { type: "boolean" },
        stability_actions: { type: "number", description: "stop after this many actions with no material change" },
        max_open_contradictions: { type: "number" },
      },
      required: ["min_independent_on", "mandatory_searched", "stability_actions", "max_open_contradictions"],
      additionalProperties: false,
    },
  },
  required: ["sought", "indicators", "kill_criterion", "stop_rule"],
  additionalProperties: false,
};

const SYSTEM = `You compile a free-text investigation goal into a structured Question for a graph-driven OSINT engine.
Return: what is sought (one sentence); INDICATORS — the few things that would answer it, each a named bundle of
ontology predicates (and expected record classes if any) with a weight 0..1; a KILL criterion (when the subject
is unverifiable); a STOP rule (which predicates need ≥2 independent sources, whether mandatory records must be
searched, how many quiet actions end it, how many open contradictions are tolerable).
Use ONLY predicates that exist in the provided ontology. Prefer the most specific predicate. Be concise: 3–6
indicators. Weights reflect how central each is to THIS goal.`;

export async function compileQuestion(
  goal: string,
  subject: { name: string; type: string; dossier?: string },
  registry: Registry,
  templates: Indicator[] = [],
  model: ModelSpec = getModel("gemini-3.7-flash"),
): Promise<{ q: CompiledQuestion; usd: number }> {
  const preds = registry.extractablePredicates;
  const tmpl = templates.length ? `\nINDICATOR TEMPLATES for ${subject.type} (seed from these, adjust weights, add/remove as the goal needs):\n` + templates.map((t) => `- ${t.name}: ${t.predicates.join(", ")}${t.record_classes.length ? " · records: " + t.record_classes.join(", ") : ""} (w ${t.weight})`).join("\n") : "";
  const user = `GOAL: ${goal}\n\nSUBJECT: ${subject.name} (${subject.type})${subject.dossier ? "\n\nWHAT WE ALREADY KNOW:\n" + subject.dossier : ""}\n\nONTOLOGY PREDICATES: ${preds.join(", ")}${tmpl}`;
  const r = await callModel(model, { system: [SYSTEM], user, schema: SCHEMA, maxOutputTokens: 2000 });
  const q = JSON.parse(r.text) as CompiledQuestion;
  const ok = new Set(preds);
  for (const ind of q.indicators) ind.predicates = ind.predicates.filter((p) => ok.has(p));
  q.indicators = q.indicators.filter((ind) => ind.predicates.length || ind.record_classes.length);
  q.stop_rule.min_independent_on = (q.stop_rule.min_independent_on ?? []).filter((p) => ok.has(p));
  return { q, usd: r.usd };
}
