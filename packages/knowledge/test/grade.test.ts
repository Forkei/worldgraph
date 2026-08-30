import { describe, it, expect } from "vitest";
import { grade, betterTier } from "../src/grade.ts";

const p = (o: Partial<Parameters<typeof grade>[0]>) => ({ evidence_count: 1, independent_origins: 1, primary_origins: 0, tier_best: "C", contested: false, fuzzy_only: false, ...o });

describe("grade", () => {
  it("two independent origins with a primary → established (A1)", () => {
    expect(grade(p({ evidence_count: 3, independent_origins: 2, primary_origins: 1, tier_best: "A" }))).toEqual({ reliability: "A", credibility: 1, grade: "established" });
  });
  it("two independent weak origins → corroborated", () => {
    expect(grade(p({ independent_origins: 2, tier_best: "C" }))).toMatchObject({ credibility: 1, grade: "corroborated" });
  });
  it("one primary origin → corroborated (A2); one B/C origin → single_source", () => {
    expect(grade(p({ tier_best: "A" }))).toMatchObject({ credibility: 2, grade: "corroborated" });
    expect(grade(p({ tier_best: "B" }))).toMatchObject({ credibility: 2, grade: "single_source" });
    expect(grade(p({ tier_best: "C" }))).toMatchObject({ credibility: 3, grade: "single_source" });
  });
  it("D/E/F or fuzzy-only → unverified; contested → disputed", () => {
    expect(grade(p({ tier_best: "D" })).grade).toBe("unverified");
    expect(grade(p({ tier_best: "F" }))).toMatchObject({ credibility: 6, grade: "unverified" });
    expect(grade(p({ independent_origins: 3, tier_best: "A", fuzzy_only: true })).grade).toBe("unverified");
    expect(grade(p({ independent_origins: 3, tier_best: "A", contested: true }))).toMatchObject({ credibility: 4, grade: "disputed" });
  });
  it("ten copies of one release are still one origin → never established by count alone", () => {
    expect(grade(p({ evidence_count: 10, independent_origins: 1, tier_best: "D" })).grade).toBe("unverified");
  });
  it("betterTier", () => { expect(betterTier("C", "A")).toBe("A"); expect(betterTier("F", "D")).toBe("D"); });
});
