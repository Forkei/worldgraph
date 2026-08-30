// Evidence grade (INVESTIGATION_MODEL §1.4; research 01/13): two axes, computed from the evidence profile,
// never stored by hand. Reliability = best source tier among the fact's origins (Admiralty A–F).
// Credibility = 1 confirmed by independent origins · 2 single good origin · 3 single weak origin ·
// 4 contested · 6 cannot be judged. The label is the human roll-up.
export interface EvidenceProfile {
  evidence_count: number;
  independent_origins: number;
  primary_origins: number;      // origins whose best source tier is A
  tier_best: string;            // A..F
  contested: boolean;
  fuzzy_only: boolean;          // every claim located its quote only by fuzzy match
}
export type GradeLabel = "established" | "corroborated" | "single_source" | "unverified" | "disputed";
export interface Grade { reliability: string; credibility: number; grade: GradeLabel }

const RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
export const betterTier = (a: string, b: string): string => (RANK[a] ?? 5) <= (RANK[b] ?? 5) ? a : b;

export function grade(p: EvidenceProfile): Grade {
  const reliability = RANK[p.tier_best] === undefined ? "F" : p.tier_best;
  const strong = RANK[reliability]! <= RANK.B!;
  if (p.contested) return { reliability, credibility: 4, grade: "disputed" };
  if (p.fuzzy_only || reliability === "F") return { reliability, credibility: reliability === "F" ? 6 : 3, grade: "unverified" };
  if (p.independent_origins >= 2) return { reliability, credibility: 1, grade: p.primary_origins >= 1 || strong ? "established" : "corroborated" };
  if (reliability === "A") return { reliability, credibility: 2, grade: "corroborated" };
  if (strong || reliability === "C") return { reliability, credibility: strong ? 2 : 3, grade: "single_source" };
  return { reliability, credibility: 3, grade: "unverified" };
}
