// Interval coverage holes on `covering` predicates (residence, employment): the union of intervals should
// cover the span from the earliest known start to today; holes wider than `minGapDays` become slots.
export interface Interval { lo: string | null; hi: string | null }   // ISO dates; null hi = ongoing

const day = 86_400_000;
const toMs = (d: string) => Date.parse(d);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function intervalHoles(intervals: Interval[], today: string, minGapDays = 730): { lo: string; hi: string }[] {
  const known = intervals.filter((i) => i.lo).map((i) => ({ lo: toMs(i.lo!), hi: i.hi ? toMs(i.hi) : toMs(today) })).sort((a, b) => a.lo - b.lo);
  if (!known.length) return [];
  const holes: { lo: string; hi: string }[] = [];
  let coveredTo = known[0]!.hi;
  for (let i = 1; i < known.length; i++) {
    const cur = known[i]!;
    if (cur.lo - coveredTo > minGapDays * day) holes.push({ lo: iso(coveredTo + day), hi: iso(cur.lo - day) });
    coveredTo = Math.max(coveredTo, cur.hi);
  }
  const end = toMs(today);
  if (end - coveredTo > minGapDays * day) holes.push({ lo: iso(coveredTo + day), hi: today });
  return holes;
}
