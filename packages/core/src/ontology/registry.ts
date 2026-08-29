// Ontology registry: loads the YAML files in this directory, validates them, and derives everything the
// pipeline needs from them (extraction JSON schema, prompt guide, domain/range validation, inverses).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));

const NodeTypeSpec = z.object({
  label: z.string(),
  subtypes: z.array(z.string()).default([]),
  identity_keys: z.array(z.string()).default([]),
  geocodable: z.boolean().default(false),
  description: z.string().optional(),
});
const PredicateSpec = z.object({
  inverse: z.string(),
  domain: z.array(z.string()),
  range: z.array(z.string()),
  props: z.array(z.string()).default([]),
  attribute_class: z.enum(["public", "sensitive", "restricted"]).default("public"),
  transitive: z.boolean().default(false),
  derived: z.boolean().default(false),
  system: z.boolean().default(false),
  description: z.string().optional(),
});
const AttributeClasses = z.object({
  restricted: z.array(z.string()),
  sensitive: z.array(z.string()),
  public: z.array(z.string()),
});

export type NodeTypeSpec = z.infer<typeof NodeTypeSpec>;
export type PredicateSpec = z.infer<typeof PredicateSpec>;
export type AttributeClass = "public" | "sensitive" | "restricted";
export const ATTRIBUTE_CLASSES: readonly AttributeClass[] = ["public", "sensitive", "restricted"];
export const DATATYPES = ["string", "number", "date", "date_range", "url", "email", "phone", "money", "geo"] as const;
export type Datatype = (typeof DATATYPES)[number];

export type Violation = { ok: false; reason: string } | { ok: true };

export class Registry {
  readonly nodeTypes: Record<string, NodeTypeSpec>;
  readonly predicates: Record<string, PredicateSpec>;
  readonly attributeClasses: z.infer<typeof AttributeClasses>;
  /** Hash of the loaded ontology; part of the extraction prompt version. */
  readonly hash: string;

  constructor(raw: { nodeTypes: unknown; predicates: unknown; attributeClasses: unknown }) {
    this.nodeTypes = z.record(z.string(), NodeTypeSpec).parse(raw.nodeTypes);
    this.predicates = z.record(z.string(), PredicateSpec).parse(raw.predicates);
    this.attributeClasses = AttributeClasses.parse(raw.attributeClasses);
    for (const [p, spec] of Object.entries(this.predicates)) {
      for (const t of [...spec.domain, ...spec.range]) {
        if (t !== "*" && !this.nodeTypes[t]) throw new Error(`predicate ${p}: unknown node type ${t}`);
      }
    }
    this.hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 12);
  }

  static load(dir = here): Registry {
    const read = (f: string) => parseYaml(readFileSync(path.join(dir, f), "utf8"));
    return new Registry({
      nodeTypes: read("node_types.yaml"),
      predicates: read("predicates.yaml"),
      attributeClasses: read("attribute_classes.yaml"),
    });
  }

  /** Node types the extractor may emit (all non-system types). */
  get extractableNodeTypes(): string[] {
    return Object.keys(this.nodeTypes);
  }
  /** Predicates the extractor may emit (not derived, not system). */
  get extractablePredicates(): string[] {
    return Object.entries(this.predicates)
      .filter(([, s]) => !s.derived && !s.system)
      .map(([k]) => k);
  }

  inverse(predicate: string): string {
    return this.predicates[predicate]?.inverse ?? predicate;
  }

  /** Domain/range check. `other` on either side is always allowed (open ontology). */
  validateRelation(subjectType: string, predicate: string, objectType: string): Violation {
    const spec = this.predicates[predicate];
    if (!spec) return { ok: false, reason: `unknown predicate ${predicate}` };
    if (spec.derived || spec.system) return { ok: false, reason: `predicate ${predicate} is not extractable` };
    const okType = (allowed: string[], t: string) => t === "other" || allowed.includes("*") || allowed.includes(t);
    if (!okType(spec.domain, subjectType)) return { ok: false, reason: `domain: ${subjectType} cannot be subject of ${predicate}` };
    if (!okType(spec.range, objectType)) return { ok: false, reason: `range: ${objectType} cannot be object of ${predicate}` };
    return { ok: true };
  }

  /** Governance floor for a predicate. */
  attributeClassFloor(predicate: string): AttributeClass {
    return this.predicates[predicate]?.attribute_class ?? "public";
  }

  /** JSON schema (strict: additionalProperties false, all required) for the extractor's structured output. */
  extractionJsonSchema(): Record<string, unknown> {
    const kv = {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false,
    };
    const attrClass = { type: "string", enum: [...ATTRIBUTE_CLASSES] };
    return {
      type: "object",
      properties: {
        mentions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "short local handle, e.g. m1, m2" },
              surface: { type: "string", description: "exactly as written in the text" },
              name: { type: "string", description: "best full canonical name for who/what is meant" },
              type: { type: "string", enum: this.extractableNodeTypes },
              type_label: { type: "string", description: "free text when type is other, else empty string" },
              hints: { type: "array", items: kv, description: "identity hints: email, phone, handle, url, org, location, role, ..." },
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
              predicate: { type: "string", enum: this.extractablePredicates },
              predicate_label: { type: "string", description: "free text when predicate is other, else empty string" },
              object: { type: "string", description: "mention ref" },
              properties: { type: "array", items: kv },
              quote: { type: "string", description: "verbatim text from the page supporting this, max 300 chars" },
              confidence: { type: "number" },
              attribute_class: attrClass,
            },
            required: ["subject", "predicate", "predicate_label", "object", "properties", "quote", "confidence", "attribute_class"],
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
              datatype: { type: "string", enum: [...DATATYPES] },
              properties: { type: "array", items: kv },
              quote: { type: "string", description: "verbatim text from the page supporting this, max 300 chars" },
              confidence: { type: "number" },
              attribute_class: attrClass,
            },
            required: ["entity", "key", "value", "datatype", "properties", "quote", "confidence", "attribute_class"],
            additionalProperties: false,
          },
        },
        page: {
          type: "object",
          properties: {
            published_at: { type: "string", description: "ISO date if the page states one, else empty string" },
            summary: { type: "string", description: "one sentence: what this page is" },
          },
          required: ["published_at", "summary"],
          additionalProperties: false,
        },
      },
      required: ["mentions", "relations", "attributes", "page"],
      additionalProperties: false,
    };
  }

  /** Human-readable guide rendered into the extraction system prompt. */
  promptGuide(): string {
    const lines: string[] = [];
    lines.push("NODE TYPES:");
    for (const [k, s] of Object.entries(this.nodeTypes)) {
      const sub = s.subtypes.length ? ` (${s.subtypes.join(", ")})` : "";
      lines.push(`- ${k}${sub}${s.description ? ` — ${s.description}` : ""}`);
    }
    lines.push("", "PREDICATES (subject → object):");
    for (const p of this.extractablePredicates) {
      const s = this.predicates[p]!;
      const props = s.props.length ? ` props: ${s.props.join(", ")}` : "";
      lines.push(`- ${p}: ${s.domain.join("|")} → ${s.range.join("|")}${props}${s.description ? ` — ${s.description}` : ""}`);
    }
    lines.push("", "ATTRIBUTE CLASSES (tag each item):");
    lines.push(`- restricted: ${this.attributeClasses.restricted.join(", ")}`);
    lines.push(`- sensitive: ${this.attributeClasses.sensitive.join(", ")}`);
    lines.push(`- public: everything else (${this.attributeClasses.public.join(", ")}, ...)`);
    return lines.join("\n");
  }
}

let cached: Registry | null = null;
export function registry(): Registry {
  return (cached ??= Registry.load());
}
