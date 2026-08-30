-- Sources v2 (INVESTIGATION_MODEL §1.2): capture, source families (independence), source tiers (reliability),
-- and origin clusters on claims (near-duplicate passages across sources = one origin).

CREATE TABLE source_families (
  id          text PRIMARY KEY,           -- e.g. 'us_people_search', 'pr_wire', 'wikipedia'
  name        text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO source_families (id, name, note) VALUES
  ('us_people_search', 'US people-search aggregators', 'All draw on the same credit-header / marketing feeds — count as ONE independent source'),
  ('pr_wire',          'Press-release wires and syndication', 'Self-authored, duplicated across outlets — count as ONE origin per release'),
  ('linkedin_derived', 'LinkedIn-derived profile aggregators', 'Signal, Crunchbase people, RocketReach, PDL… mirror LinkedIn'),
  ('wikipedia',        'Wikipedia and mirrors', 'DBpedia, Wikiwand and scrapers mirror Wikipedia');

-- Reliability tier per domain pattern (Admiralty A–F). Longest matching pattern wins. Editable rows.
CREATE TABLE source_tiers (
  pattern     text PRIMARY KEY,           -- domain suffix match: 'sec.gov', '.gov', 'linkedin.com', '*'
  tier        text NOT NULL CHECK (tier IN ('A','B','C','D','E','F')),
  family_id   text REFERENCES source_families(id),
  kind        text,                       -- primary|wire|press|profile|aggregator|social|unknown
  note        text
);
INSERT INTO source_tiers (pattern, tier, family_id, kind, note) VALUES
  ('*',                'F', NULL, 'unknown',    'default: reliability cannot be judged'),
  ('.gov',             'A', NULL, 'primary',    'government / registry / court'),
  ('.gouv.fr',         'A', NULL, 'primary',    'French government'),
  ('sec.gov',          'A', NULL, 'primary',    'SEC filings'),
  ('.edu',             'B', NULL, 'primary',    'universities (staff pages, faculty)'),
  ('.ac.uk',           'B', NULL, 'primary',    NULL),
  ('wikipedia.org',    'B', 'wikipedia', 'reference', 'well-sourced but tertiary'),
  ('reuters.com',      'B', NULL, 'wire',       NULL),
  ('apnews.com',       'B', NULL, 'wire',       NULL),
  ('afp.com',          'B', NULL, 'wire',       NULL),
  ('nytimes.com',      'B', NULL, 'press',      NULL),
  ('wsj.com',          'B', NULL, 'press',      NULL),
  ('ft.com',           'B', NULL, 'press',      NULL),
  ('bloomberg.com',    'B', NULL, 'press',      NULL),
  ('techcrunch.com',   'B', NULL, 'press',      NULL),
  ('cnbc.com',         'B', NULL, 'press',      NULL),
  ('fortune.com',      'B', NULL, 'press',      NULL),
  ('afr.com',          'B', NULL, 'press',      NULL),
  ('institutionalinvestor.com', 'B', NULL, 'press', NULL),
  ('lemonde.fr',       'B', NULL, 'press',      NULL),
  ('ouest-france.fr',  'B', NULL, 'press',      NULL),
  ('prnewswire.com',   'D', 'pr_wire', 'aggregator', 'self-authored press releases'),
  ('businesswire.com', 'D', 'pr_wire', 'aggregator', NULL),
  ('globenewswire.com','D', 'pr_wire', 'aggregator', NULL),
  ('pulse2.com',       'D', 'pr_wire', 'aggregator', 'rewrites press releases'),
  ('linkedin.com',     'C', NULL, 'profile',    'self-authored profile'),
  ('crunchbase.com',   'C', 'linkedin_derived', 'profile', NULL),
  ('signal.nfx.com',   'C', 'linkedin_derived', 'profile', NULL),
  ('startupintros.com','C', 'linkedin_derived', 'aggregator', NULL),
  ('dealroom.co',      'C', 'linkedin_derived', 'profile', NULL),
  ('vcsheet.com',      'C', 'linkedin_derived', 'aggregator', NULL),
  ('gritt.io',         'C', 'linkedin_derived', 'aggregator', NULL),
  ('gurufocus.com',    'C', NULL, 'aggregator', 'SEC-derived'),
  ('aum13f.com',       'B', NULL, 'aggregator', 'SEC-derived; keeps filing references'),
  ('truepeoplesearch.com', 'C', 'us_people_search', 'aggregator', NULL),
  ('fastpeoplesearch.com', 'C', 'us_people_search', 'aggregator', NULL),
  ('spokeo.com',       'C', 'us_people_search', 'aggregator', NULL),
  ('whitepages.com',   'C', 'us_people_search', 'aggregator', NULL),
  ('beenverified.com', 'C', 'us_people_search', 'aggregator', NULL),
  ('radaris.com',      'C', 'us_people_search', 'aggregator', NULL),
  ('clustrmaps.com',   'C', 'us_people_search', 'aggregator', NULL),
  ('x.com',            'C', NULL, 'social',     'self-authored'),
  ('twitter.com',      'C', NULL, 'social',     NULL),
  ('facebook.com',     'C', NULL, 'social',     NULL),
  ('instagram.com',    'C', NULL, 'social',     NULL),
  ('reddit.com',       'D', NULL, 'social',     'anonymous'),
  ('news.ycombinator.com', 'D', NULL, 'social', 'anonymous forum'),
  ('devpost.com',      'C', NULL, 'profile',    NULL),
  ('malt.fr',          'C', NULL, 'profile',    NULL),
  ('athle.fr',         'A', NULL, 'primary',    'federation results'),
  ('bases.athle.fr',   'A', NULL, 'primary',    NULL);

ALTER TABLE sources
  ADD COLUMN family_id    text REFERENCES source_families(id),
  ADD COLUMN tier         text CHECK (tier IN ('A','B','C','D','E','F')),
  ADD COLUMN tier_kind    text,
  ADD COLUMN snapshot_key text,             -- rendered HTML / screenshot in the blob store
  ADD COLUMN captured_at  timestamptz;

-- Origin clusters: claims asserting the same fact from near-duplicate passages (or the same family) share an origin.
ALTER TABLE relation_claims  ADD COLUMN passage text, ADD COLUMN origin_cluster_id uuid;
ALTER TABLE attribute_claims ADD COLUMN passage text, ADD COLUMN origin_cluster_id uuid;
CREATE INDEX relation_claims_origin  ON relation_claims (investigation_id, origin_cluster_id);
CREATE INDEX attribute_claims_origin ON attribute_claims (investigation_id, origin_cluster_id);
