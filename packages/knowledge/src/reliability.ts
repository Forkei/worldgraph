// Source reliability without hardcoded domains (model §1.2, reliability v2).
//   tier = prior(doc_kind)                       what the document IS, classified from its own content
//        ↑ one step if self-published about itself   a company's own team page is authoritative about its roster
//        ± learned adjustment                     agreement / contradiction with independent origins, once enough is observed
//        overridden by an owner decision          a row in source_tiers, if the owner chose to assert one
export interface SourceFacts {
  doc_kind: string | null;
  self_published: boolean | null;
  publisher_entity_id: string | null;   // resolved publisher, if it maps to an entity in the graph
  agree_count: number;
  contradict_count: number;
  override_tier: string | null;         // owner override, if any
}
export interface Priors { [docKind: string]: string }   // doc_kind → tier letter

const ORDER = ["A", "B", "C", "D", "E", "F"];
const step = (tier: string, delta: number) => ORDER[Math.min(5, Math.max(0, ORDER.indexOf(tier) + delta))]!;
export const LEARN_MIN_OBSERVATIONS = 20;

/**
 * Reliability of `source` for a claim whose subject/object entities are `claimEntities`.
 * Self-publication only helps for facts about the publisher itself (or its members, when `aboutPublisher` says so).
 */
export function tierForClaim(source: SourceFacts, priors: Priors, aboutPublisher: boolean): string {
  if (source.override_tier) return source.override_tier;
  let tier = priors[source.doc_kind ?? "unknown"] ?? priors.unknown ?? "F";
  if (source.self_published && aboutPublisher) tier = step(tier, -1);
  const n = source.agree_count + source.contradict_count;
  if (n >= LEARN_MIN_OBSERVATIONS) {
    const rate = source.agree_count / n;
    if (rate >= 0.9) tier = step(tier, -1);
    else if (rate <= 0.5) tier = step(tier, +1);
  }
  return tier;
}
