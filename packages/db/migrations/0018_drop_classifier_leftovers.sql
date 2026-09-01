-- Drop leftovers from removed features (quote gate, classifier, doc-kind priors, source families).
-- Reliability is now the publisher ladder; independence is origin-key; these are unreferenced by code.
ALTER TABLE sources DROP COLUMN IF EXISTS doc_kind;
ALTER TABLE sources DROP COLUMN IF EXISTS publisher_type;
ALTER TABLE sources DROP COLUMN IF EXISTS self_published;
ALTER TABLE sources DROP COLUMN IF EXISTS classified_at;
ALTER TABLE sources DROP COLUMN IF EXISTS agree_count;
ALTER TABLE sources DROP COLUMN IF EXISTS contradict_count;
ALTER TABLE relation_claims  DROP COLUMN IF EXISTS extractor_conf_raw;
ALTER TABLE attribute_claims DROP COLUMN IF EXISTS extractor_conf_raw;
DROP TABLE IF EXISTS evidence_priors;
ALTER TABLE sources DROP COLUMN IF EXISTS family_id;
ALTER TABLE source_tiers DROP COLUMN IF EXISTS family_id;
DROP TABLE IF EXISTS source_families;
