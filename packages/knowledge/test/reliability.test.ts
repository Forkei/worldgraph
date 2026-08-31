import { describe, it, expect } from "vitest";
import { tierForClaim, LADDER, type SourceFacts } from "../src/reliability.ts";

const src = (o: Partial<SourceFacts>): SourceFacts => ({ publisher_kind: "independent", publisher_entity_id: null, override_tier: null, ...o });

describe("publisher ladder", () => {
  it("maps each publisher kind to its Admiralty letter", () => {
    expect(tierForClaim(src({ publisher_kind: "authority" }), false)).toBe("A");
    expect(tierForClaim(src({ publisher_kind: "independent" }), false)).toBe("C");
    expect(tierForClaim(src({ publisher_kind: "platform" }), false)).toBe("D");
    expect(tierForClaim(src({ publisher_kind: "anonymous" }), false)).toBe("E");
    expect(tierForClaim(src({ publisher_kind: null }), false)).toBe(LADDER.unknown);
  });
  it("the graph decides 'self': an unknown/independent publisher that IS the subject becomes self (B)", () => {
    expect(tierForClaim(src({ publisher_kind: "independent" }), true)).toBe("B");
    expect(tierForClaim(src({ publisher_kind: "unknown" }), true)).toBe("B");
  });
  it("a claimed 'self' the graph does not confirm is at best independent (C)", () => {
    expect(tierForClaim(src({ publisher_kind: "self" }), false)).toBe("C");
    expect(tierForClaim(src({ publisher_kind: "self" }), true)).toBe("B");
  });
  it("an owner override wins over the ladder", () => {
    expect(tierForClaim(src({ publisher_kind: "anonymous", override_tier: "A" }), false)).toBe("A");
  });
});
