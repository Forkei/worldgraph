// Text normalization with an offset map, so a match in normalized space maps back to exact character
// positions in the original text. Normalized form: NFKC, lowercase, only letters/digits, runs of
// anything else collapsed to one space, trimmed.
export interface Normalized {
  norm: string;
  /** map[i] = index in the original string of the character that produced norm[i] */
  map: number[];
}

const ALNUM = /[\p{L}\p{N}]/u;

export function normalizeWithMap(text: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const n = ch.normalize("NFKC").toLowerCase();
    for (const c of n) {
      if (ALNUM.test(c)) {
        if (pendingSpace && out.length) { out.push(" "); map.push(i); }
        pendingSpace = false;
        out.push(c);
        map.push(i);
      } else {
        pendingSpace = true;
      }
    }
    i += ch.length;
  }
  return { norm: out.join(""), map };
}

export const normalize = (s: string): string => normalizeWithMap(s).norm;
