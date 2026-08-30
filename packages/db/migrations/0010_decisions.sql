-- Decisions log (model §1.10): every choice that shaped an investigation, in sequence, with its rationale and
-- the justification refs it rested on. Resolution verdicts stay in resolution_decisions (the record the
-- resolver reads); this table is the human-readable research log across all decision kinds.
CREATE TABLE decisions (
  seq              bigserial PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  at               timestamptz NOT NULL DEFAULT now(),
  actor            text NOT NULL CHECK (actor IN ('system','human','llm')),
  kind             text NOT NULL CHECK (kind IN ('scope','merge','split','refer','pend','policy','stop','kill','capability')),
  subject_ref      jsonb NOT NULL DEFAULT '{}',
  rationale        text NOT NULL,
  inputs           jsonb NOT NULL DEFAULT '[]',
  reversible_by    text
);
CREATE INDEX decisions_inv ON decisions (investigation_id, seq);
