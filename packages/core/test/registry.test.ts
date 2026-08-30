import { describe, it, expect } from "vitest";
import { Registry, registry } from "../src/ontology/registry.ts";

describe("ontology registry v2", () => {
  const r = registry();

  it("loads a single-root hierarchy no deeper than 3", () => {
    expect(r.root).toBe("associated_with");
    expect(r.ancestors.works_at).toEqual(["member_of", "associated_with"]);
    expect(r.ancestors.spouse_of).toEqual(["related_to", "associated_with"]);
    for (const chain of Object.values(r.ancestors)) expect(chain.length).toBeLessThanOrEqual(3);
  });

  it("excludes the root, derived and system predicates from extraction", () => {
    expect(r.extractablePredicates).toContain("works_at");
    expect(r.extractablePredicates).not.toContain("associated_with");
    expect(r.extractablePredicates).not.toContain("adjacent_to");
    expect(r.extractablePredicates).not.toContain("same_as");
  });

  it("answers isA / descendants at any level", () => {
    expect(r.isA("board_member", "member_of")).toBe(true);
    expect(r.isA("board_member", "associated_with")).toBe(true);
    expect(r.isA("paid", "member_of")).toBe(false);
    expect(r.descendants("member_of").sort()).toEqual(["board_member", "member_of", "studied_at", "works_at"]);
  });

  it("resolves candidates to their parent and keeps the label", () => {
    expect(r.resolvePredicate("works_at")).toEqual({ predicate: "works_at", specific: null, fallback: false });
    expect(r.resolvePredicate("candidate", "spinout from", "part_of")).toEqual({ predicate: "part_of", specific: "candidate:spinout_from", fallback: false });
    expect(r.resolvePredicate("mentored", "", "")).toEqual({ predicate: "associated_with", specific: "candidate:mentored", fallback: true });
    expect(r.resolveNodeType("ship", "asset")).toEqual({ type: "asset", label: "candidate:ship" });
    expect(r.resolveAttributeKey("fund_size", "amount")).toMatchObject({ key: "amount", specific: "candidate:fund_size" });
    expect(r.resolveAttributeKey("Date of Birth")).toMatchObject({ key: "date_of_birth", specific: null });
  });

  it("validates domain/range", () => {
    expect(r.validateRelation("person", "works_at", "organization").ok).toBe(true);
    expect(r.validateRelation("organization", "works_at", "person").ok).toBe(false);
    expect(r.validateRelation("person", "same_as", "person").ok).toBe(false);
  });

  it("takes the most protective attribute class along the chain", () => {
    expect(r.attributeClassFloor("spouse_of")).toBe("sensitive");
    expect(r.attributeClassFloor("works_at")).toBe("public");
  });

  it("renders a strict schema whose enums come from the registry", () => {
    const s = r.extractionJsonSchema() as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.relations.items.properties.predicate.enum).toEqual([...r.extractablePredicates, "candidate"]);
    expect(s.properties.relations.items.required).toContain("temporal_kind");
    expect(s.properties.mentions.items.properties.type.enum).toContain("candidate");
  });

  it("renders the tree in the prompt guide", () => {
    const g = r.promptGuide();
    expect(g).toContain("- associated_with:");
    expect(g).toContain("  - member_of:");
    expect(g).toContain("    - works_at:");
  });

  it("rejects bad hierarchies", () => {
    const base = { attributeKeys: { description: { datatype: "string", temporal_kind: "snapshot" } }, attributeClasses: { restricted: [], sensitive: [], public: [] } };
    expect(() => new Registry({ ...base, nodeTypes: { person: { label: "P" } }, predicates: { a: { inverse: "a", domain: ["person"], range: ["person"] }, b: { inverse: "b", domain: ["person"], range: ["person"] } } })).toThrow(/exactly one root/);
    expect(() => new Registry({ ...base, nodeTypes: { person: { label: "P" } }, predicates: { a: { inverse: "a", domain: ["person"], range: ["ghost"] } } })).toThrow(/unknown node type/);
  });
});
