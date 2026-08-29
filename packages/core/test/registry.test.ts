import { describe, it, expect } from "vitest";
import { Registry, registry } from "../src/ontology/registry.ts";

describe("ontology registry", () => {
  const r = registry();

  it("loads node types and predicates from YAML", () => {
    expect(r.nodeTypes.person).toBeDefined();
    expect(r.predicates.works_at?.inverse).toBe("employs");
    expect(r.hash).toHaveLength(12);
  });

  it("excludes derived/system predicates from extraction", () => {
    expect(r.extractablePredicates).toContain("works_at");
    expect(r.extractablePredicates).not.toContain("adjacent_to");
    expect(r.extractablePredicates).not.toContain("same_as");
  });

  it("validates domain/range and lets `other` through", () => {
    expect(r.validateRelation("person", "works_at", "organization").ok).toBe(true);
    expect(r.validateRelation("organization", "works_at", "person").ok).toBe(false);
    expect(r.validateRelation("other", "works_at", "organization").ok).toBe(true);
    expect(r.validateRelation("person", "other", "place").ok).toBe(true);
    expect(r.validateRelation("person", "adjacent_to", "place").ok).toBe(false);
  });

  it("renders a strict JSON schema with registry enums", () => {
    const s = r.extractionJsonSchema() as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.relations.items.properties.predicate.enum).toEqual(r.extractablePredicates);
    expect(s.properties.mentions.items.properties.type.enum).toContain("other");
  });

  it("renders a prompt guide mentioning every extractable predicate", () => {
    const g = r.promptGuide();
    for (const p of r.extractablePredicates) expect(g).toContain(`- ${p}:`);
  });

  it("rejects a predicate referencing an unknown node type", () => {
    expect(() => new Registry({
      nodeTypes: { person: { label: "P" } },
      predicates: { x: { inverse: "y", domain: ["person"], range: ["ghost"] } },
      attributeClasses: { restricted: [], sensitive: [], public: [] },
    })).toThrow(/unknown node type/);
  });
});
