// The dispatcher (M2_DESIGN §3, HANDOFF B2): turn a Question's indicators into gaps, bundle gaps into scored
// Missions. Deterministic, no LLM. A gap is an indicator that this graph doesn't yet satisfy on the subject OR on
// a neighbour the Question reaches: an entity earns attention when it sits on an indicator predicate from the
// subject (ring 1), or from such an entity (ring 2). Which indicators apply to a neighbour is derived from the
// ontology (a predicate's domain/range decides whether "employment" means where a person works or who works at
// an org) — no per-type hand lists. Ring decay is a score feature, never a gate (INVESTIGATION_MODEL §3); links
// that are weak (unverified/disputed, single low-grade origin) cap the attention they can raise (weak-key ban).
import { registry as loadRegistry, type Registry } from "@worldgraph/core";
import type { Graph, GEntity, GLink } from "@worldgraph/knowledge";
import type { Indicator } from "./compile.ts";

export interface Gap {
  entity: string; entityName: string; entityType: string; indicator: string; predicates: string[]; kind: "missing" | "thin";
  ring: number; weight: number; have: number; origins: number;
  /** how this entity was reached (ring ≥ 1): the predicate and the entity it hangs off, plus the link's quality factor */
  via?: { predicate: string; from: string; fromName: string; quality: number; structural: boolean };
}
export interface MissionDraft { objective: string; scope: { entities: string[]; indicators: string[]; ring: number; entity_name?: string }; frontier: string[]; score: number; score_parts: Record<string, number>; dedupe_key: string }
export interface GapOptions { maxRing?: number; minOrigins?: number; registry?: Registry; expandTypes?: string[] }

/** Independent-origin count for `entity` on any of `predicates` (max across them), either direction. */
function coverage(g: Graph, entity: string, predicates: string[]): { have: number; origins: number } {
  const pset = new Set(predicates);
  let have = 0, origins = 0;
  for (const l of [...(g.out.get(entity) ?? []), ...(g.inn.get(entity) ?? [])]) {
    if (pset.has(l.predicate)) { have++; origins = Math.max(origins, l.independent_origins); }
  }
  return { have, origins };
}

/** The weak-key ban as a factor: attention raised through a shaky link is capped, never zero. */
export const LINK_QUALITY: Record<string, number> = { established: 1, corroborated: 1, single_source: 0.7, unverified: 0.3, disputed: 0.2 };
const linkQuality = (l: GLink) => (l.contested ? 0.2 : LINK_QUALITY[l.grade] ?? 0.3);

/** Structural predicates bind an entity into the subject's world (membership, ownership, family, creation); the
 *  rest are transactional (a payment, a lawsuit, a mention, an address). Derived from the ontology tree, so a new
 *  predicate inherits its parent's nature. A neighbour reached transactionally inherits only the indicator that
 *  reached it and is discounted — a contract counterparty's own leadership rarely serves the Question. */
const STRUCTURAL_ROOTS = ["member_of", "owns", "controls", "part_of", "related_to", "knows", "created", "holds", "uses_account"];
export const isStructural = (predicate: string, reg: Registry) => STRUCTURAL_ROOTS.some((r) => reg.isA(predicate, r));

/** Does indicator `ind` say anything about an entity of `type`? Yes when one of its predicates has that type in
 *  its domain (the entity would be the subject) or its range (the entity would be the object). */
export function indicatorApplies(ind: Indicator, type: string, reg: Registry): boolean {
  return ind.predicates.some((p) => { const s = reg.predicates[p]; return !!s && (s.domain.includes("*") || s.domain.includes(type) || s.range.includes("*") || s.range.includes(type)); });
}

/** Gaps for a question: the subject (ring 0) and the entities the indicators reach (rings 1..maxRing). */
export function computeGaps(g: Graph, subjectId: string, indicators: Indicator[], minOrigins = 2, opts: GapOptions = {}): Gap[] {
  const reg = opts.registry ?? loadRegistry();
  const maxRing = opts.maxRing ?? 2;
  const expandTypes = new Set(opts.expandTypes ?? ["person", "organization"]);
  const indPreds = new Set(indicators.flatMap((i) => i.predicates));
  const gaps: Gap[] = [];
  const gapsFor = (e: GEntity, ring: number, via?: Gap["via"]) => {
    for (const ind of indicators) {
      if (ring > 0 && !indicatorApplies(ind, e.type, reg)) continue;
      if (via && !via.structural && !ind.predicates.includes(via.predicate)) continue;
      const { have, origins } = coverage(g, e.id, ind.predicates);
      const base = { entity: e.id, entityName: e.name, entityType: e.type, indicator: ind.name, predicates: ind.predicates, ring, weight: ind.weight, have, origins, via };
      if (have === 0) gaps.push({ ...base, kind: "missing" });
      else if (origins < minOrigins) gaps.push({ ...base, kind: "thin" });
    }
  };
  const subj = g.entities.get(subjectId);
  if (!subj) return gaps;
  gapsFor(subj, 0);
  // expansion: breadth-first over indicator predicates; an entity keeps the best (closest, strongest) route to it
  const reached = new Map<string, { ring: number; via: NonNullable<Gap["via"]> }>([[subjectId, { ring: 0, via: { predicate: "", from: "", fromName: "", quality: 1, structural: true } }]]);
  let frontier = [subjectId];
  for (let ring = 1; ring <= maxRing && frontier.length; ring++) {
    const next: string[] = [];
    for (const from of frontier) {
      const fromQ = reached.get(from)!.via.quality;
      for (const l of [...(g.out.get(from) ?? []), ...(g.inn.get(from) ?? [])]) {
        if (!indPreds.has(l.predicate)) continue;
        const otherId = l.src === from ? l.dst : l.src;
        const other = g.entities.get(otherId);
        if (!other || !expandTypes.has(other.type)) continue;
        const quality = Math.min(fromQ, linkQuality(l));
        const structural = isStructural(l.predicate, reg) && reached.get(from)!.via.structural;
        const cur = reached.get(otherId);
        // keep the best route: closest ring, then structural over transactional, then strongest link
        if (cur && (cur.ring < ring || (cur.via.structural && !structural) || (cur.via.structural === structural && cur.via.quality >= quality))) continue;
        reached.set(otherId, { ring, via: { predicate: l.predicate, from, fromName: g.entities.get(from)?.name ?? from, quality, structural } });
        if (!cur) next.push(otherId);
      }
    }
    for (const id of next) { const r = reached.get(id)!; gapsFor(g.entities.get(id)!, r.ring, r.via); }
    frontier = next;
  }
  return gaps;
}

/** Bundle gaps into missions (one per entity × indicator) and score them. */
export function buildMissions(gaps: Gap[], weights = { missing: 1.4, thin: 1.0 }): MissionDraft[] {
  const missions = gaps.map((gap) => {
    const ring_decay = 1 / (1 + gap.ring);
    const kindMul = gap.kind === "missing" ? weights.missing : weights.thin;
    const link_quality = gap.via?.quality ?? 1;
    const route = gap.via ? (gap.via.structural ? 1 : 0.4) : 1;
    const expected_gain = gap.weight * kindMul;
    const score = Number((expected_gain * ring_decay * link_quality * route).toFixed(4));
    const verb = gap.indicator.replace(/_/g, " ");
    const routeText = gap.via ? ` (ring ${gap.ring}: ${gap.via.predicate.replace(/_/g, " ")} of ${gap.via.fromName})` : "";
    return {
      objective: gap.kind === "missing"
        ? `Find ${verb} for ${gap.entityName}${routeText}`
        : `Corroborate ${verb} for ${gap.entityName}${routeText} (have ${gap.have}, ${gap.origins} independent origin${gap.origins === 1 ? "" : "s"})`,
      scope: { entities: [gap.entity], indicators: [gap.indicator], ring: gap.ring },
      frontier: [`"${gap.entityName}" ${keywordsFor(gap)}`.trim()],
      score,
      score_parts: { weight: gap.weight, kind_mul: kindMul, ring_decay, link_quality, route, expected_gain },
      dedupe_key: `${gap.entity}|${gap.indicator}`,
    };
  });
  return missions.sort((a, b) => b.score - a.score);
}

const PRED_KEYWORDS: Record<string, string> = {
  works_at: "career role employer", board_member: "board director", founded: "founder co-founder",
  manages: "leads runs", member_of: "member", spouse_of: "spouse married", parent_of: "children family",
  knows: "colleague collaborator", related_to: "associate", studied_at: "education degree university",
  located_in: "based lives city", authored: "author wrote", paid: "investor funding", owns: "owner stake shareholder",
  subsidiary_of: "subsidiary parent company", controls: "controlling shareholder", party_to: "lawsuit court case",
  transacted_with: "deal partner contract", uses_account: "profile handle account",
};
const ORG_KEYWORDS: Record<string, string> = { works_at: "employees executives team", board_member: "board of directors", founded: "founders founded", manages: "CEO leadership executives", member_of: "members", owns: "owned by shareholders investors", paid: "funding investors revenue" };
function keywordsFor(gap: Gap): string {
  const table = gap.entityType === "organization" ? { ...PRED_KEYWORDS, ...ORG_KEYWORDS } : PRED_KEYWORDS;
  const kw = gap.predicates.map((p) => table[p]).filter(Boolean).join(" ");
  return kw || gap.indicator.replace(/_/g, " ");
}
