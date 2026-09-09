import { describe, it, expect } from "vitest";
import { resolve, scorePair, tokenIdf, jaroWinkler, initialism, registrableDomain, orgIdentityKey, type Provisional } from "../src/resolve.ts";

const P = (id: string, type: string, name: string, o: Partial<Provisional> = {}): Provisional => ({
  id, type, kind: null, name, name_norm: name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), keys: {}, neighbors: new Set(), claim_count: 1, ...o,
});
// a background corpus so token rarity is meaningful
const filler = ["acme capital", "zenith capital", "orion partners", "blue fund", "green capital management", "delta holdings", "sigma ventures", "kappa capital", "omega fund", "alpha partners"]
  .map((n, i) => P(`f${i}`, "organization", n));

describe("resolve — organizations", () => {
  it("proposes brand/short/long aliases and the initialism as candidates (never auto-merged); links the management company as related", () => {
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
    const hyp = (a: string, b: string) => r.hypotheses.some((h) => [h.a, h.b].includes(a) && [h.a, h.b].includes(b));
    // orgs get person-level caution (v0.4 §5): name variants are candidates for the judge, not silent merges
    expect(r.clusters.get("acorn1")).not.toBe(r.clusters.get("acorn2"));
    expect(hyp("acorn1", "acorn2")).toBe(true);
    expect(hyp("kp1", "kp3") || hyp("kp2", "kp1")).toBe(true);
    // structural relations are still derived (a management LP manages the fund)
    expect(r.related.some((x) => x.related_kind === "manages")).toBe(true);
    // once the judge/owner decides two of them are the same, they merge
    const decided = resolve(ents, [{ a_id: "acorn1", b_id: "acorn2", verdict: "same" }]);
    expect(decided.clusters.get("acorn1")).toBe(decided.clusters.get("acorn2"));
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

  it("an identical full name across sources is a hypothesis, not a merge — until context or a key lifts it", () => {
    const alone = resolve([P("s1", "person", "Jules Marchand"), P("s2", "person", "Jules MARCHAND"), ...filler], []);
    expect(alone.clusters.get("s1")).not.toBe(alone.clusters.get("s2"));
    expect(alone.hypotheses.some((h) => h.a === "s1" && h.b === "s2")).toBe(true);
    // shared context proposes a candidate but NEVER merges — only an identifier, a judgment, or the owner merges (v0.4 §5)
    const shared = resolve([P("s1", "person", "Jules Marchand", { neighbors: new Set(["uni", "club"]) }), P("s2", "person", "Jules MARCHAND", { neighbors: new Set(["uni", "club"]) }), ...filler], []);
    expect(shared.clusters.get("s1")).not.toBe(shared.clusters.get("s2"));
    expect(shared.hypotheses.some((h) => (h.a === "s1" && h.b === "s2") || (h.a === "s2" && h.b === "s1"))).toBe(true);
    const keyed = resolve([P("s1", "person", "Jules Marchand", { keys: { handle: ["@jmarchand"] } }), P("s2", "person", "Jules MARCHAND", { keys: { handle: ["@jmarchand"] } }), ...filler], []);
    expect(keyed.clusters.get("s1")).toBe(keyed.clusters.get("s2"));   // a shared unique identifier merges
  });

  it("decisions override scores and are reversible by a later not_same", () => {
    const ents = [P("a", "person", "Jules Marchand"), P("b", "person", "Jules MARCHAND", { keys: { licence: ["1000001"] } }), ...filler];
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

describe("identity: scores propose, only keys/decisions/owner merge (v0.4 §5)", () => {
  it("a high-scoring same-name pair with lots of context is a hypothesis, not a merge", () => {
    const r = resolve([
      P("s1", "person", "Jules Marchand", { neighbors: new Set(["uni", "club", "aix"]) }),
      P("s2", "person", "Jules MARCHAND", { neighbors: new Set(["uni", "club", "aix"]) }), ...filler], []);
    expect(r.merges.some((m) => [m.a, m.b].includes("s1") && [m.a, m.b].includes("s2"))).toBe(false);
    expect(r.hypotheses.some((h) => [h.a, h.b].includes("s1") && [h.a, h.b].includes("s2"))).toBe(true);
  });
  it("a shared unique identifier merges; a judgment (decision) merges; a conflicting unique key never merges", () => {
    const key = resolve([P("a", "person", "Jane Doe", { keys: { email: ["j@x.org"] } }), P("b", "person", "Jane M. Doe", { keys: { email: ["j@x.org"] } }), ...filler], []);
    expect(key.clusters.get("a")).toBe(key.clusters.get("b"));
    const judged = resolve([P("a", "person", "Jules Marchand"), P("b", "person", "Jules MARCHAND"), ...filler], [{ a_id: "a", b_id: "b", verdict: "same" }]);
    expect(judged.clusters.get("a")).toBe(judged.clusters.get("b"));
    const conflict = resolve([P("a", "person", "Jane Doe", { keys: { email: ["a@x.org"] } }), P("b", "person", "Jane Doe", { keys: { email: ["b@y.org"] } }), ...filler], [{ a_id: "a", b_id: "b", verdict: "same" }]);
    expect(conflict.clusters.get("a")).not.toBe(conflict.clusters.get("b"));   // a hard-key conflict guards even a decision
  });
});


import { identityKeysFromHints } from "../src/normalize.ts";
describe("hint-key validation", () => {
  it("keeps well-formed identifiers and rejects junk that would forge false matches", () => {
    const ok = identityKeysFromHints({ email: "A@B.com", handle: "@Casey_Sample", url: "https://www.x.com/foo/", licence: "1000002" });
    expect(ok.email).toEqual(["a@b.com"]);
    expect(ok.handle).toEqual(["casey_sample"]);
    expect(ok.url).toEqual(["x.com/foo"]);
    expect(ok.licence).toEqual(["1000002"]);
    const junk = identityKeysFromHints({ handle: "General Partner", licence: "Board Member", email: "not an email", url: "San Francisco" });
    expect(Object.keys(junk)).toHaveLength(0);
  });
});

describe("resolve — same-name organizations (the examplerealm lesson)", () => {
  it("keeps two same-name orgs on different domains apart, and leaves keyless mentions to the judge", () => {
    const ents = [
      P("mc", "organization", "Example Realm", { keys: { domain: ["examplerealm.online"], url: ["examplerealm.online"] } }),
      P("coach", "organization", "Example Realm", { keys: { domain: ["examplerealm.com"] } }),
      P("plain", "organization", "Example Realm"),
      ...filler,
    ];
    const r = resolve(ents, []);
    expect(r.clusters.get("mc")).not.toBe(r.clusters.get("coach"));
    expect(r.clusters.get("plain")).not.toBe(r.clusters.get("mc"));
    expect(r.clusters.get("plain")).not.toBe(r.clusters.get("coach"));
    const hyp = (a: string, b: string) => r.hypotheses.some((h) => [h.a, h.b].includes(a) && [h.a, h.b].includes(b));
    expect(hyp("plain", "mc")).toBe(true);
    expect(hyp("plain", "coach")).toBe(true);
    expect(hyp("mc", "coach")).toBe(false);
  });
  it("attaches keyless mentions to the keyed record when the name is unambiguous", () => {
    const ents = [P("k", "organization", "Cloudflare", { keys: { domain: ["cloudflare.com"] } }), P("p", "organization", "Cloudflare"), ...filler];
    const r = resolve(ents, []);
    expect(r.clusters.get("p")).toBe(r.clusters.get("k"));
    expect(r.merges.some((m) => m.features.name_unambiguous)).toBe(true);
  });
  it("subdomains do not conflict: investors.palantir.com and palantir.com are the same registrable domain", () => {
    const ents = [P("a", "organization", "Palantir Technologies", { keys: { url: ["investors.palantir.com"] } }), P("b", "organization", "Palantir Technologies", { keys: { domain: ["palantir.com"] } }), ...filler];
    const r = resolve(ents, []);
    expect(r.clusters.get("a")).toBe(r.clusters.get("b"));
    expect(registrableDomain("https://investors.palantir.com/x")).toBe("palantir.com");
    expect(registrableDomain("company-information.service.gov.uk")).toBe("service.gov.uk");
    expect(orgIdentityKey({ url: ["www.examplerealm.com"] })).toBe("domain:examplerealm.com");
    expect(orgIdentityKey({})).toBe("");
  });
});
