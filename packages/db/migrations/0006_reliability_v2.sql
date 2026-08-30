-- Reliability v2: no hardcoded domain tiers. A source's reliability comes from
--   (1) what kind of document it is (classified from its own content, not its domain),
--   (2) its relationship to the subject (self-published about itself = authoritative, not independent),
--   (3) what we observe over time (agreement with independent origins vs contradiction),
--   (4) an owner override, if any (a decision, not a rule).
-- The seeded domain rows are removed; `source_tiers` remains only as the owner-override table.

DELETE FROM source_tiers;
COMMENT ON TABLE source_tiers IS 'Owner overrides only (a human decision). Not seeded; not consulted unless a row exists.';

ALTER TABLE sources
  ADD COLUMN doc_kind        text,      -- record|filing|minutes|roster|directory|article|paper|transcript|profile|page|post|listing|forum|unknown
  ADD COLUMN publisher_name  text,      -- who publishes this page, as the page itself says (org or person)
  ADD COLUMN publisher_type  text,      -- organization|person|platform|unknown
  ADD COLUMN self_published  boolean,   -- the page is by the entity it is mainly about
  ADD COLUMN classified_at   timestamptz,
  ADD COLUMN agree_count     int NOT NULL DEFAULT 0,   -- claims corroborated by an independent origin
  ADD COLUMN contradict_count int NOT NULL DEFAULT 0;  -- claims contradicted by an independent origin

-- Priors per document kind: a small epistemological table (a filing is not a forum post). Observed counts
-- update it; the prior is the starting point, not the verdict.
CREATE TABLE evidence_priors (
  doc_kind    text PRIMARY KEY,
  tier        text NOT NULL CHECK (tier IN ('A','B','C','D','E','F')),
  observed_ok int NOT NULL DEFAULT 0,
  observed_bad int NOT NULL DEFAULT 0,
  note        text
);
INSERT INTO evidence_priors (doc_kind, tier, note) VALUES
  ('record',     'A', 'official register / court / licence / filing index'),
  ('filing',     'A', 'a document filed with an authority'),
  ('minutes',    'A', 'minutes of a public body'),
  ('roster',     'B', 'results list, directory table, staff list'),
  ('directory',  'B', 'staff / member directory'),
  ('article',    'B', 'reported news'),
  ('paper',      'B', 'academic or technical paper'),
  ('transcript', 'B', 'transcript of speech'),
  ('profile',    'C', 'self-authored or aggregated profile'),
  ('page',       'C', 'general web page'),
  ('post',       'C', 'social / blog post'),
  ('listing',    'C', 'marketplace / classified listing'),
  ('forum',      'D', 'anonymous discussion'),
  ('unknown',    'F', 'could not be judged');
