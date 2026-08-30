// EDTF (Extended Date/Time Format, Level 1 subset) → normalized date bounds.
// Accepts: YYYY · YYYY-MM · YYYY-MM-DD · trailing ~ (approximate) / ? (uncertain) / % (both) ·
//          YYYY/YYYY (interval) · [YYYY,YYYY] or [YYYY..YYYY] (one-of set → bounds) · 19XX / 201X (unspecified digits)
//          'circa 1985', 'c. 1985', 'about 1985', 'early 1990s', '1990s' are tolerated and mapped.
// Returns null for anything it cannot read — never guesses.
export interface EdtfBounds {
  edtf: string;          // normalized EDTF string
  lo: string;            // ISO date (inclusive lower bound)
  hi: string;            // ISO date (inclusive upper bound)
  precision: "day" | "month" | "year" | "decade" | "century" | "range";
  qualifier: "exact" | "circa" | "uncertain";
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function ymdBounds(y: number, m?: number, d?: number): { lo: string; hi: string; precision: EdtfBounds["precision"] } {
  if (d && m) return { lo: `${y}-${pad(m)}-${pad(d)}`, hi: `${y}-${pad(m)}-${pad(d)}`, precision: "day" };
  if (m) return { lo: `${y}-${pad(m)}-01`, hi: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, precision: "month" };
  return { lo: `${y}-01-01`, hi: `${y}-12-31`, precision: "year" };
}

export function parseEdtf(input: string | null | undefined): EdtfBounds | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  let qualifier: EdtfBounds["qualifier"] = "exact";
  const lower = s.toLowerCase();
  if (/^(circa|ca\.?|c\.|about|around|approx\.?|~)\s*/.test(lower)) { qualifier = "circa"; s = s.replace(/^(circa|ca\.?|c\.|about|around|approx\.?|~)\s*/i, ""); }
  // trailing qualifiers
  const q = s.match(/^(.*?)([~?%])$/);
  if (q) { s = q[1]!; qualifier = q[2] === "?" ? "uncertain" : "circa"; }
  const prefix = qualifier === "exact" ? "" : qualifier === "circa" ? "~" : "?";

  // interval a/b
  const iv = s.match(/^([^/]+)\/([^/]+)$/);
  if (iv) {
    const a = parseEdtf(iv[1]), b = parseEdtf(iv[2]);
    if (!a || !b) return null;
    return { edtf: `${a.edtf}/${b.edtf}`, lo: a.lo, hi: b.hi, precision: "range", qualifier };
  }
  // set [a,b] or [a..b]
  const set = s.match(/^\[(.+)\]$/);
  if (set) {
    const parts = set[1]!.split(/\.\.|,/).map((p) => parseEdtf(p.trim())).filter(Boolean) as EdtfBounds[];
    if (!parts.length) return null;
    const lo = parts.map((p) => p.lo).sort()[0]!, hi = parts.map((p) => p.hi).sort().at(-1)!;
    return { edtf: `[${parts.map((p) => p.edtf).join(",")}]`, lo, hi, precision: "range", qualifier };
  }
  // decades / centuries in words
  const dec = lower.match(/^(early |mid |late )?(\d{3})0s$/);
  if (dec) {
    const y0 = Number(dec[2]) * 10;
    const [lo, hi] = dec[1] === "early " ? [y0, y0 + 3] : dec[1] === "mid " ? [y0 + 3, y0 + 6] : dec[1] === "late " ? [y0 + 7, y0 + 9] : [y0, y0 + 9];
    return { edtf: `${dec[2]}X`, lo: `${lo}-01-01`, hi: `${hi}-12-31`, precision: "decade", qualifier: qualifier === "exact" ? "circa" : qualifier };
  }
  // unspecified digits 19XX / 201X
  const ux = s.match(/^(\d{2,3})X{1,2}$/i);
  if (ux) {
    const digits = ux[1]!, n = 4 - digits.length;
    const lo = Number(digits + "0".repeat(n)), hi = Number(digits + "9".repeat(n));
    return { edtf: (digits + "X".repeat(n)).toUpperCase(), lo: `${lo}-01-01`, hi: `${hi}-12-31`, precision: n === 1 ? "decade" : "century", qualifier };
  }
  // YYYY, YYYY-MM, YYYY-MM-DD (also tolerate YYYY/MM/DD and YYYY.MM)
  const m = s.match(/^(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?$/);
  if (m) {
    const y = Number(m[1]), mo = m[2] ? Number(m[2]) : undefined, d = m[3] ? Number(m[3]) : undefined;
    if (mo && (mo < 1 || mo > 12)) return null;
    if (d && mo && (d < 1 || d > lastDay(y, mo))) return null;
    const b = ymdBounds(y, mo, d);
    const edtf = `${y}${mo ? `-${pad(mo)}` : ""}${d ? `-${pad(d)}` : ""}${prefix}`;
    return { edtf, ...b, qualifier };
  }
  // ISO datetime → date
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) return parseEdtf(`${iso[1]}-${iso[2]}-${iso[3]}${prefix}`);
  return null;
}

/** "age 34" observed on `anchor` (ISO date) → date_of_birth bounds as an EDTF set. */
export function dobFromAge(age: number, anchor: string): EdtfBounds | null {
  const y = Number(anchor.slice(0, 4));
  if (!Number.isFinite(y) || !Number.isFinite(age) || age < 0 || age > 130) return null;
  return parseEdtf(`[${y - age - 1},${y - age}]`);
}

/** "N years at X" ending at `anchor` → approximate start year (circa). */
export function startFromDuration(years: number, anchor: string): EdtfBounds | null {
  const y = Number(anchor.slice(0, 4));
  if (!Number.isFinite(y) || !Number.isFinite(years) || years < 0) return null;
  return parseEdtf(`${Math.round(y - years)}~`);
}
