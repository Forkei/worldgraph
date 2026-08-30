import { describe, it, expect } from "vitest";
import { nameNorm, identityKeysFromHints, stableId } from "../src/normalize.ts";

describe("nameNorm", () => {
  it("groups organization variants but keeps the legal-entity distinction out of the norm only for suffixes", () => {
    expect(nameNorm("ACORN", "organization")).toBe("acorn");
    expect(nameNorm("Acorn", "organization")).toBe("acorn");
    expect(nameNorm("Acorn Capital Management LP", "organization")).toBe("acorn capital management");
    expect(nameNorm("Alder Maple Cedar & Dale", "organization")).toBe("alder maple cedar dale");
    expect(nameNorm("The Helix OpCo, LLC", "organization")).toBe("helix opco");
  });
  it("strips honorifics for people and keeps accents comparable", () => {
    expect(nameNorm("Mrs. Jane Doe", "person")).toBe("jane doe");
    expect(nameNorm("Eliot VARNEY", "person")).toBe("eliot varney");
    expect(nameNorm("Hélène D'Arcy", "person")).toBe("hélène darcy");
  });
  it("harvests identity keys from hints", () => {
    expect(identityKeysFromHints({ email: "JDoe@SPS186.org", url: "https://www.linkedin.com/in/jdoe/", org: "Lincoln MS", license: "IL-2011-1" }))
      .toEqual({ email: ["jdoe@sps186.org"], url: ["linkedin.com/in/jdoe"], licence: ["IL-2011-1"] });
  });
  it("stableId is deterministic and uuid-shaped", () => {
    const a = stableId("inv", "person", "jane doe"), b = stableId("inv", "person", "jane doe");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId("inv", "person", "john doe")).not.toBe(a);
  });
});
