-- Publisher ladder (model v0.3 §1.4): reliability comes from the publisher's relationship to the fact, not a
-- doc-kind table or a domain list. The reading agent emits the publisher and its kind; reliability is a ladder.
-- The old classifier columns (doc_kind, publisher_type, self_published, classified_at) and evidence_priors are
-- left in place but unused; they will be dropped once nothing reads them.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS publisher_kind text;   -- authority|self|independent|platform|anonymous|unknown
