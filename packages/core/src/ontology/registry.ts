// Ontology registry v2: node types, a predicate hierarchy, attribute keys, attribute classes — all loaded
// from YAML in this directory. Derives everything the pipeline needs: extraction JSON schema, prompt guide,
// candidate resolution (candidate:<name> + parent → parent + predicate_specific), domain/range validation,
// ancestor closure, inverses.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ATTRIBUTE_CLASSES = ["public", "sensitive", "restricted"] as const;
export type AttributeClass = (typeof ATTRIBUTE_CLASSES)[number];
export const DATATYPES = ["string", "number", "date", "date_range", "url", "email", "phone", "money", "geo"] as const;
export type Datatype = (typeof DATATYPES)[number];
export const TEMPORAL_KINDS = ["interval", "instant", "snapshot", "timeless"] as const;
export type TemporalKind = (typeof TEMPORAL_KINDS)[number];
export const TIME_QUALIFIERS = ["exact", "circa", "before", "after", "unknown"] as const;
export type TimeQualifier = (typeof TIME_QUALIFIERS)[number];

const NodeTypeSpec = z.object({
  label: z.string(),
  kinds: z.array(z.string()).default([]),
  identity_keys: z.array(z.string()).default([]),
  geocodable: z.boolean().default(false),
  description: z.string().optional(),
});
const PredicateSpec = z.object({
  parent: z.string().optional(),
  inverse: z.string(),
  domain: z.array(z.string()),
  range: z.array(z.string()),
  qualifiers: z.array(z.string()).default([]),
  attribute_class: z.enum(ATTRIBUTE_CLASSES).default("public"),
  symmetric: z.boolean().default(false),
  transitive: z.boolean().default(false),
  emittable: z.boolean().default(true),
  derived: z.boolean().default(false),
  system: z.boolean().default(false),
  description: z.string().optional(),
});
const AttributeKeySpec = z.object({
  datatype: z.enum(DATATYPES),
  temporal_kind: z.enum(TEMPORAL_KINDS),
  attribute_class: z.enum(ATTRIBUTE_CLASSES).default("public"),
  parent: z.string().optional(),
  description: z.string().optional(),
});
const AttributeClasses = z.object({ restricted: z.array(z.string()), sensitive: z.array(z.string()), public: z.array(z.string()) });

export type NodeTypeSpec = z.infer<typeof NodeTypeSpec>;
export type PredicateSpec = z.infer<typeof PredicateSpec>;
export type AttributeKeySpec = z.infer<typeof AttributeKeySpec>;
export type Violation = { ok: true } | { ok: false; reason: string };

export const CANDIDATE_PREFIX = "candidate:";

export class Registry {
  readonly nodeTypes: Record<string, NodeTypeSpec>;
  readonly predicates: Record<string, PredicateSpec>;
  readonly attributeKeys: Record<string, AttributeKeySpec>;
  readonly attributeClasses: z.infer<typeof AttributeClasses>;
  /** ancestors[p] = [parent, grandparent, ...] up to the root */
  readonly ancestors: Record<string, string[]>;
  readonly hash: string;

  constructor(raw: { nodeTypes: unknown; predicates: unknown; attributeKeys: unknown; attributeClasses: unknown }) {
    this.nodeTypes = z.record(z.string(), NodeTypeSpec).parse(raw.nodeTypes);
    this.predicates = z.record(z.string(), PredicateSpec).parse(raw.predicates);
    this.attributeKeys = z.record(z.string(), AttributeKeySpec).parse(raw.attributeKeys);
    this.attributeClasses = AttributeClasses.parse(raw.attributeClasses);
    const roots = Object.entries(this.predicates).filter(([, s]) => !s.parent);
    if (roots.length !== 1) throw new Error(`predicates must have exactly one root, found ${roots.map(([k]) => k).join(", ")}`);
    this.ancestors = {};
    for (const [p, spec] of Object.entries(this.predicates)) {
      for (const t of [...spec.domain, ...spec.range]) if (t !== "*" && !this.nodeTypes[t]) throw new Error(`predicate ${p}: unknown node type ${t}`);
      const chain: string[] = [];
      let cur = spec.parent;
      while (cur) {
        if (!this.predicates[cur]) throw new Error(`predicate ${p}: unknown parent ${cur}`);
        if (chain.includes(cur)) throw new Error(`predicate ${p}: cycle via ${cur}`);
        chain.push(cur);
        cur = this.predicates[cur]!.parent;
      }
      if (chain.length > 3) throw new Error(`predicate ${p}: hierarchy deeper than 3 (${chain.join(" > ")})`);
      this.ancestors[p] = chain;
    }
    for (const [k, spec] of Object.entries(this.attributeKeys)) if (spec.parent && !this.attributeKeys[spec.parent]) throw new Error(`attribute key ${k}: unknown parent ${spec.parent}`);
    this.hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 12);
  }

  static load(dir = here): Registry {
    const read = (f: string) => parseYaml(readFileSync(path.join(dir, f), "utf8"));
    return new Registry({ nodeTypes: read("node_types.yaml"), predicates: read("predicates.yaml"), attributeKeys: read("attribute_keys.yaml"), attributeClasses: read("attribute_classes.yaml") });
  }

  get root(): string { return Object.entries(this.predicates).find(([, s]) => !s.parent)![0]; }
  get nodeTypeNames(): string[] { return Object.keys(this.nodeTypes); }
  /** Predicates the extractor may emit: not derived, not system, emittable. */
  get extractablePredicates(): string[] {
    return Object.entries(this.predicates).filter(([, s]) => !s.derived && !s.system && s.emittable).map(([k]) => k);
  }
  get attributeKeyNames(): string[] { return Object.keys(this.attributeKeys); }

  inverse(predicate: string): string { return this.predicates[predicate]?.inverse ?? predicate; }
  isA(predicate: string, ancestor: string): boolean { return predicate === ancestor || (this.ancestors[predicate] ?? []).includes(ancestor); }
  /** All predicates that are `ancestor` or descend from it (for queries at a parent level). */
  descendants(ancestor: string): string[] { return Object.keys(this.predicates).filter((p) => this.isA(p, ancestor)); }

  /**
   * Resolve what the extractor emitted into a stored predicate.
   * - known extractable predicate → itself
   * - "candidate" + label + parent → parent, with specific = candidate:<label>
   * - anything else → root parent `associated_with` with specific = candidate:<raw>, flagged
   */
  resolvePredicate(emitted: string, candidateLabel?: string, candidateParent?: string): { predicate: string; specific: string | null; fallback: boolean } {
    if (this.extractablePredicates.includes(emitted)) return { predicate: emitted, specific: null, fallback: false };
    const label = (candidateLabel || emitted).replace(/^candidate:/, "").trim().toLowerCase().replace(/\s+/g, "_");
    const parent = candidateParent && this.extractablePredicates.includes(candidateParent) ? candidateParent : this.root;
    return { predicate: parent, specific: `${CANDIDATE_PREFIX}${label}`, fallback: parent === this.root };
  }

  /** Same idea for node types: unknown type → parent type (or `document`-less fallback `organization`? no: keep the label, fall back to 'artifact'). */
  resolveNodeType(emitted: string, typeParent?: string): { type: string; label: string | null } {
    if (this.nodeTypes[emitted]) return { type: emitted, label: null };
    const label = emitted.replace(/^candidate:/, "").trim().toLowerCase().replace(/\s+/g, "_");
    return { type: typeParent && this.nodeTypes[typeParent] ? typeParent : "artifact", label: `${CANDIDATE_PREFIX}${label}` };
  }

  /** Attribute keys: known → itself; unknown → candidate:<key> with parent (default `description`). */
  resolveAttributeKey(emitted: string, keyParent?: string): { key: string; specific: string | null; spec: AttributeKeySpec } {
    const norm = emitted.trim().toLowerCase().replace(/\s+/g, "_").replace(/^candidate:/, "");
    if (this.attributeKeys[norm]) return { key: norm, specific: null, spec: this.attributeKeys[norm]! };
    const parent = keyParent && this.attributeKeys[keyParent] ? keyParent : "description";
    return { key: parent, specific: `${CANDIDATE_PREFIX}${norm}`, spec: this.attributeKeys[parent]! };
  }

  validateRelation(subjectType: string, predicate: string, objectType: string): Violation {
    const spec = this.predicates[predicate];
    if (!spec) return { ok: false, reason: `unknown predicate ${predicate}` };
    if (spec.derived || spec.system) return { ok: false, reason: `predicate ${predicate} is not extractable` };
    const okType = (allowed: string[], t: string) => allowed.includes("*") || allowed.includes(t);
    if (!okType(spec.domain, subjectType)) return { ok: false, reason: `domain: ${subjectType} cannot be subject of ${predicate}` };
    if (!okType(spec.range, objectType)) return { ok: false, reason: `range: ${objectType} cannot be object of ${predicate}` };
    return { ok: true };
  }

  attributeClassFloor(predicate: string): AttributeClass {
    // floor = the most protective class along the ancestor chain
    const rank: Record<AttributeClass, number> = { public: 0, sensitive: 1, restricted: 2 };
    let best: AttributeClass = "public";
    for (const p of [predicate, ...(this.ancestors[predicate] ?? [])]) {
      const c = this.predicates[p]?.attribute_class ?? "public";
      if (rank[c] > rank[best]) best = c;
    }
    return best;
  }

  /** Strict JSON schema for the extractor's structured output (v2). */
  extractionJsonSchema(): Record<string, unknown> {
    const kv = { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"], additionalProperties: false };
    const attrClass = { type: "string", enum: [...ATTRIBUTE_CLASSES] };
    const time = {
      temporal_kind: { type: "string", enum: [...TEMPORAL_KINDS] },
      valid_from: { type: "string", description: "EDTF as written: 2019 · 2019-05 · 2019-05-16 · 2019~ (circa) · 2019? · [1984,1985] · empty if none" },
      valid_to: { type: "string", description: "EDTF; empty if none or ongoing" },
      date: { type: "string", description: "EDTF point date for instants/snapshots; empty if none" },
      time_qualifier: { type: "string", enum: [...TIME_QUALIFIERS] },
      inferred: { type: "boolean", description: "true if you inferred this rather than the text stating it" },
      derivation: { type: "string", description: "how a derived fact was converted, e.g. age_at_date; empty otherwise" },
    };
    const timeReq = ["temporal_kind", "valid_from", "valid_to", "date", "time_qualifier", "inferred", "derivation"];
    const nodeTypeEnum = [...this.nodeTypeNames, "candidate"];
    const predEnum = [...this.extractablePredicates, "candidate"];
    return {
      type: "object",
      properties: {
        mentions: { type: "array", items: { type: "object", properties: {
          ref: { type: "string" }, surface: { type: "string", description: "exactly as written" }, name: { type: "string", description: "best full canonical name" },
          type: { type: "string", enum: nodeTypeEnum }, type_label: { type: "string", description: "when type=candidate: a short label; else empty" },
          type_parent: { type: "string", enum: this.nodeTypeNames, description: "when type=candidate: the closest existing type" },
          kind: { type: "string", description: "subtype if known (company, city, race…), else empty" },
          hints: { type: "array", items: kv },
        }, required: ["ref", "surface", "name", "type", "type_label", "type_parent", "kind", "hints"], additionalProperties: false } },
        relations: { type: "array", items: { type: "object", properties: {
          subject: { type: "string" }, predicate: { type: "string", enum: predEnum },
          candidate_label: { type: "string", description: "when predicate=candidate: snake_case verb, else empty" },
          candidate_parent: { type: "string", enum: this.extractablePredicates, description: "when predicate=candidate: the closest existing predicate" },
          object: { type: "string" }, qualifiers: { type: "array", items: kv },
          quote: { type: "string", description: "verbatim text supporting this, max 300 chars" }, confidence: { type: "number" }, attribute_class: attrClass, ...time,
        }, required: ["subject", "predicate", "candidate_label", "candidate_parent", "object", "qualifiers", "quote", "confidence", "attribute_class", ...timeReq], additionalProperties: false } },
        attributes: { type: "array", items: { type: "object", properties: {
          entity: { type: "string" }, key: { type: "string", description: `one of ${this.attributeKeyNames.join(", ")} or a new snake_case key` },
          key_parent: { type: "string", enum: this.attributeKeyNames, description: "for a new key: the closest existing key" },
          value: { type: "string" }, datatype: { type: "string", enum: [...DATATYPES] },
          quote: { type: "string" }, confidence: { type: "number" }, attribute_class: attrClass, ...time,
        }, required: ["entity", "key", "key_parent", "value", "datatype", "quote", "confidence", "attribute_class", ...timeReq], additionalProperties: false } },
        page: { type: "object", properties: {
          published_at: { type: "string", description: "EDTF if the page states a date, else empty" },
          summary: { type: "string" },
          publisher_name: { type: "string", description: "who publishes this page (the org, person, or platform whose page it is), as the page itself indicates; a hosted profile's publisher is the PLATFORM, not the profile owner" },
          publisher_kind: { type: "string", enum: ["authority", "self", "independent", "platform", "anonymous", "unknown"], description: "the publisher's relationship to what the page reports: authority = the official/issuing body for this kind of record; self = the page is by the very subject it is about (own site/profile); independent = an independent reporter/witness; platform = a host of others' content (LinkedIn, X, a people-search aggregator); anonymous = unattributable; unknown if unclear" },
        }, required: ["published_at", "summary", "publisher_name", "publisher_kind"], additionalProperties: false },
      },
      required: ["mentions", "relations", "attributes", "page"],
      additionalProperties: false,
    };
  }

  /** Human-readable guide rendered into the system prompt: the tree with qualifiers, node types, attribute keys, classes. */
  promptGuide(): string {
    const lines: string[] = ["NODE TYPES (kind = subtype):"];
    for (const [k, s] of Object.entries(this.nodeTypes)) lines.push(`- ${k}${s.kinds.length ? ` (${s.kinds.join(", ")})` : ""}${s.description ? ` — ${s.description}` : ""}`);
    lines.push("", "PREDICATES (subject → object; indented = more specific kind of the one above; use the most specific that fits):");
    const children = (p: string) => Object.entries(this.predicates).filter(([, s]) => s.parent === p && !s.derived && !s.system).map(([k]) => k);
    const render = (p: string, depth: number) => {
      const s = this.predicates[p]!;
      const q = s.qualifiers.length ? ` {${s.qualifiers.join(", ")}}` : "";
      const emit = s.emittable ? "" : "  (not emittable — choose a child or candidate)";
      lines.push(`${"  ".repeat(depth)}- ${p}: ${s.domain.join("|")} → ${s.range.join("|")}${q}${emit}${s.description ? ` — ${s.description}` : ""}`);
      for (const c of children(p)) render(c, depth + 1);
    };
    render(this.root, 0);
    lines.push("", "ATTRIBUTE KEYS (facts about one thing; key: datatype/temporal_kind):");
    lines.push(Object.entries(this.attributeKeys).map(([k, s]) => `${k} (${s.datatype}/${s.temporal_kind})`).join(", "));
    lines.push("", "ATTRIBUTE CLASSES (tag each item; when in doubt choose the more protective):");
    lines.push(`- restricted: ${this.attributeClasses.restricted.join(", ")}`);
    lines.push(`- sensitive: ${this.attributeClasses.sensitive.join(", ")}`);
    lines.push(`- public: everything else`);
    return lines.join("\n");
  }
}

let cached: Registry | null = null;
export function registry(): Registry { return (cached ??= Registry.load()); }
