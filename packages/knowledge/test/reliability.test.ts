import { describe, it, expect } from "vitest";
import { tierForClaim } from "../src/reliability.ts";

const priors = { record: "A", article: "B", profile: "C", page: "C", forum: "D", unknown: "F" };
const src = (o: Partial<Parameters<typeof tierForClaim>[0]>) => ({ doc_kind: "page", self_published: false, publisher_entity_id: null, agree_count: 0, contradict_count: 0, override_tier: null, ...o });

describe("tierForClaim", () => {
  it("starts from the document-kind prior, not the domain", () => {
    expect(tierForClaim(src({ doc_kind: "record" }), priors, false)).toBe("A");
    expect(tierForClaim(src({ doc_kind: "forum" }), priors, false)).toBe("D");
    expect(tierForClaim(src({ doc_kind: null }), priors, false)).toBe("F");
  });
  it("a company's own page is authoritative about itself, not about others", () => {
    const own = src({ doc_kind: "page", self_published: true, publisher_entity_id: "acorn" });
    expect(tierForClaim(own, priors, true)).toBe("B");
    expect(tierForClaim(own, priors, false)).toBe("C");
  });
  it("learns from observed agreement only after enough observations", () => {
    expect(tierForClaim(src({ doc_kind: "profile", agree_count: 5, contradict_count: 0 }), priors, false)).toBe("C");
    expect(tierForClaim(src({ doc_kind: "profile", agree_count: 40, contradict_count: 1 }), priors, false)).toBe("B");
    expect(tierForClaim(src({ doc_kind: "article", agree_count: 8, contradict_count: 14 }), priors, false)).toBe("C");
  });
  it("an owner override wins", () => {
    expect(tierForClaim(src({ doc_kind: "forum", override_tier: "A" }), priors, false)).toBe("A");
  });
});
