-- The investigation is a conversation with the investigator. `sessions` holds the LLM transcript so the same agent
-- continues across turns (clear history = a new session). `messages` is what people see: the user's messages and
-- the agent's send_message calls, plus a readable activity feed. `entity_groups` are the agent's own groupings of
-- entities (a corporate chain, a brand and its legal entities) — drawn as one node, exploded on tap.
CREATE TABLE sessions (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  model            text,
  transcript       jsonb NOT NULL DEFAULT '[]',
  turns            int NOT NULL DEFAULT 0,
  usd              real NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cleared_at       timestamptz
);
CREATE INDEX sessions_inv ON sessions (investigation_id, created_at);

CREATE TABLE messages (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  session_id       uuid REFERENCES sessions(id) ON DELETE SET NULL,
  role             text NOT NULL CHECK (role IN ('user','agent','activity','system')),
  body             text NOT NULL,
  meta             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_inv ON messages (investigation_id, created_at);

CREATE TABLE entity_groups (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  label            text NOT NULL,
  members          uuid[] NOT NULL,
  note             text,
  created_by       text NOT NULL DEFAULT 'agent',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_groups_inv ON entity_groups (investigation_id);
