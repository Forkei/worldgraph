// Quote gate (§6.4). HARD: the quote must be located in the text — exactly (normalized) or by a narrow
// fuzzy match — or the claim is rejected. SOFT: whether the mention's surface appears inside the quote
// is recorded, never enforced.
import { normalizeWithMap, normalize, type Normalized } from "./normalize.ts";

export interface Located {
  start: number;
  end: number;
  method: "exact" | "fuzzy";
  /** similarity ratio for fuzzy matches (1 for exact) */
  ratio: number;
}

export const MIN_QUOTE_NORM_CHARS = 6;
export const FUZZY_MIN_RATIO = 0.9;
const FUZZY_MIN_TOKENS = 3;
const MAX_ANCHORS = 400;

/** Citation markers ("[23]", "[a]", "[note 4]", "[citation needed]", "[edit]") sit between words on wiki-style
 *  pages and break verbatim matching. They are blanked with same-length spaces so offsets stay exact. */
export const CITATION_MARK = /\[\[(?:\d{1,4}|[a-z]|note \d{1,3})\]\]\([^)\s]*\)|\[(?:\d{1,4}|[a-z]|note \d{1,3}|citation needed|edit|clarification needed|when\?|who\?)\]/gi;
export const blankCitations = (text: string): string => text.replace(CITATION_MARK, (m) => " ".repeat(m.length));

export function prepareText(text: string): Normalized {
  return normalizeWithMap(blankCitations(text));
}

/** Locate `quote` inside prepared text. Returns original-text offsets [start, end). */
/** Models sometimes emit literal "\n" (backslash-n) sequences inside JSON strings for line breaks. */
export const unescapeQuote = (quote: string): string => quote.replace(/\\[ntr]/g, " ");

export function locateQuote(quote: string, prepared: Normalized): Located | null {
  const q = normalize(unescapeQuote(quote));
  if (q.length < MIN_QUOTE_NORM_CHARS) return null;
  const idx = prepared.norm.indexOf(q);
  if (idx >= 0) return { start: prepared.map[idx]!, end: prepared.map[idx + q.length - 1]! + 1, method: "exact", ratio: 1 };
  return fuzzyLocate(q, prepared);
}

export function surfaceInQuote(surface: string, quote: string): boolean {
  const s = normalize(surface);
  return s.length > 0 && normalize(quote).includes(s);
}

// ---- fuzzy: token windows anchored on the quote's first (or second) token, char-level Levenshtein ratio
interface Tok { t: string; at: number } // at = index into prepared.norm

function tokenize(norm: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) toks.push({ t: m[0], at: m.index });
  return toks;
}

let tokCache: { norm: string; toks: Tok[] } | null = null;
function tokensOf(prepared: Normalized): Tok[] {
  if (tokCache && tokCache.norm === prepared.norm) return tokCache.toks;
  const toks = tokenize(prepared.norm);
  tokCache = { norm: prepared.norm, toks };
  return toks;
}

function fuzzyLocate(q: string, prepared: Normalized): Located | null {
  const qToks = q.split(" ");
  if (qToks.length < FUZZY_MIN_TOKENS) return null;
  const toks = tokensOf(prepared);
  const len = qToks.length;
  let best: { ratio: number; s: number; e: number } | null = null;
  let anchors = 0;
  for (let p = 0; p < toks.length && anchors < MAX_ANCHORS; p++) {
    const tok = toks[p]!.t;
    let startTok = -1;
    if (tok === qToks[0]) startTok = p;
    else if (tok === qToks[1] && p > 0) startTok = p - 1;
    if (startTok < 0) continue;
    anchors++;
    for (const w of [len, len + 1, len - 1]) {
      if (w < 2 || startTok + w > toks.length) continue;
      const first = toks[startTok]!, last = toks[startTok + w - 1]!;
      const window = prepared.norm.slice(first.at, last.at + last.t.length);
      const ratio = similarity(q, window);
      if (ratio >= FUZZY_MIN_RATIO && (!best || ratio > best.ratio)) best = { ratio, s: first.at, e: last.at + last.t.length };
    }
  }
  if (!best) return null;
  return { start: prepared.map[best.s]!, end: prepared.map[best.e - 1]! + 1, method: "fuzzy", ratio: best.ratio };
}

export function similarity(a: string, b: string): number {
  const n = Math.max(a.length, b.length);
  if (n === 0) return 1;
  return 1 - levenshtein(a, b) / n;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}
