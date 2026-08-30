// Rules as data: loaded from YAML (packages/knowledge/rules/*.yaml) into the `rules` table, evaluated
// against an entity's view to open slots. The evaluator is deliberately tiny; richer patterns arrive with
// the Datalog layer (model §4.2). Adding a rule = adding a YAML entry.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface RuleWhen { type: string; kind?: string; has_predicate?: string; has_attribute?: string; lacks_predicate?: string; lacks_attribute?: string }
export interface SlotSpec { kind: "predicate" | "attribute" | "record_class" | "indicator"; key: string; expectedness?: "mandatory" | "usual" | "possible"; covering?: boolean; note?: string; capability?: string }
export interface Rule { id: string; kind: "shape" | "expected_record" | "derivation" | "lead" | "anomaly" | "hypothesis"; name: string; when: RuleWhen; then: { slot?: SlotSpec }; confidence?: number; enabled?: boolean; note?: string }

export interface EntityView { id: string; type: string; kind: string | null; predicates: Set<string>; attributes: Set<string> }

const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../rules");

export function loadRuleFiles(dir = RULES_DIR): Rule[] {
  const out: Rule[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()) {
    const rows = parseYaml(readFileSync(path.join(dir, f), "utf8")) as Rule[];
    for (const r of rows) out.push({ enabled: true, confidence: 1, ...r });
  }
  const ids = new Set<string>();
  for (const r of out) { if (ids.has(r.id)) throw new Error(`duplicate rule id ${r.id}`); ids.add(r.id); }
  return out;
}

export function ruleMatches(rule: Rule, e: EntityView): boolean {
  const w = rule.when;
  if (w.type !== "*" && w.type !== e.type) return false;
  if (w.kind && w.kind !== e.kind) return false;
  if (w.has_predicate && !e.predicates.has(w.has_predicate)) return false;
  if (w.lacks_predicate && e.predicates.has(w.lacks_predicate)) return false;
  if (w.has_attribute && !e.attributes.has(w.has_attribute)) return false;
  if (w.lacks_attribute && e.attributes.has(w.lacks_attribute)) return false;
  return true;
}

/** Slots a set of rules opens for an entity (does not consult existing slot statuses). */
export function slotsFor(rules: Rule[], e: EntityView): { rule: Rule; slot: SlotSpec }[] {
  const out: { rule: Rule; slot: SlotSpec }[] = [];
  for (const r of rules) if (r.enabled !== false && r.then.slot && ruleMatches(r, e)) out.push({ rule: r, slot: r.then.slot });
  return out;
}
