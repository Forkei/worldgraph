-- The loop (M2_DESIGN §1): a Question compiled from a goal; the dispatcher cuts it into Missions; Actions are
-- the research log of what ran. Indicator templates seed what to look for by subject type.
CREATE TABLE questions (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  parent_id         uuid REFERENCES questions(id),
  subject_entity_id uuid,
  sought            text NOT NULL,
  indicators        jsonb NOT NULL DEFAULT '[]',   -- [{name, predicates[], record_classes[], weight}]
  kill_criterion    text,
  stop_rule         jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','killed','exhausted')),
  compiled_by       text,
  answer_ref        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz
);
CREATE INDEX questions_inv ON questions (investigation_id, status);

CREATE TABLE missions (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  question_id       uuid REFERENCES questions(id),
  objective         text NOT NULL,
  scope             jsonb NOT NULL DEFAULT '{}',    -- {entities[], slots[], hypotheses[]}
  frontier          jsonb NOT NULL DEFAULT '[]',    -- [urls | queries]
  constraints       jsonb NOT NULL DEFAULT '{}',    -- {pages, model}
  state             text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','running','done','extended','abandoned')),
  verdict           text,
  trail             jsonb NOT NULL DEFAULT '[]',
  proposals         jsonb NOT NULL DEFAULT '[]',
  score             real,
  score_parts       jsonb NOT NULL DEFAULT '{}',
  launched_by       text NOT NULL DEFAULT 'dispatcher',
  dedupe_key        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz
);
CREATE INDEX missions_inv ON missions (investigation_id, state);
CREATE UNIQUE INDEX missions_dedupe ON missions (investigation_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND state IN ('proposed','running');

CREATE TABLE actions (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  question_id       uuid,
  mission_id        uuid REFERENCES missions(id),
  line_of_enquiry   text,
  kind              text NOT NULL,
  target            jsonb NOT NULL DEFAULT '{}',
  capability_id     text,
  raised_by         jsonb NOT NULL DEFAULT '{}',
  score             real,
  score_parts       jsonb NOT NULL DEFAULT '{}',
  state             text NOT NULL DEFAULT 'for_allocation',
  result            text,
  scope             text,
  result_refs       jsonb NOT NULL DEFAULT '[]',
  cost_usd          real NOT NULL DEFAULT 0,
  seconds           real NOT NULL DEFAULT 0,
  dedupe_key        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz
);
CREATE INDEX actions_inv ON actions (investigation_id, state);

CREATE TABLE indicator_templates (
  subject_type   text NOT NULL,
  name           text NOT NULL,
  predicates     text[] NOT NULL DEFAULT '{}',
  record_classes text[] NOT NULL DEFAULT '{}',
  weight         real NOT NULL DEFAULT 1,
  PRIMARY KEY (subject_type, name)
);
