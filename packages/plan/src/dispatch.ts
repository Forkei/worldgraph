// The dispatcher (M2_DESIGN §3): turn a Question's indicators into gaps, bundle gaps into scored Missions.
// Deterministic, no LLM. A gap is an indicator that this graph doesn't yet satisfy on the subject (or a ring-1
// neighbour). Score ranks missions; it never decides truth (M2_DESIGN §4). v1 missions run as scripted
// search→fetch (missions.ts); agents come in step 4.
import type { Graph } from "@worldgraph/knowledge";
import type { Indicator } from "./compile.ts";

export interface Gap { entity: string; entityName: string; indicator: string; predicates: string[]; kind: "missing" | "thin"; ring: number; weight: number; have: number; origins: number }
export interface MissionDraft { objective: string; scope: { entities: string[]; indicators: string[] }; frontier: string[]; score: number; score_parts: Record<string, number>; dedupe_key: string }


/** Independent-origin count for `entity` on any of `predicates` (max across them). */
function coverage(g: Graph, entity: string, predicates: string[]): { have: number; origins: number } {
  const pset = new Set(predicates);
  let have = 0, origins = 0;
  for (const l of [...(g.out.get(entity) ?? []), ...(g.inn.get(entity) ?? [])]) {
    if (pset.has(l.predicate)) { have++; origins = Math.max(origins, l.independent_origins); }
  }
  return { have, origins };
}

/** Gaps for a question: for the subject and its ring-1 neighbours, indicators this graph doesn't satisfy. */
export function computeGaps(g: Graph, subjectId: string, indicators: Indicator[], minOrigins = 2): Gap[] {
  const gaps: Gap[] = [];
  const subjName = g.entities.get(subjectId)?.name ?? subjectId;
  // ring-0: the subject, every indicator
  for (const ind of indicators) {
    const { have, origins } = coverage(g, subjectId, ind.predicates);
    if (have === 0) gaps.push({ entity: subjectId, entityName: subjName, indicator: ind.name, predicates: ind.predicates, kind: "missing", ring: 0, weight: ind.weight, have, origins });
    else if (origins < minOrigins) gaps.push({ entity: subjectId, entityName: subjName, indicator: ind.name, predicates: ind.predicates, kind: "thin", ring: 0, weight: ind.weight, have, origins });
  }
  // v1 is SUBJECT-FOCUSED. Ring-1 auto-expansion is deliberately off: professional edges point to orgs (not
  // people), so a naive person-neighbour expansion is both inert and a sprawl risk (the model's rule: expand a
  // ring only when an indicator or hypothesis actually serves it, via the score — not by default). Collaborators
  // are found by the agent searching, and specific associates get their own investigation. [ring expansion: later]
  return gaps;
}

/** Bundle gaps into missions (one per entity × indicator for v1) and score them. */
export function buildMissions(gaps: Gap[], weights = { missing: 1.4, thin: 1.0 }): MissionDraft[] {
  const missions = gaps.map((gap) => {
    const ring_decay = 1 / (1 + gap.ring);
    const kindMul = gap.kind === "missing" ? weights.missing : weights.thin;
    const expected_gain = gap.weight * kindMul;
    const score = Number((expected_gain * ring_decay).toFixed(4));
    const verb = gap.indicator.replace(/_/g, " ");
    return {
      objective: gap.kind === "missing"
        ? `Find ${verb} for ${gap.entityName}`
        : `Corroborate ${verb} for ${gap.entityName} (have ${gap.have}, ${gap.origins} independent origin${gap.origins === 1 ? "" : "s"})`,
      scope: { entities: [gap.entity], indicators: [gap.indicator] },
      frontier: [`"${gap.entityName}" ${keywordsFor(gap)}`.trim()],
      score,
      score_parts: { weight: gap.weight, kind_mul: kindMul, ring_decay, expected_gain },
      dedupe_key: `${gap.entity}|${gap.indicator}`,
    };
  });
  return missions.sort((a, b) => b.score - a.score);
}

const PRED_KEYWORDS: Record<string, string> = {
  works_at: "career role employer", board_member: "board director", founded: "founder co-founder",
  manages: "leads runs", member_of: "member", spouse_of: "spouse married", parent_of: "children family",
  knows: "colleague collaborator", related_to: "associate", studied_at: "education degree university",
  located_in: "based lives city", authored: "author wrote", paid: "investor funding",
};
function keywordsFor(gap: Gap): string {
  const kw = gap.predicates.map((p) => PRED_KEYWORDS[p]).filter(Boolean).join(" ");
  return kw || gap.indicator.replace(/_/g, " ");
}
