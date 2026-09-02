import { describe, it, expect } from "vitest";
import { makeGraph, type GEntity, type GLink } from "@worldgraph/knowledge";
import { computeGaps, buildMissions, indicatorApplies, isStructural } from "../src/dispatch.ts";
import { registry } from "@worldgraph/core";

const E = (id: string, type: string, name = id): GEntity => ({ id, type, kind: null, name, aliases: [], keys: {}, claim_count: 1 });
let n = 0;
const L = (src: string, predicate: string, dst: string, origins = 1, grade = "single_source"): GLink => ({
  id: `l${++n}`, src, predicate, predicate_specific: null, dst, qualifiers: {}, qualifier_conflicts: {},
  grade, reliability: "C", credibility: 3, evidence_count: origins, independent_origins: origins, contested: false, derived: false,
  temporal_kind: null, valid_from_lo: null, valid_from_hi: null, valid_to_lo: null, valid_to_hi: null, date_lo: null, date_hi: null,
});

const IND = [
  { name: "employment", predicates: ["works_at"], record_classes: [], weight: 1.0 },
  { name: "board", predicates: ["board_member"], record_classes: [], weight: 0.8 },
  { name: "collaborators", predicates: ["knows"], record_classes: [], weight: 0.5 },
];

describe("dispatcher gaps", () => {
  // subject: works_at well-covered (2 origins), board single-origin (thin), knows missing.
  // a spouse (family edge — not an indicator predicate) and a colleague (2 hops via the employer) as neighbours.
  const g = makeGraph(
    [E("subj", "person", "Subject"), E("kp", "organization"), E("acme", "organization"), E("spouse", "person"), E("colleague", "person")],
    [
      L("subj", "works_at", "kp", 2, "corroborated"),
      L("subj", "board_member", "acme", 1),
      L("subj", "spouse_of", "spouse"),
      L("subj", "works_at", "acme", 2, "corroborated"), L("colleague", "works_at", "acme", 2, "corroborated"),
    ],
  );
  const on = (gaps: ReturnType<typeof computeGaps>, e: string) => gaps.filter((x) => x.entity === e).map((x) => `${x.indicator}:${x.kind}`).sort();

  it("flags missing and thin indicators on the subject (ring 0)", () => {
    const gaps = computeGaps(g, "subj", IND, 2, { maxRing: 0 });
    expect(on(gaps, "subj")).toEqual(["board:thin", "collaborators:missing"]);
    expect(gaps.every((x) => x.entity === "subj")).toBe(true);
  });

  it("expands to neighbours reached through indicator predicates, with indicators derived from the ontology", () => {
    const gaps = computeGaps(g, "subj", IND, 2, { maxRing: 2 });
    // the spouse hangs off a family edge that no indicator names → never targeted (family is not a lead by itself)
    expect(on(gaps, "spouse")).toEqual([]);
    // ring 1 orgs: "employment" applies inbound (works_at range = organization); "collaborators" (knows) does not apply to orgs
    expect(on(gaps, "kp")).toEqual(["board:missing"]);                 // employment satisfied (2 origins), board missing
    expect(on(gaps, "acme")).toEqual(["board:thin"]);                  // employment: 2 well-corroborated links; board: 1 origin
    // ring 2: the colleague reached via acme's employment link
    expect(on(gaps, "colleague")).toEqual(["board:missing", "collaborators:missing"]);
    const c = gaps.find((x) => x.entity === "colleague")!;
    expect(c.ring).toBe(2);
    expect(c.via).toMatchObject({ predicate: "works_at", fromName: "acme" });
  });

  it("caps attention through weak links (weak-key ban) and honours maxRing", () => {
    const g2 = makeGraph([E("subj", "person"), E("shaky", "organization"), E("solid", "organization")], [L("subj", "works_at", "shaky", 1, "unverified"), L("subj", "works_at", "solid", 2, "established")]);
    const gaps = computeGaps(g2, "subj", IND, 2, { maxRing: 1 });
    expect(gaps.find((x) => x.entity === "shaky")?.via?.quality).toBe(0.3);
    expect(gaps.find((x) => x.entity === "solid")?.via?.quality).toBe(1);
    const missions = buildMissions(gaps);
    const solid = missions.find((m) => m.scope.entities[0] === "solid")!, shaky = missions.find((m) => m.scope.entities[0] === "shaky")!;
    expect(solid.score).toBeGreaterThan(shaky.score);
    expect(computeGaps(g2, "subj", IND, 2, { maxRing: 0 }).every((x) => x.entity === "subj")).toBe(true);
  });

  it("transactional routes inherit only the reaching indicator and are discounted", () => {
    const IND2 = [...IND, { name: "contracts", predicates: ["paid"], record_classes: [], weight: 0.9 }];
    const g3 = makeGraph([E("subj", "organization"), E("agency", "organization"), E("parent", "organization")],
      [L("agency", "paid", "subj", 1), L("subj", "subsidiary_of", "parent", 2, "corroborated"), L("subj", "works_at", "parent", 1)]);
    // subsidiary_of is not an indicator predicate here, so "parent" is reached via works_at (structural); agency via paid (transactional)
    const gaps = computeGaps(g3, "subj", IND2, 2, { maxRing: 1 });
    expect(gaps.filter((x) => x.entity === "agency").map((x) => x.indicator)).toEqual(["contracts"]);   // not leadership/board
    expect(gaps.filter((x) => x.entity === "parent").map((x) => x.indicator).sort()).toEqual(["board", "contracts", "employment"]);
    const m = buildMissions(gaps);
    expect(m.find((x) => x.scope.entities[0] === "agency")!.score_parts.route).toBe(0.4);
    expect(m.find((x) => x.scope.entities[0] === "parent")!.score_parts.route).toBe(1);
    const reg = registry();
    expect(isStructural("works_at", reg)).toBe(true); expect(isStructural("subsidiary_of", reg)).toBe(true); expect(isStructural("paid", reg)).toBe(false); expect(isStructural("party_to", reg)).toBe(false);
  });

  it("indicatorApplies follows predicate domain/range", () => {
    const reg = registry();
    expect(indicatorApplies(IND[0]!, "organization", reg)).toBe(true);
    expect(indicatorApplies(IND[0]!, "person", reg)).toBe(true);
    expect(indicatorApplies(IND[2]!, "organization", reg)).toBe(false);
  });

  it("scores missing above thin, ring-0 above ring-1, and names the route in the objective", () => {
    const missions = buildMissions(computeGaps(g, "subj", IND, 2));
    expect(missions[0]!.score).toBeGreaterThanOrEqual(missions[missions.length - 1]!.score);
    const r0 = missions.filter((m) => m.scope.ring === 0), r2 = missions.filter((m) => m.scope.ring === 2);
    expect(Math.max(...r0.map((m) => m.score))).toBeGreaterThan(Math.max(...r2.map((m) => m.score)));
    const kp = missions.find((m) => m.scope.entities[0] === "kp")!;
    expect(kp.objective).toBe("Find board for kp (ring 1: works at of Subject)");
    expect(kp.frontier[0]).toContain("board of directors");
    for (const m of missions) { expect(m.frontier[0]).toBeTruthy(); expect(m.dedupe_key).toContain("|"); }
  });
});

describe("dispatcher reach — the owner earns a deep dive", () => {
  it("reaches people bound structurally to the subject even when no indicator names that predicate", () => {
    const INDO = [{ name: "ownership_and_operators", predicates: ["owns", "controls", "manages"], record_classes: [], weight: 1 }, { name: "litigation", predicates: ["party_to"], record_classes: [], weight: 0.6 }];
    const g = makeGraph([E("srv", "organization", "Example Realm"), E("brad", "person", "Alex Sample"), E("tebex", "organization", "Tebex")],
      [L("brad", "member_of", "srv", 2, "corroborated"), L("srv", "transacted_with", "tebex", 1)]);
    const gaps = computeGaps(g, "srv", INDO, 2, { maxRing: 1 });
    expect(gaps.some((x) => x.entity === "brad" && x.indicator === "ownership_and_operators")).toBe(true);
    expect(gaps.some((x) => x.entity === "tebex")).toBe(false);   // transactional, not named by an indicator
  });
});
