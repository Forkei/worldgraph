-- Resolution as claims (model §1.8, M1_DESIGN §4): decisions are records over PROVISIONAL entities
-- (stable ids = hash of type + normalized name), so they survive rebuilds; merged entities are views.
-- Identity hypotheses hold the uncertain middle band until a human or a judge decides.

CREATE TABLE resolution_decisions (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  a_id             uuid NOT NULL,          -- provisional entity id (smaller)
  b_id             uuid NOT NULL,          -- provisional entity id (larger)
  verdict          text NOT NULL CHECK (verdict IN ('same','not_same','related')),
  related_kind     text,                   -- manages|parent|subsidiary|fund_of|alias|namesake
  method           text NOT NULL CHECK (method IN ('rule','score','llm','human')),
  score            real,
  features         jsonb NOT NULL DEFAULT '{}',
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  superseded_by    uuid REFERENCES resolution_decisions(id)
);
CREATE INDEX resolution_decisions_inv ON resolution_decisions (investigation_id, a_id, b_id) WHERE superseded_by IS NULL;

CREATE TABLE hypotheses (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  question_id      uuid,
  kind             text NOT NULL CHECK (kind IN ('identity','relation','value','event','free')),
  exclusion_group  text,
  pattern          jsonb NOT NULL,         -- identity: {a_id, b_id, a_name, b_name, type}
  refers_to        jsonb NOT NULL DEFAULT '[]',
  predicted_if_true  jsonb NOT NULL DEFAULT '[]',
  predicted_if_false jsonb NOT NULL DEFAULT '[]',
  evidence         jsonb NOT NULL DEFAULT '[]',
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','supported','established','disproved','abandoned')),
  score            real,
  assumptions      jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text
);
CREATE UNIQUE INDEX hypotheses_identity_pair ON hypotheses (investigation_id, (pattern->>'a_id'), (pattern->>'b_id')) WHERE kind = 'identity';
CREATE INDEX hypotheses_inv_status ON hypotheses (investigation_id, status);

-- Which provisional entities make up each (merged) entity; the un-merge path.
CREATE TABLE entity_members (
  entity_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  provisional_id uuid NOT NULL,
  name           text NOT NULL,
  claim_count    int  NOT NULL,
  PRIMARY KEY (entity_id, provisional_id)
);
