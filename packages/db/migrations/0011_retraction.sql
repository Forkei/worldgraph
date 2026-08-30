-- Retraction: a source can be withdrawn (wrong page, poisoned, takedown); its claims leave the graph and
-- everything derived from them is rebuilt — nothing else moves because derived ids are stable hashes.
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_status_check;
ALTER TABLE sources ADD CONSTRAINT sources_status_check CHECK (status IN ('fetched','classified','extracted','skipped','failed','retracted'));
ALTER TABLE relation_claims  DROP CONSTRAINT IF EXISTS relation_claims_status_check;
ALTER TABLE relation_claims  ADD  CONSTRAINT relation_claims_status_check  CHECK (status IN ('raw','resolved','rejected','redacted','superseded','retracted'));
ALTER TABLE attribute_claims DROP CONSTRAINT IF EXISTS attribute_claims_status_check;
ALTER TABLE attribute_claims ADD  CONSTRAINT attribute_claims_status_check CHECK (status IN ('raw','resolved','rejected','redacted','superseded','retracted'));
ALTER TABLE sources ADD COLUMN IF NOT EXISTS retracted_at timestamptz, ADD COLUMN IF NOT EXISTS retracted_reason text;
