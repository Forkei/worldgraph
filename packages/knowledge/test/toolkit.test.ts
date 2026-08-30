import { describe, it, expect } from "vitest";
import { makeGraph, ego, paths, intersect, fold, timeline, at, contested, similar, holdsAt, type GEntity, type GLink } from "../src/toolkit.ts";

const E = (id: string, type: string, name = id): GEntity => ({ id, type, kind: null, name, aliases: [], keys: {}, claim_count: 1 });
let n = 0;
const L = (src: string, predicate: string, dst: string, o: Partial<GLink> = {}): GLink => ({
  id: `l${++n}`, src, predicate, predicate_specific: null, dst, qualifiers: {}, qualifier_conflicts: {},
  grade: "single_source", reliability: "B", credibility: 2, evidence_count: 1, independent_origins: 1, contested: false, derived: false,
  temporal_kind: null, valid_from_lo: null, valid_from_hi: null, valid_to_lo: null, valid_to_hi: null, date_lo: null, date_hi: null, ...o,
});

// seed —works_at→ kp (2010→2018), seed —works_at→ acorn (2018→), mentor —works_at→ kp, mentor —founded→ acorn,
// seed —board_member→ birch, birch —located_in→ sf, kp —located_in→ sf, stranger —works_at→ acme
const g = makeGraph(
  [E("seed", "person"), E("mentor", "person"), E("kp", "organization"), E("acorn", "organization"), E("birch", "organization"), E("sf", "place"), E("stranger", "person"), E("acme", "organization")],
  [
    L("seed", "works_at", "kp", { valid_from_lo: "2010-01-01", valid_from_hi: "2010-01-01", valid_to_lo: "2018-09-30", valid_to_hi: "2018-09-30", grade: "established" }),
    L("seed", "works_at", "acorn", { valid_from_lo: "2018-09-01", valid_from_hi: "2018-09-01", grade: "corroborated" }),
    L("mentor", "works_at", "kp", { valid_from_lo: "2010-01-01", valid_from_hi: "2010-12-31", valid_to_hi: "2018-09-30" }),
    L("mentor", "founded", "acorn", { date_lo: "2018-09-01", date_hi: "2018-09-01" }),
    L("seed", "board_member", "birch", { qualifier_conflicts: { role: [{ value: "director", claim_ids: ["c1"] }, { value: "observer", claim_ids: ["c2"] }] } }),
    L("birch", "located_in", "sf"), L("kp", "located_in", "sf"),
    L("stranger", "works_at", "acme"),
  ],
  [{ id: "a1", entity: "seed", key: "occupation", value: "investor", key_specific: null, datatype: "string", grade: "single_source", reliability: "B", credibility: 2, evidence_count: 1, independent_origins: 1, contested: false, valid_from_lo: null, valid_to_hi: null, date_lo: null }],
);

describe("toolkit", () => {
  it("ego is bounded, hop-limited and filterable", () => {
    expect(ego(g, "seed", 1).links.map((l) => l.dst).sort()).toEqual(["acorn", "birch", "kp"]);
    expect(ego(g, "seed", 2).entities.map((e) => e.id).sort()).toEqual(["acorn", "birch", "kp", "mentor", "seed", "sf"]);
    expect(ego(g, "seed", 2, { predicates: ["works_at"] }).entities.map((e) => e.id).sort()).toEqual(["acorn", "kp", "mentor", "seed"]);
    expect(ego(g, "seed", 1, { minGrade: "corroborated" }).links.length).toBe(2);
    const t = ego(g, "seed", 3, { limit: 2 });
    expect(t.links.length).toBe(2); expect(t.truncated).toBe(true);
    expect(ego(g, "seed", 1, { asOf: "2015-06-01" }).links.map((l) => l.dst).sort()).toEqual(["birch", "kp"]);   // acorn starts 2018; birch undated stays
  });

  it("paths finds the shortest routes first and respects a time window", () => {
    const r = paths(g, "seed", "mentor", 3);
    expect(r.paths[0]!.nodes).toHaveLength(3);                                    // seed–kp–mentor or seed–acorn–mentor
    expect(r.paths.filter((p) => p.links.length === 2).length).toBe(2);
    expect(paths(g, "seed", "stranger", 4).paths).toHaveLength(0);
    expect(paths(g, "seed", "mentor", 2, { window: { hi: "2015-01-01" } }).paths.map((p) => p.nodes[1])).toEqual(["kp"]);
  });

  it("intersect finds what two neighbourhoods share", () => {
    const shared = intersect(ego(g, "seed", 1), ego(g, "mentor", 1), "organization");
    expect(shared.entities.filter((e) => e.type === "organization").map((e) => e.id).sort()).toEqual(["acorn", "kp"]);
  });

  it("fold turns a meta-path into pairs", () => {
    const f = fold(g, ["person", "works_at", "organization", "works_at", "person"]);
    expect(f.folds.map((x) => [x.a, x.b].sort().join("-"))).toEqual(["mentor-seed"]);
    expect(f.folds[0]!.via).toEqual(["kp"]);
    expect(fold(g, ["person", "*", "organization", "located_in", "place"]).folds.map((x) => x.b)).toEqual(["sf", "sf"]);
  });

  it("timeline and at read the temporal bounds", () => {
    const tl = timeline(g, "seed");
    expect(tl.map((r) => r.at)).toEqual(["2010-01-01", "2018-09-01", null]);
    expect(holdsAt(tl[0]!.link, "2019-01-01")).toBe("no");
    const snap = at(g, "seed", "2019-01-01");
    expect(snap.holds.map((l) => l.dst)).toEqual(["acorn"]);
    expect(snap.ended.map((l) => l.dst)).toEqual(["kp"]);
    expect(snap.undated.map((l) => l.dst)).toEqual(["birch"]);
    expect(snap.attributes.map((a) => a.value)).toEqual(["investor"]);
  });

  it("contested surfaces qualifier disagreements; similar finds who shares a neighbourhood", () => {
    expect(contested(g, "seed").links.map((l) => l.dst)).toEqual(["birch"]);
    expect(contested(g).links).toHaveLength(1);
    const s = similar(g, "seed");
    expect(s[0]!.id).toBe("mentor"); expect(s[0]!.shared.sort()).toEqual(["acorn", "kp"]);
    expect(similar(g, "stranger")).toHaveLength(0);
  });
});
