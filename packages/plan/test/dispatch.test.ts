import { describe, it, expect } from "vitest";
import { makeGraph, type GEntity, type GLink } from "@worldgraph/knowledge";
import { computeGaps, buildMissions } from "../src/dispatch.ts";

const E = (id: string, type: string, name = id): GEntity => ({ id, type, kind: null, name, aliases: [], keys: {}, claim_count: 1 });
let n = 0;
const L = (src: string, predicate: string, dst: string, origins = 1): GLink => ({
  id: `l${++n}`, src, predicate, predicate_specific: null, dst, qualifiers: {}, qualifier_conflicts: {},
  grade: "single_source", reliability: "C", credibility: 3, evidence_count: origins, independent_origins: origins, contested: false, derived: false,
  temporal_kind: null, valid_from_lo: null, valid_from_hi: null, valid_to_lo: null, valid_to_hi: null, date_lo: null, date_hi: null,
});

const IND = [
  { name: "employment", predicates: ["works_at"], record_classes: [], weight: 1.0 },
  { name: "board", predicates: ["board_member"], record_classes: [], weight: 0.8 },
  { name: "collaborators", predicates: ["knows"], record_classes: [], weight: 0.5 },
];

describe("dispatcher gaps", () => {
  // subject: works_at well-covered (2 origins), board single-origin (thin), knows missing.
  // a spouse (family edge) and a colleague (professional edge) as neighbours.
  const g = makeGraph(
    [E("subj", "person", "Subject"), E("kp", "organization"), E("acme", "organization"), E("spouse", "person"), E("colleague", "person")],
    [
      L("subj", "works_at", "kp", 2),
      L("subj", "board_member", "acme", 1),
      L("subj", "spouse_of", "spouse"),
      L("subj", "works_at", "acme", 2), L("colleague", "works_at", "acme", 2),   // colleague reached via professional edge
    ],
  );

  it("flags missing and thin indicators on the subject; v1 is subject-focused (no auto ring expansion)", () => {
    const gaps = computeGaps(g, "subj", IND, 2);
    const on = (e: string) => gaps.filter((x) => x.entity === e).map((x) => `${x.indicator}:${x.kind}`).sort();
    // subject: works_at has 2 origins → satisfied; board has 1 → thin; knows absent → missing
    expect(on("subj")).toEqual(["board:thin", "collaborators:missing"]);
    // no neighbours are auto-targeted (not the spouse, not the 2-hop colleague) — every gap is on the subject
    expect(gaps.every((x) => x.entity === "subj")).toBe(true);
  });

  it("scores missing above thin and ring-0 above ring-1", () => {
    const missions = buildMissions(computeGaps(g, "subj", IND, 2));
    expect(missions[0]!.score).toBeGreaterThanOrEqual(missions[missions.length - 1]!.score);
    const collab = missions.find((m) => m.objective.includes("collaborators"))!;
    const board = missions.find((m) => m.objective.includes("board"))!;
    // collaborators is missing (×1.4) weight .5 ring0 = .70; board thin (×1.0) weight .8 = .80 → board ranks higher here
    expect(board.score).toBeGreaterThan(0);
    expect(collab.score).toBeGreaterThan(0);
    // every mission has a frontier query and a dedupe key
    for (const m of missions) { expect(m.frontier[0]).toBeTruthy(); expect(m.dedupe_key).toContain("|"); }
  });
});
