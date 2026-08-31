// Source reliability = the publisher's relationship to the fact (model v0.3 §1.4). No doc-kind table, no
// domain list. The reading agent names the publisher and its kind; "self" is cross-checked against the graph
// (the publisher entity must actually be the fact's subject). The rungs ARE the Admiralty A–E scale.
//
//   authority   A   the issuing / official body for this kind of record (a federation about its own licences)
//   self        B   the subject speaking about itself (a company's own team page about its roster)
//   independent C   an independent witness / reporter
//   platform    D   a host of others' content (a social platform, a people-search aggregator)
//   anonymous   E   anonymous or unattributable
//   unknown     E   publisher not established yet (cold start climbs as the graph learns who they are)
export const LADDER: Record<string, string> = { authority: "A", self: "B", independent: "C", platform: "D", anonymous: "E", unknown: "E" };

export interface SourceFacts {
  publisher_kind: string | null;
  publisher_entity_id: string | null;   // resolved publisher, if it maps to an entity in the graph
  override_tier: string | null;         // owner override, if any
}

/**
 * Reliability letter for one claim. `aboutPublisher` is the graph's verdict on whether the source's publisher
 * entity is the very entity the claim concerns (or one of its members) — that is what turns a page into
 * self-testimony. The reader's word and the graph reconcile toward the truth:
 *   • graph says self, reader didn't claim it (independent/unknown) → self
 *   • reader claimed self, graph disagrees                          → at best independent
 */
export function tierForClaim(source: SourceFacts, aboutPublisher: boolean): string {
  if (source.override_tier) return source.override_tier;
  let kind = (source.publisher_kind ?? "unknown").toLowerCase();
  if (!(kind in LADDER)) kind = "unknown";
  if (aboutPublisher && (kind === "independent" || kind === "unknown")) kind = "self";
  if (kind === "self" && !aboutPublisher) kind = "independent";
  return LADDER[kind] ?? "E";
}
