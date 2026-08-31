-- Capability registry (model §1.12 / M2 §1): fact types are nodes, capabilities are edges; sites and tools are
-- rows. The enabled set at any moment is "capabilities whose inputs exist in the graph". source_cache keys
-- results by (capability, normalized inputs) so re-runs never refetch.
CREATE TABLE capabilities (
  id             text PRIMARY KEY,               -- name, e.g. search.serpapi.google
  kind           text NOT NULL CHECK (kind IN ('connector','pivot','search','fetch','browser_recipe','tool','dataset','manual')),
  inputs         text[] NOT NULL DEFAULT '{}',   -- fact types it consumes
  outputs        text[] NOT NULL DEFAULT '{}',   -- fact types / predicates it can produce
  cost_usd       real NOT NULL DEFAULT 0,
  cost_seconds   real NOT NULL DEFAULT 0,
  tier           text NOT NULL DEFAULT 'L0',
  jurisdictions  text[] NOT NULL DEFAULT '{}',
  entity_types   text[] NOT NULL DEFAULT '{}',
  cache_ttl      interval,
  requires       jsonb NOT NULL DEFAULT '{}',    -- {key: "SERPAPI_KEY"} etc.
  enabled        boolean NOT NULL DEFAULT true,
  added_by       text NOT NULL DEFAULT 'hand',
  spec           jsonb NOT NULL DEFAULT '{}',
  yield_hits     int NOT NULL DEFAULT 0,
  yield_runs     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_cache (
  cache_key     text PRIMARY KEY,                -- capability + normalized inputs
  capability_id text NOT NULL,
  inputs_norm   jsonb NOT NULL,
  result        jsonb NOT NULL,                  -- for search: the hit list; for fetch: source id ref
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz
);
CREATE INDEX source_cache_cap ON source_cache (capability_id);

-- learned per-domain fetch strategy (M2 §6): remember which method worked, so plain HTTP is the default and
-- the headless/owner-session browser is the escalation only where a domain needs it.
CREATE TABLE domain_strategy (
  domain        text PRIMARY KEY,
  best_method   text,
  last_ok_at    timestamptz,
  fail_count    int NOT NULL DEFAULT 0
);
