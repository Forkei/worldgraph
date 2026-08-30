-- Claims v2: hierarchy-aware predicates (candidate:<label> kept as predicate_specific), schema version,
-- EDTF time with normalized bounds, temporal kind/qualifier, asserted_at, derivation, inferred, raw confidence.
-- Existing M0 rows are migrated: predicate 'other' → 'associated_with' + predicate_specific; confidence → extractor_conf_raw.

ALTER TABLE relation_claims
  ADD COLUMN predicate_specific text,
  ADD COLUMN schema_version     text NOT NULL DEFAULT 'm0',
  ADD COLUMN temporal_kind      text NOT NULL DEFAULT 'timeless' CHECK (temporal_kind IN ('interval','instant','snapshot','timeless')),
  ADD COLUMN valid_from_edtf    text, ADD COLUMN valid_to_edtf text, ADD COLUMN date_edtf text,
  ADD COLUMN valid_from_lo date, ADD COLUMN valid_from_hi date,
  ADD COLUMN valid_to_lo   date, ADD COLUMN valid_to_hi   date,
  ADD COLUMN date_lo       date, ADD COLUMN date_hi       date,
  ADD COLUMN time_qualifier text NOT NULL DEFAULT 'unknown' CHECK (time_qualifier IN ('exact','circa','before','after','unknown')),
  ADD COLUMN asserted_at    date,
  ADD COLUMN inferred       boolean NOT NULL DEFAULT false,
  ADD COLUMN derivation     jsonb,
  ADD COLUMN extractor_conf_raw real;
ALTER TABLE relation_claims RENAME COLUMN properties TO qualifiers;
UPDATE relation_claims SET extractor_conf_raw = confidence WHERE extractor_conf_raw IS NULL;
UPDATE relation_claims SET predicate_specific = 'candidate:' || regexp_replace(lower(coalesce(predicate_label, 'unknown')), '\s+', '_', 'g'), predicate = 'associated_with' WHERE predicate = 'other';
CREATE INDEX relation_claims_specific ON relation_claims (investigation_id, predicate_specific) WHERE predicate_specific IS NOT NULL;
CREATE INDEX relation_claims_valid ON relation_claims (investigation_id, valid_from_lo, valid_to_hi);

ALTER TABLE attribute_claims
  ADD COLUMN key_specific       text,
  ADD COLUMN schema_version     text NOT NULL DEFAULT 'm0',
  ADD COLUMN temporal_kind      text NOT NULL DEFAULT 'timeless' CHECK (temporal_kind IN ('interval','instant','snapshot','timeless')),
  ADD COLUMN valid_from_edtf    text, ADD COLUMN valid_to_edtf text, ADD COLUMN date_edtf text,
  ADD COLUMN valid_from_lo date, ADD COLUMN valid_from_hi date,
  ADD COLUMN valid_to_lo   date, ADD COLUMN valid_to_hi   date,
  ADD COLUMN date_lo       date, ADD COLUMN date_hi       date,
  ADD COLUMN time_qualifier text NOT NULL DEFAULT 'unknown' CHECK (time_qualifier IN ('exact','circa','before','after','unknown')),
  ADD COLUMN asserted_at    date,
  ADD COLUMN inferred       boolean NOT NULL DEFAULT false,
  ADD COLUMN derivation     jsonb,
  ADD COLUMN extractor_conf_raw real;
ALTER TABLE attribute_claims DROP COLUMN properties;
UPDATE attribute_claims SET extractor_conf_raw = confidence WHERE extractor_conf_raw IS NULL;
CREATE INDEX attribute_claims_specific ON attribute_claims (investigation_id, key_specific) WHERE key_specific IS NOT NULL;

-- `confidence` stays for now (M0 readers); it is no longer written with any adjustment — it equals extractor_conf_raw.
