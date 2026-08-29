import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunk.ts";

const para = (n: number, len = 500) => `P${n} ` + "x".repeat(len - 4);

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    const c = chunkText("hello world");
    expect(c).toHaveLength(1);
    expect(c[0]!.start).toBe(0);
    expect(c[0]!.end).toBe(11);
  });

  it("never splits a paragraph and keeps chunks under maxChars", () => {
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text, { maxChars: 1600, overlapChars: 0 });
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1600);
      expect(text.slice(c.start, c.end)).toBe(c.text);
      // chunk starts at a paragraph start
      expect(c.start === 0 || text.slice(c.start - 2, c.start) === "\n\n").toBe(true);
    }
    expect(chunks.at(-1)!.end).toBe(text.length);
  });

  it("overlaps consecutive chunks by at least one paragraph when asked", () => {
    const text = Array.from({ length: 10 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text, { maxChars: 1600, overlapChars: 600 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end);
  });

  it("hard-splits a single oversized paragraph", () => {
    const text = "y".repeat(5000);
    const chunks = chunkText(text, { maxChars: 2000, overlapChars: 0 });
    expect(chunks.map((c) => c.text.length)).toEqual([2000, 2000, 1000]);
  });

  it("produces stable hashes", () => {
    const a = chunkText("same text", {});
    const b = chunkText("same text", {});
    expect(a[0]!.hash).toBe(b[0]!.hash);
  });
});
