import { describe, it, expect } from "vitest";
import { bcubed, goldToMap } from "../src/eval.ts";

const gold = goldToMap({ investigation: "x", reviewed: true, entities: [
  { name: "Person A", type: "person", members: ["n1", "n2", "n3"] },
  { name: "Mary", type: "person", members: ["m1", "m2"] },
  { name: "Other Person A", type: "person", members: ["o1"] },
] });

describe("B³", () => {
  it("is perfect when clusters match", () => {
    const sys = new Map([["n1", "A"], ["n2", "A"], ["n3", "A"], ["m1", "B"], ["m2", "B"], ["o1", "C"]]);
    const r = bcubed(sys, gold);
    expect(r.f1).toBe(1); expect(r.over_merged).toHaveLength(0); expect(r.under_merged).toHaveLength(0);
  });
  it("penalises an over-merge on precision and a split on recall", () => {
    const over = bcubed(new Map([["n1", "A"], ["n2", "A"], ["n3", "A"], ["o1", "A"], ["m1", "B"], ["m2", "B"]]), gold);
    expect(over.recall).toBe(1); expect(over.precision).toBeLessThan(1); expect(over.over_merged).toHaveLength(1);
    const split = bcubed(new Map([["n1", "A"], ["n2", "A"], ["n3", "Z"], ["o1", "C"], ["m1", "B"], ["m2", "B"]]), gold);
    expect(split.precision).toBe(1); expect(split.recall).toBeLessThan(1); expect(split.under_merged).toHaveLength(1);
  });
  it("ignores mentions the gold does not cover", () => {
    const r = bcubed(new Map([["n1", "A"], ["n2", "A"], ["n3", "A"], ["m1", "B"], ["m2", "B"], ["o1", "C"], ["zz", "A"]]), gold);
    expect(r.f1).toBe(1); expect(r.mentions).toBe(6);
  });
});
