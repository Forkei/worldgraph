import { describe, it, expect } from "vitest";
import { loadRuleFiles, slotsFor, ruleMatches } from "../src/rules.ts";

describe("rules", () => {
  const rules = loadRuleFiles();
  it("loads the core rule file with unique ids", () => {
    expect(rules.length).toBeGreaterThan(5);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });
  it("opens person shapes for a person and company records for a company", () => {
    const person = { id: "p", type: "person", kind: null, predicates: new Set(["works_at"]), attributes: new Set<string>() };
    const keys = slotsFor(rules, person).map((s) => s.slot.key);
    expect(keys).toContain("located_in");
    expect(keys).toContain("date_of_birth");
    expect(keys).not.toContain("company_registry");
    const company = { id: "c", type: "organization", kind: "company", predicates: new Set<string>(), attributes: new Set<string>() };
    expect(slotsFor(rules, company).map((s) => s.slot.key)).toContain("company_registry");
    const club = { id: "c2", type: "organization", kind: "club", predicates: new Set<string>(), attributes: new Set<string>() };
    expect(slotsFor(rules, club).map((s) => s.slot.key)).not.toContain("company_registry");
  });
  it("respects lacks_predicate", () => {
    const r = rules.find((x) => x.id === "expected.person.obituary_relatives")!;
    expect(ruleMatches(r, { id: "p", type: "person", kind: null, predicates: new Set(["parent_of"]), attributes: new Set() })).toBe(false);
    expect(ruleMatches(r, { id: "p", type: "person", kind: null, predicates: new Set(), attributes: new Set() })).toBe(true);
  });
});
