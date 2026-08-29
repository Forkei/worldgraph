-- M0 schema: workspaces, investigations, sources, the two claim tables, extraction ledger, cost, audit.
-- Enums are TEXT + CHECK so they can evolve without ALTER TYPE. IDs are UUIDv7 generated app-side.

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  tier        text NOT NULL DEFAULT 'owner',
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workspaces (id, name) VALUES ('00000000-0000-7000-8000-000000000001', 'default');

CREATE TABLE investigations (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  title         text NOT NULL,
  seed          jsonb NOT NULL,             -- {kind, name, hints{}}
  goal_text     text NOT NULL,
  goal          jsonb,                      -- compiled Goal (M2)
  policy        text NOT NULL DEFAULT 'unrestricted',
  budget        jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','stopped','done','failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id              uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  url             text NOT NULL,
  final_url       text,
  domain          text,
  kind            text NOT NULL CHECK (kind IN ('html','pdf','image','audio','video','api','archive','unknown')),
  fetch_method    text NOT NULL CHECK (fetch_method IN ('firecrawl','http','archive','connector','cache')),
  http_status     int,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  content_hash    text,                     -- sha256 hex of `text`
  blob_key        text,                     -- raw bytes / markdown in the blob store
  text            text,                     -- reader-visible plain text (what quotes are validated against)
  title           text,
  published_at    timestamptz,
  lang            text,
  page_kind       text,                     -- X2 (M2)
  relevance       real,                     -- X2 (M2)
  status          text NOT NULL CHECK (status IN ('fetched','classified','extracted','skipped','failed')),
  error           text,
  meta            jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX sources_inv_hash ON sources (investigation_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX sources_inv_status ON sources (investigation_id, status);
CREATE INDEX sources_inv_url ON sources (investigation_id, url);

-- Shared provenance columns are repeated verbatim in both claim tables (no inheritance: keeps rows
-- self-contained and portable).
CREATE TABLE relation_claims (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  source_id         uuid NOT NULL REFERENCES sources(id),
  chunk_index       int NOT NULL,
  chunk_hash        text NOT NULL,
  subject           jsonb NOT NULL,   -- Mention
  predicate         text NOT NULL,
  predicate_label   text,
  object            jsonb NOT NULL,   -- Mention
  properties        jsonb NOT NULL DEFAULT '{}',
  quote             text NOT NULL,
  span_start        int,
  span_end          int,
  span_method       text CHECK (span_method IN ('exact','fuzzy')),
  confidence        real NOT NULL,
  verified          boolean,
  attribute_class   text NOT NULL CHECK (attribute_class IN ('public','sensitive','restricted')),
  status            text NOT NULL CHECK (status IN ('raw','resolved','rejected','redacted')),
  reject_reason     text,
  redaction_reason  text,
  extractor         jsonb NOT NULL,   -- {model, prompt_version, effort, cost_usd}
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relation_claims_inv_pred ON relation_claims (investigation_id, predicate);
CREATE INDEX relation_claims_inv_src ON relation_claims (investigation_id, source_id);
CREATE INDEX relation_claims_inv_status ON relation_claims (investigation_id, status);
CREATE INDEX relation_claims_subject ON relation_claims USING gin (subject jsonb_path_ops);
CREATE INDEX relation_claims_object ON relation_claims USING gin (object jsonb_path_ops);

CREATE TABLE attribute_claims (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  source_id         uuid NOT NULL REFERENCES sources(id),
  chunk_index       int NOT NULL,
  chunk_hash        text NOT NULL,
  entity            jsonb NOT NULL,   -- Mention
  key               text NOT NULL,
  value             text NOT NULL,
  value_norm        text NOT NULL,
  datatype          text NOT NULL CHECK (datatype IN ('string','number','date','date_range','url','email','phone','money','geo')),
  properties        jsonb NOT NULL DEFAULT '{}',
  quote             text NOT NULL,
  span_start        int,
  span_end          int,
  span_method       text CHECK (span_method IN ('exact','fuzzy')),
  confidence        real NOT NULL,
  verified          boolean,
  attribute_class   text NOT NULL CHECK (attribute_class IN ('public','sensitive','restricted')),
  status            text NOT NULL CHECK (status IN ('raw','resolved','rejected','redacted')),
  reject_reason     text,
  redaction_reason  text,
  extractor         jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attribute_claims_inv_key ON attribute_claims (investigation_id, key);
CREATE INDEX attribute_claims_inv_src ON attribute_claims (investigation_id, source_id);
CREATE INDEX attribute_claims_inv_status ON attribute_claims (investigation_id, status);
CREATE INDEX attribute_claims_entity ON attribute_claims USING gin (entity jsonb_path_ops);

-- One row per (source chunk, model, prompt version): idempotency + per-chunk stats.
CREATE TABLE extractions (
  id                uuid PRIMARY KEY,
  investigation_id  uuid NOT NULL REFERENCES investigations(id),
  source_id         uuid NOT NULL REFERENCES sources(id),
  chunk_index       int NOT NULL,
  chunk_hash        text NOT NULL,
  model             text NOT NULL,
  prompt_version    text NOT NULL,
  status            text NOT NULL CHECK (status IN ('done','failed','skipped')),
  n_mentions        int NOT NULL DEFAULT 0,
  n_relations       int NOT NULL DEFAULT 0,
  n_attributes      int NOT NULL DEFAULT 0,
  n_rejected        int NOT NULL DEFAULT 0,
  n_other           int NOT NULL DEFAULT 0,
  in_tokens         int NOT NULL DEFAULT 0,
  out_tokens        int NOT NULL DEFAULT 0,
  usd               numeric(10,6) NOT NULL DEFAULT 0,
  ms                int NOT NULL DEFAULT 0,
  error             text,
  page_summary      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_hash, model, prompt_version)
);

CREATE TABLE cost_ledger (
  id                uuid PRIMARY KEY,
  investigation_id  uuid REFERENCES investigations(id),
  ts                timestamptz NOT NULL DEFAULT now(),
  kind              text NOT NULL CHECK (kind IN ('llm','search','fetch','proxy','connector','embed')),
  provider          text NOT NULL,
  units             jsonb NOT NULL DEFAULT '{}',
  usd               numeric(10,6) NOT NULL,
  ref               jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX cost_ledger_inv ON cost_ledger (investigation_id, ts);

CREATE TABLE audit_log (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  investigation_id  uuid,
  ts                timestamptz NOT NULL DEFAULT now(),
  actor             text NOT NULL,
  action            text NOT NULL,
  detail            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_inv ON audit_log (investigation_id, ts);
