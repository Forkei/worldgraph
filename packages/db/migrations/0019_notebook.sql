-- The investigator's notebook: plans, working notes, query log, hypotheses rationale, reports. Durable memory for
-- a long-running agent (its transcript is trimmed; the notebook and the graph are what it re-reads).
CREATE TABLE notes (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('plan','note','query','lead','report','tool')),
  title            text,
  body             text NOT NULL,
  refs             jsonb NOT NULL DEFAULT '[]',     -- claim / entity / source ids the note is about
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_inv ON notes (investigation_id, kind, created_at);
