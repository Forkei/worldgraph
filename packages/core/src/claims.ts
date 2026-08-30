// The claim model v2 (INVESTIGATION_MODEL §1.3, M1_DESIGN §2). Two kinds with identical provenance and time.
// Claims are immutable and append-only; everything else in the graph is a view over them.
import type { AttributeClass, Datatype, TemporalKind, TimeQualifier } from "./ontology/registry.ts";

export type ClaimStatus = "raw" | "resolved" | "rejected" | "redacted";

export interface Mention {
  /** exactly as written, e.g. "Mrs Doe" */
  surface: string;
  /** best full canonical name, e.g. "Jane Doe" */
  name: string;
  /** a registry node type; unknown types resolve to a parent type with `type_label = candidate:<label>` */
  type: string;
  type_label?: string | null;
  /** subtype if known (company, city, race …) */
  kind?: string | null;
  hints: Record<string, string>;
  surface_in_quote: boolean;
}

export interface Time {
  temporal_kind: TemporalKind;
  valid_from_edtf: string | null;
  valid_to_edtf: string | null;
  date_edtf: string | null;
  valid_from_lo: string | null; valid_from_hi: string | null;
  valid_to_lo: string | null;   valid_to_hi: string | null;
  date_lo: string | null;       date_hi: string | null;
  time_qualifier: TimeQualifier;
  /** page/publish date (ISO) — the world-time anchor for snapshots */
  asserted_at: string | null;
}

export interface Provenance extends Time {
  investigation_id: string;
  source_id: string;
  chunk_index: number;
  chunk_hash: string;
  quote: string;
  span_start: number | null;
  span_end: number | null;
  span_method: "exact" | "fuzzy" | null;
  /** the model's own number, kept raw, never used for scoring */
  extractor_conf_raw: number;
  verified: boolean | null;
  attribute_class: AttributeClass;
  status: ClaimStatus;
  reject_reason: string | null;
  redaction_reason: string | null;
  inferred: boolean;
  derivation: Record<string, string> | null;
  schema_version: string;
  extractor: { model: string; prompt_version: string; effort?: string | null; cost_usd: number };
}

export interface RelationClaim extends Provenance {
  id: string;
  kind: "relation";
  subject: Mention;
  /** a registry predicate (candidates resolve to their parent) */
  predicate: string;
  /** candidate:<label> when the model proposed a more specific predicate */
  predicate_specific: string | null;
  object: Mention;
  qualifiers: Record<string, string>;
}

export interface AttributeClaim extends Provenance {
  id: string;
  kind: "attribute";
  entity: Mention;
  /** a registry attribute key (candidates resolve to their parent key) */
  key: string;
  key_specific: string | null;
  value: string;
  value_norm: string;
  datatype: Datatype;
}

export type Claim = RelationClaim | AttributeClaim;

/** Shape the extractor model must emit (mirrors Registry.extractionJsonSchema()). */
export interface TimeOut { temporal_kind: TemporalKind; valid_from: string; valid_to: string; date: string; time_qualifier: TimeQualifier; inferred: boolean; derivation: string }
export interface ExtractionOutput {
  mentions: { ref: string; surface: string; name: string; type: string; type_label: string; type_parent: string; kind: string; hints: { key: string; value: string }[] }[];
  relations: ({ subject: string; predicate: string; candidate_label: string; candidate_parent: string; object: string; qualifiers: { key: string; value: string }[]; quote: string; confidence: number; attribute_class: AttributeClass } & TimeOut)[];
  attributes: ({ entity: string; key: string; key_parent: string; value: string; datatype: Datatype; quote: string; confidence: number; attribute_class: AttributeClass } & TimeOut)[];
  page: { published_at: string; summary: string };
}

export const kvToRecord = (kv: { key: string; value: string }[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { key, value } of kv ?? []) if (key && value !== "") out[key] = value;
  return out;
};
export const normValue = (v: string): string => v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
