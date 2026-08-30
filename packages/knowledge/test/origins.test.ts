import { describe, it, expect } from "vitest";
import { clusterOrigins, independentOrigins, jaccard, shingles } from "../src/origins.ts";
import { resolveTier } from "../src/tiers.ts";

const release = "ACORN today announced that Person A, a general partner at the firm, has joined the board of directors of LUMEN, the leading developer of AI for healthcare operations. Person A previously served on the boards of Saildrone and Willow Health.";
const rewrite = "Acorn announced today that general partner Person A joined LUMEN's board of directors. LUMEN is a leading developer of AI for healthcare operations; Person A previously served on the boards of Saildrone and Willow Health.";
const independent = "Board members include Person A of ACORN, who joined in 2021 after leading the Series B, according to a person familiar with the matter.";

describe("origin clustering", () => {
  it("collapses ten syndicated copies of one press release into one origin, keeps an independent report separate", () => {
    const fact = "seed seed|board_member|lumen";
    const claims = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `0000000${i}`, fact_key: fact, source_id: `s${i}`, family_id: null, passage: release + (i % 2 ? " Read more." : "") })),
      { id: "00000010", fact_key: fact, source_id: "s10", family_id: null, passage: rewrite },
      { id: "00000011", fact_key: fact, source_id: "s11", family_id: null, passage: independent },
    ];
    const a = clusterOrigins(claims);
    const per = independentOrigins(claims, a);
    // ten copies → one origin; a paraphrased rewrite is NOT a copy (it may be independent — only a shared
    // source family or a matching passage collapses it); the independent report stays separate.
    expect(per.get(fact)).toBe(3);
    for (let i = 1; i < 10; i++) expect(a.get(`0000000${i}`)).toBe(a.get("00000000"));
    expect(a.get("00000010")).not.toBe(a.get("00000000"));
    expect(a.get("00000011")).not.toBe(a.get("00000000"));
  });

  it("treats sources in the same family as one origin even with different text", () => {
    const fact = "jane doe|lives_at|123 y lane";
    const claims = [
      { id: "a1", fact_key: fact, source_id: "tps", family_id: "us_people_search", passage: "Jane Doe, age 41, lives at 123 Y Lane, Springfield IL" },
      { id: "a2", fact_key: fact, source_id: "fps", family_id: "us_people_search", passage: "Current address: 123 Y Ln Springfield, IL 62704 — Jane M Doe" },
      { id: "a3", fact_key: fact, source_id: "assessor", family_id: null, passage: "Parcel 22-11-300-004 owner DOE ROBERT J & JANE M situs 123 Y LANE" },
    ];
    const a = clusterOrigins(claims);
    expect(a.get("a1")).toBe(a.get("a2"));
    expect(a.get("a3")).not.toBe(a.get("a1"));
    expect(independentOrigins(claims, a).get(fact)).toBe(2);
  });

  it("never merges across different facts", () => {
    const claims = [
      { id: "b1", fact_key: "x|works_at|acme", source_id: "s1", family_id: null, passage: release },
      { id: "b2", fact_key: "x|works_at|globex", source_id: "s2", family_id: null, passage: release },
    ];
    const a = clusterOrigins(claims);
    expect(a.get("b1")).not.toBe(a.get("b2"));
  });

  it("jaccard/shingles behave", () => {
    expect(jaccard(shingles(release), shingles(release))).toBe(1);
    expect(jaccard(shingles(release), shingles(independent))).toBeLessThan(0.2);
  });
});

describe("resolveTier", () => {
  const rows = [
    { pattern: "*", tier: "F", family_id: null, kind: "unknown" },
    { pattern: ".gov", tier: "A", family_id: null, kind: "primary" },
    { pattern: "sec.gov", tier: "A", family_id: null, kind: "primary" },
    { pattern: "crunchbase.com", tier: "C", family_id: "linkedin_derived", kind: "profile" },
  ];
  it("longest suffix wins; www stripped; default is F", () => {
    expect(resolveTier("www.sec.gov", rows)).toMatchObject({ tier: "A", pattern: "sec.gov" });
    expect(resolveTier("data.cityofchicago.gov", rows)).toMatchObject({ tier: "A", pattern: ".gov" });
    expect(resolveTier("crunchbase.com", rows)).toMatchObject({ tier: "C", family_id: "linkedin_derived" });
    expect(resolveTier("example.org", rows)).toMatchObject({ tier: "F", pattern: "*" });
    expect(resolveTier(null, rows).tier).toBe("F");
  });
});
