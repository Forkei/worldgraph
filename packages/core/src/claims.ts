// The claim model (spec §4.3). Two kinds of claim with identical provenance. Claims are immutable and
// append-only; everything else in the graph is a view over them.
import type { AttributeClass, Datatype } from "./ontology/registry.ts";

export type ClaimStatus = "raw" | "resolved" | "rejected" | "redacted";

export interface Mention {
  /** exactly as written in the quote / text, e.g. "Mrs Doe" */
  surface: string;
  /** the extractor's best full canonical name for who/what is meant, e.g. "Jane Doe" */
  name: string;
  type: string;
  /** free text when type = "other" */
  type_label?: string;
  hints: Record<string, string>;
  /** false when the quote refers to the entity by pronoun/role only — allowed, weighted lower */
  surface_in_quote: boolean;
}

export interface Provenance {
  investigation_id: string;
  source_id: string;
  chunk_index: number;
  chunk_hash: string;
  quote: string;
  span_start: number | null;
  span_end: number | null;
  /** how the quote was located: exact | fuzzy; null when rejected */
  span_method: "exact" | "fuzzy" | null;
  confidence: number;
  verified: boolean | null;
  attribute_class: AttributeClass;
  status: ClaimStatus;
  reject_reason: string | null;
  redaction_reason: string | null;
  extractor: { model: string; prompt_version: string; effort?: string | null; cost_usd: number };
}

export interface RelationClaim extends Provenance {
  id: string;
  kind: "relation";
  subject: Mention;
  predicate: string;
  predicate_label: string | null;
  object: Mention;
  properties: Record<string, string>;
}

export interface AttributeClaim extends Provenance {
  id: string;
  kind: "attribute";
  entity: Mention;
  key: string;
  value: string;
  value_norm: string;
  datatype: Datatype;
  properties: Record<string, string>;
}

export type Claim = RelationClaim | AttributeClaim;

/** Shape the extractor model must emit (mirrors Registry.extractionJsonSchema()). */
export interface ExtractionOutput {
  mentions: { ref: string; surface: string; name: string; type: string; type_label: string; hints: { key: string; value: string }[] }[];
  relations: {
    subject: string; predicate: string; predicate_label: string; object: string;
    properties: { key: string; value: string }[]; quote: string; confidence: number; attribute_class: AttributeClass;
  }[];
  attributes: {
    entity: string; key: string; value: string; datatype: Datatype;
    properties: { key: string; value: string }[]; quote: string; confidence: number; attribute_class: AttributeClass;
  }[];
  page: { published_at: string; summary: string };
}

export const kvToRecord = (kv: { key: string; value: string }[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { key, value } of kv ?? []) if (key) out[key] = value;
  return out;
};

export const normValue = (v: string): string => v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
