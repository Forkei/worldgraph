-- Derived links (from the resolver's structural rules: manages / part_of / sibling) live in `links` with a
-- derivation, no claim ids. Score-based merges are computed on every rebuild, never persisted as decisions —
-- only human / llm / rule decisions are records. Existing 'score' rows are removed.
ALTER TABLE links ADD COLUMN derived boolean NOT NULL DEFAULT false, ADD COLUMN derivation text;
ALTER TABLE links ALTER COLUMN claim_ids SET DEFAULT '{}';
DELETE FROM resolution_decisions WHERE method = 'score';
