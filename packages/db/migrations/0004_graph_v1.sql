-- Graph v1 (INVESTIGATION_MODEL §1.4–1.7): entities/links/attributes as REBUILDABLE tables (views over claims),
-- justifications, rules, slots. Everything here is written only by `rebuild`; nothing is edited by hand.

CREATE TABLE entities (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  type             text NOT NULL,
  kind             text,
  canonical_name   text NOT NULL,
  name_norm        text NOT NULL,
  aliases          text[] NOT NULL DEFAULT '{}',
  identity_keys    jsonb NOT NULL DEFAULT '{}',   -- {email:[], phone:[], handle:[], url:[], registry_id:[], licence:[]}
  claim_count      int NOT NULL DEFAULT 0,
  first_seen       date,
  last_seen        date,
  built_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entities_inv_norm ON entities (investigation_id, type, name_norm);
CREATE INDEX entities_inv_name ON entities (investigation_id, canonical_name);

CREATE TABLE claim_entities (
  claim_id   uuid NOT NULL,
  claim_kind text NOT NULL CHECK (claim_kind IN ('relation','attribute')),
  role       text NOT NULL CHECK (role IN ('subject','object','entity')),
  entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, role)
);
CREATE INDEX claim_entities_entity ON claim_entities (entity_id);

CREATE TABLE links (
  id                  uuid PRIMARY KEY,
  investigation_id    uuid NOT NULL REFERENCES investigations(id),
  src_id              uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  predicate           text NOT NULL,
  predicate_specific  text,
  dst_id              uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  qualifiers          jsonb NOT NULL DEFAULT '{}',
  qualifier_conflicts jsonb NOT NULL DEFAULT '{}',  -- {key: [{value, claim_ids}]} when sources disagree
  claim_ids           uuid[] NOT NULL,
  evidence_count      int NOT NULL,
  independent_origins int NOT NULL,
  primary_origins     int NOT NULL,
  tier_best           text NOT NULL,                -- A..F
  contested           boolean NOT NULL DEFAULT false,
  reliability         text NOT NULL,                -- A..F   (two-axis grade)
  credibility         int  NOT NULL,                -- 1..6
  grade               text NOT NULL CHECK (grade IN ('established','corroborated','single_source','unverified','disputed')),
  temporal_kind       text,
  valid_from_lo       date, valid_from_hi date, valid_to_lo date, valid_to_hi date, date_lo date, date_hi date,
  first_asserted      date, last_asserted date,
  built_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, src_id, predicate, dst_id, predicate_specific)
);
CREATE INDEX links_src ON links (investigation_id, src_id);
CREATE INDEX links_dst ON links (investigation_id, dst_id);
CREATE INDEX links_pred ON links (investigation_id, predicate);

CREATE TABLE attributes (
  id                  uuid PRIMARY KEY,
  investigation_id    uuid NOT NULL REFERENCES investigations(id),
  entity_id           uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  key                 text NOT NULL,
  key_specific        text,
  value               text NOT NULL,
  value_norm          text NOT NULL,
  datatype            text NOT NULL,
  claim_ids           uuid[] NOT NULL,
  evidence_count      int NOT NULL,
  independent_origins int NOT NULL,
  primary_origins     int NOT NULL,
  tier_best           text NOT NULL,
  contested           boolean NOT NULL DEFAULT false,
  reliability         text NOT NULL,
  credibility         int  NOT NULL,
  grade               text NOT NULL CHECK (grade IN ('established','corroborated','single_source','unverified','disputed')),
  temporal_kind       text,
  valid_from_lo       date, valid_from_hi date, valid_to_lo date, valid_to_hi date, date_lo date, date_hi date,
  first_asserted      date, last_asserted date,
  built_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, key, value_norm, key_specific)
);
CREATE INDEX attributes_entity ON attributes (entity_id);

-- Justifications: what every derived thing rests on (claims, origin clusters, rules, decisions).
CREATE TABLE justifications (
  derived_kind text NOT NULL CHECK (derived_kind IN ('entity','link','attribute','grade','slot')),
  derived_id   uuid NOT NULL,
  supports     jsonb NOT NULL,     -- [{kind: claim|origin|rule|decision|source, id}]
  status       text NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  built_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (derived_kind, derived_id)
);

-- Rules: everything expected is a rule (shape, expected_record, derivation, lead, anomaly, hypothesis).
CREATE TABLE rules (
  id                 text PRIMARY KEY,
  kind               text NOT NULL CHECK (kind IN ('shape','expected_record','derivation','lead','anomaly','hypothesis')),
  name               text NOT NULL,
  "when"             jsonb NOT NULL,
  "then"             jsonb NOT NULL,
  confidence         real NOT NULL DEFAULT 1,
  expectedness       text CHECK (expectedness IN ('mandatory','usual','possible')),
  source             text NOT NULL DEFAULT 'hand',
  precision_observed real,
  enabled            boolean NOT NULL DEFAULT true,
  note               text
);

-- Slots: a known unknown on an entity (or a question). Absence is an object.
CREATE TABLE slots (
  id               uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  entity_id        uuid REFERENCES entities(id) ON DELETE CASCADE,
  question_id      uuid,
  kind             text NOT NULL CHECK (kind IN ('predicate','attribute','record_class','indicator')),
  key              text NOT NULL,
  window_lo        date,
  window_hi        date,
  status           text NOT NULL DEFAULT 'unset' CHECK (status IN ('unset','found','searched_absent','unknown','not_obtainable','not_applicable')),
  expectedness     text CHECK (expectedness IN ('mandatory','usual','possible')),
  rule_id          text REFERENCES rules(id),
  source_id        uuid,
  action_id        uuid,
  searched_at      timestamptz,
  query            text,
  scope            text,            -- "what nil means"
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX slots_unique ON slots (entity_id, kind, key, coalesce(window_lo, '0001-01-01'), coalesce(window_hi, '9999-12-31')) WHERE entity_id IS NOT NULL;
CREATE INDEX slots_inv_status ON slots (investigation_id, status);
