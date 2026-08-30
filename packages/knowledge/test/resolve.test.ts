import { describe, it, expect } from "vitest";
import { resolve, scorePair, tokenIdf, jaroWinkler, initialism, type Provisional } from "../src/resolve.ts";

const P = (id: string, type: string, name: string, o: Partial<Provisional> = {}): Provisional => ({
  id, type, kind: null, name, name_norm: name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), keys: {}, neighbors: new Set(), claim_count: 1, ...o,
});
// a background corpus so token rarity is meaningful
const filler = ["acme capital", "zenith capital", "orion partners", "blue fund", "green capital management", "delta holdings", "sigma ventures", "kappa capital", "omega fund", "alpha partners"]
  .map((n, i) => P(`f${i}`, "organization", n));

describe("resolve — organizations", () => {
  it("merges brand / short / long aliases; links the management company as related; merges the initialism", () => {
    const ents = [
      P("acorn1", "organization", "ACORN", { neighbors: new Set(["seed"]) }),
      P("acorn2", "organization", "Acorn Capital", { neighbors: new Set(["seed", "mentor"]) }),
      P("acorn3", "organization", "Acorn Capital Management LP"),
      P("kp1", "organization", "Alder Maple", { neighbors: new Set(["seed"]) }),
      P("kp2", "organization", "AMCD", { neighbors: new Set(["seed"]) }),
      P("kp3", "organization", "Alder Maple Cedar & Dale", { neighbors: new Set(["mentor"]) }),
      ...filler,
    ];
    const r = resolve(ents, []);
    expect(r.clusters.get("acorn1")).toBe(r.clusters.get("acorn2"));
    expect(r.clusters.get("acorn3")).not.toBe(r.clusters.get("acorn1"));
    expect(r.related.some((x) => (x.a === "acorn1" || x.a === "acorn2") && x.b === "acorn3" && x.related_kind === "manages")).toBe(true);
    expect(r.clusters.get("kp1")).toBe(r.clusters.get("kp3"));
    expect(r.clusters.get("kp2")).toBe(r.clusters.get("kp1"));
  });
});

describe("resolve — structure, series, identifiers", () => {
  it("fund series are siblings, schools are part of their university, numeric ids never match", () => {
    const ents = [
      P("b2", "organization", "Acorn II LP"), P("b3", "organization", "Acorn III LP"), P("bf", "organization", "Acorn Capital Fund LP"),
      P("su", "organization", "Stanford University"), P("gsb", "organization", "Stanford University Graduate School of Business"),
      P("p1", "document", "Post 1751263590470799775"), P("p2", "document", "Post 1751265235590090845"),
      P("cv", "organization", "Cowboy Ventures"), P("kv2", "organization", "Khosla Ventures Acquisition Co II"),
      ...filler,
    ];
    const r = resolve(ents, []);
    expect(r.related.some((x) => [x.a, x.b].includes("cv") && [x.a, x.b].includes("kv2"))).toBe(false);   // sharing "ventures" is not a family
    expect(r.clusters.get("b2")).not.toBe(r.clusters.get("b3"));
    expect(r.related.some((x) => x.a === "b2" && x.b === "b3" && x.related_kind === "sibling")).toBe(true);
    expect(r.clusters.get("su")).not.toBe(r.clusters.get("gsb"));
    expect(r.related.some((x) => x.related_kind === "part_of" && [x.a, x.b].includes("gsb"))).toBe(true);
    expect(r.clusters.get("p1")).not.toBe(r.clusters.get("p2"));
    expect(r.hypotheses.some((h) => [h.a, h.b].includes("p1"))).toBe(false);
  });
});

describe("resolve — people", () => {
  it("never merges on a hard-key conflict, merges on a hard-key match, and leaves same-surname pairs as hypotheses at most", () => {
    const ents = [
      P("jd1", "person", "Jane Doe", { keys: { email: ["jdoe@sps186.org"] }, neighbors: new Set(["lincoln"]) }),
      P("jd2", "person", "Jane M. Doe", { keys: { email: ["jdoe@sps186.org"] } }),
      P("jd3", "person", "Jane Doe", { keys: { email: ["jane@peoria.k12.il.us"] }, neighbors: new Set(["peoria"]) }),
      P("jd4", "person", "J. Doe", { neighbors: new Set(["lincoln"]) }),
      ...filler,
    ];
    // jd1 and jd3 share the exact norm "jane doe" — as provisional entities they'd be one cluster; make them distinct ids to test the guard
    const r = resolve(ents, []);
    expect(r.clusters.get("jd1")).toBe(r.clusters.get("jd2"));            // same email
    expect(r.clusters.get("jd1")).not.toBe(r.clusters.get("jd3"));        // conflicting emails
    expect(r.merges.some((m) => m.a === "jd1" && m.b === "jd4")).toBe(false); // initial-only never auto-merges
  });

  it("decisions override scores and are reversible by a later not_same", () => {
    const ents = [P("a", "person", "Eliot Varney"), P("b", "person", "Eliot VARNEY", { keys: { licence: ["1000001"] } }), ...filler];
    const same = resolve(ents, [{ a_id: "a", b_id: "b", verdict: "same" }]);
    expect(same.clusters.get("a")).toBe(same.clusters.get("b"));
    const split = resolve(ents, [{ a_id: "a", b_id: "b", verdict: "not_same" }]);
    expect(split.clusters.get("a")).not.toBe(split.clusters.get("b"));
  });
});

describe("scoring pieces", () => {
  it("jaro-winkler and initialism behave", () => {
    expect(jaroWinkler("alder maple", "alder maple")).toBe(1);
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.95);
    expect(initialism("alder maple cedar dale")).toBe("amcd");
  });
  it("shared rare tokens outweigh shared common tokens", () => {
    const ents = [P("x1", "organization", "Zephyr Capital"), P("x2", "organization", "Zephyr Partners"), P("y1", "organization", "Blue Capital"), P("y2", "organization", "Green Capital"), ...filler];
    const idf = tokenIdf(ents);
    expect(scorePair(ents[0]!, ents[1]!, idf).p).toBeGreaterThan(scorePair(ents[2]!, ents[3]!, idf).p);
  });
});
