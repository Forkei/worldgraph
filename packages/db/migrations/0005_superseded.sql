-- Claims extracted under an older schema/prompt are superseded when the same chunk has been re-extracted
-- under the current schema. Append-only stays true: this is a lifecycle status, the rows remain.
ALTER TABLE relation_claims  DROP CONSTRAINT relation_claims_status_check;
ALTER TABLE relation_claims  ADD  CONSTRAINT relation_claims_status_check  CHECK (status IN ('raw','resolved','rejected','redacted','superseded'));
ALTER TABLE attribute_claims DROP CONSTRAINT attribute_claims_status_check;
ALTER TABLE attribute_claims ADD  CONSTRAINT attribute_claims_status_check CHECK (status IN ('raw','resolved','rejected','redacted','superseded'));
