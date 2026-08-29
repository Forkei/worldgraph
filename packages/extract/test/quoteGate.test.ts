import { describe, it, expect } from "vitest";
import { prepareText, locateQuote, surfaceInQuote } from "../src/quoteGate.ts";
import { normalizeWithMap } from "../src/normalize.ts";

const text = `Tim Sample

Founders
University Professor

Machine
Learning Department

Example University University

Visiting Scholar at the Digital Economy Lab, Stanford University.
He said: “We’re building it — carefully.” Contact: someone@example.edu, 555 010 0000.`;

describe("normalizeWithMap", () => {
  it("maps normalized offsets back to the original", () => {
    const { norm, map } = normalizeWithMap("  Héllo,   World!! ");
    expect(norm).toBe("héllo world");
    expect(map[0]).toBe(2);              // 'h'
    expect(map[norm.indexOf("w")]).toBe(11);
  });
});

describe("locateQuote", () => {
  const prepared = prepareText(text);

  it("finds an exact quote and returns original offsets", () => {
    const loc = locateQuote("Visiting Scholar at the Digital Economy Lab", prepared)!;
    expect(loc.method).toBe("exact");
    expect(text.slice(loc.start, loc.end)).toBe("Visiting Scholar at the Digital Economy Lab");
  });

  it("ignores punctuation, casing, curly quotes and dashes", () => {
    const loc = locateQuote('we\'re building it - carefully', prepared)!;
    expect(loc.method).toBe("exact");
    expect(text.slice(loc.start, loc.end)).toBe("We’re building it — carefully");
  });

  it("matches across line breaks when the model joined lines with commas", () => {
    const loc = locateQuote("Founders University Professor, Machine Learning Department, Example University University", prepared)!;
    expect(loc).not.toBeNull();
    expect(loc.method).toBe("exact");
    expect(text.slice(loc.start, loc.end).startsWith("Founders")).toBe(true);
    expect(text.slice(loc.start, loc.end).endsWith("Example University University")).toBe(true);
  });

  it("accepts a near-verbatim quote via fuzzy match", () => {
    const loc = locateQuote("Visiting Scholar at the Digital Economy Labs, Stanford University", prepared)!;
    expect(loc).not.toBeNull();
    expect(loc.method).toBe("fuzzy");
    expect(loc.ratio).toBeGreaterThanOrEqual(0.9);
    expect(text.slice(loc.start, loc.end)).toContain("Digital Economy Lab");
  });

  it("tolerates literal backslash-n line breaks emitted inside JSON strings", () => {
    const loc = locateQuote("Founders\\n\\nUniversity Professor", prepared)!;
    expect(loc).not.toBeNull();
    expect(text.slice(loc.start, loc.end)).toBe("Founders\nUniversity Professor");
  });

  it("rejects a paraphrase", () => {
    expect(locateQuote("Sample works as a professor at Example University in machine learning", prepared)).toBeNull();
  });

  it("rejects a fabricated stitched sentence", () => {
    expect(locateQuote("Board of Directors: Tim Sample, Founders University Professor", prepared)).toBeNull();
  });

  it("rejects too-short quotes", () => {
    expect(locateQuote("Tom", prepared)).toBeNull();
  });
});

describe("surfaceInQuote (soft check)", () => {
  it("is true when the surface is inside the quote", () => {
    expect(surfaceInQuote("Digital Economy Lab", "Visiting Scholar at the Digital Economy Lab")).toBe(true);
  });
  it("is false for pronoun-only quotes but never throws", () => {
    expect(surfaceInQuote("Tim Sample", "He said: we're building it")).toBe(false);
  });
});
