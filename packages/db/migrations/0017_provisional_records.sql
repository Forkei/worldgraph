-- Serialized provisional records for learned entity resolution (research 14 / TriBERTa). One row per
-- provisional mention-cluster, with the canonical entity it resolved into as the label. Rewritten each rebuild.
CREATE TABLE provisional_records (
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  provisional_id   text NOT NULL,
  entity_id        uuid NOT NULL,     -- canonical entity (the cluster label for training)
  name             text NOT NULL,
  type             text NOT NULL,
  record           text NOT NULL,     -- serialized context (name + its own claims), for embedding
  built_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (investigation_id, provisional_id)
);
CREATE INDEX provisional_records_entity ON provisional_records (entity_id);
