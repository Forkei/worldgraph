// B-cubed (Bagga & Baldwin 1998) for entity resolution: per mention, precision = share of its system cluster
// that is truly the same entity; recall = share of its true cluster the system put together. Averaged over
// mentions, so a big wrongly-merged cluster costs proportionally. Gold = clusters of provisional-entity ids.

import { readFileSync } from "node:fs";
import yaml from "yaml";

export interface B3 { precision: number; recall: number; f1: number; mentions: number; gold_clusters: number; system_clusters: number; over_merged: string[][]; under_merged: string[][] }

/** `system` and `gold` map a mention (provisional id) to its cluster id. Mentions absent from gold are ignored. */
export function bcubed(system: Map<string, string>, gold: Map<string, string>): B3 {
  const sysMembers = new Map<string, Set<string>>(), goldMembers = new Map<string, Set<string>>();
  for (const [m, c] of gold) { (goldMembers.get(c) ?? goldMembers.set(c, new Set()).get(c)!).add(m); }
  for (const [m, c] of system) if (gold.has(m)) (sysMembers.get(c) ?? sysMembers.set(c, new Set()).get(c)!).add(m);
  let p = 0, r = 0, n = 0;
  for (const [m, gc] of gold) {
    const sc = system.get(m);
    if (sc === undefined) continue;
    const S = sysMembers.get(sc)!, G = goldMembers.get(gc)!;
    let both = 0;
    for (const x of S) if (G.has(x)) both++;
    p += both / S.size; r += both / G.size; n++;
  }
  const precision = n ? p / n : 0, recall = n ? r / n : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  // diagnostics: system clusters spanning several gold clusters (over-merged) and gold clusters split across systems (under-merged)
  const over_merged: string[][] = [], under_merged: string[][] = [];
  for (const S of sysMembers.values()) { const gs = new Set([...S].map((m) => gold.get(m)!)); if (gs.size > 1) over_merged.push([...S]); }
  for (const G of goldMembers.values()) { const ss = new Set([...G].map((m) => system.get(m)).filter((x): x is string => x !== undefined)); if (ss.size > 1) under_merged.push([...G]); }
  return { precision: round(precision), recall: round(recall), f1: round(f1), mentions: n, gold_clusters: goldMembers.size, system_clusters: sysMembers.size, over_merged, under_merged };
}
const round = (x: number) => Number(x.toFixed(4));

/** Gold file shape (YAML): entities: [{ name, type, members: [provisional_id, …] }] — hand-checked clusters. */
export interface GoldFile { investigation: string; reviewed: boolean; note?: string; entities: { name: string; type: string; members: string[] }[] }

export function loadGoldFile(path: string): GoldFile {
  return yaml.parse(readFileSync(path, "utf8")) as GoldFile;
}

export function goldToMap(g: GoldFile): Map<string, string> {
  const m = new Map<string, string>();
  g.entities.forEach((e, i) => { for (const id of e.members) m.set(id, `g${i}`); });
  return m;
}
