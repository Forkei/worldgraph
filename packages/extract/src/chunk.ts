// Chunker (§6.1): contiguous slices of the source text, packed on paragraph boundaries, with overlap.
// A chunk is a [start, end) range into the original text, so spans located inside a chunk map back
// to the source by adding `start`.
import { createHash } from "node:crypto";

export interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
  hash: string;
}

export interface ChunkOptions {
  /** ≈ 6k tokens */
  maxChars?: number;
  /** ≈ 300 tokens */
  overlapChars?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 24_000;
  const overlap = opts.overlapChars ?? 1_200;
  if (!text.trim()) return [];

  // paragraph boundaries: positions where a new paragraph starts
  const bounds: number[] = [0];
  const re = /\n\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) bounds.push(m.index + m[0].length);
  if (bounds[bounds.length - 1] !== text.length) bounds.push(text.length);

  // a single paragraph longer than maxChars is split hard at maxChars
  const cuts: number[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let s = bounds[i]!;
    const e = bounds[i + 1]!;
    cuts.push(s);
    while (e - s > maxChars) { s += maxChars; cuts.push(s); }
  }
  cuts.push(text.length);

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    // extend end to the last cut that keeps the chunk ≤ maxChars
    let end = start;
    for (const c of cuts) {
      if (c <= start) continue;
      if (c - start <= maxChars) end = c; else break;
    }
    if (end <= start) end = Math.min(text.length, start + maxChars);
    const slice = text.slice(start, end);
    chunks.push({ index: chunks.length, start, end, text: slice, hash: createHash("sha256").update(slice).digest("hex") });
    if (end >= text.length) break;
    // next start: the latest cut that is ≥ end - overlap and > start
    let next = end;
    for (const c of cuts) if (c > start && c >= end - overlap && c < end) { next = c; break; }
    start = next;
  }
  return chunks;
}
