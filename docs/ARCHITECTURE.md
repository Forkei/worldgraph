# WorldGraph — technical architecture

*v0.1 · 2026-08-29. Companion to `PRODUCT_SPEC.md`. The spec says WHAT the finished product is; this says
HOW every capability works and how it is implemented. Capability IDs (A1, X1, R2, …) refer to spec §5.
Design only — no code exists yet. Decisions marked **[D]** are choices; alternatives and the reason are
given so they can be reversed deliberately.*

---

## 0. Reading guide

| Section | Answers |
|---|---|
| 1 Topology | What processes exist, what talks to what |
| 2 Data flow | The life of one investigation, step by step |
| 3 Storage | Every table, column, index; why claims are the root |
| 4 Ontology registry | How types/predicates are defined, extended, turned into prompts |
| 5–14 | One section per capability layer (A, X, R, G, P, L, Q, W, V, F) |
| 15 Client-system sync | Mapping and flow |
| 16 Tech choices | Each choice with rationale |
| 17 Risks | What could sink it and the mitigation |

---

## 1. System topology

```
                 ┌──────────────────────────── control plane ────────────────────────────┐
                 │  API server (HTTP + SSE)      MCP server        Web app (canvas/UI)    │
                 └───────┬───────────────────────────┬────────────────────┬──────────────┘
                         │                           │                    │
                 ┌───────▼───────────────────────────▼────────────────────▼──────────────┐
                 │                         Postgres 17                                   │
                 │   claims · sources · entities · edges · plan_events · audit · queue   │
                 │   + pgvector (embeddings)   + Apache AGE (graph projection, M5+)      │
                 └───────▲───────────────────────────▲────────────────────▲──────────────┘
                         │                           │                    │
      ┌──────────────────┴───────┐   ┌───────────────┴─────────┐   ┌──────┴──────────────┐
      │ Planner worker           │   │ Pipeline workers        │   │ Build worker        │
      │ goal→frontier→actions    │   │ fetch · classify ·      │   │ resolve · material- │
      │ (one per running inv.)   │   │ extract · connectors    │   │ ize · derive · snap │
      └──────────────────────────┘   └───────────┬─────────────┘   └─────────────────────┘
                                                 │
                              ┌──────────────────┴──────────────────┐
                              │ Object store (S3-compatible / local) │
                              │ raw HTML · PDFs · screenshots · OCR  │
                              └─────────────────────────────────────┘
      External: Claude API · search providers · Firecrawl/Playwright · connectors (EDGAR, CourtListener…) · the client system
```

**[D] One language (TypeScript, Node ≥ 22) for everything.** Reason: one type system shared by API, workers,
web app, and MCP server; the client's loader prototype is already `.mjs`; Playwright, pg, and the Anthropic
SDK are first-class. Python appears only inside optional media tooling (OCR/ASR) as subprocesses.

**[D] One database.** Postgres holds relational truth (claims), the job queue (pg-boss), embeddings
(pgvector), and — from M5 — a graph projection (AGE). Reason: one backup, one transaction boundary, no Redis
or Neo4j to operate at v1. Escape hatch: the graph projection is rebuilt from claims, so swapping AGE for
Neo4j/Memgraph later changes only `graph/projection.ts`.

**Processes (all from one monorepo, separate entrypoints):**

| Process | Entrypoint | Scale | Responsibility |
|---|---|---|---|
| `api` | `apps/api` | N | REST + SSE; auth; enqueue jobs; read models |
| `web` | `apps/web` | N | Next.js app: investigations, canvas, dossier, frontier, admin |
| `mcp` | `apps/mcp` | 1/user | stdio/HTTP MCP server wrapping `api` |
| `worker:pipeline` | `apps/worker` | N | fetch / classify / extract / connector jobs |
| `worker:planner` | `apps/worker` | 1 per running investigation (lease) | frontier loop |
| `worker:build` | `apps/worker` | N, serialized per investigation | resolve → materialize → derive → snapshot → embed → external-sync |

**Monorepo layout**

```
worldgraph/
  apps/ api/  web/  mcp/  worker/
  packages/
    core/        ontology registry, claim model, policy engine, types (no I/O)
    db/          schema, migrations, query builders, pg-boss setup
    acquire/     fetchers, search adapters, connectors, media
    extract/     chunker, prompts, extractor, quote gate, temporal/geo normalizers
    resolve/     normalizers, blocking, scoring, decisions
    graph/       materialize, derived edges, snapshots, diff, projection, embeddings
    planner/     goal compiler, frontier, scorer, hop policy, stop rules
    query/       templates, router, NL-grounded answerer
    eval/        gold sets, scorers, CI runner
  docs/
  infra/         docker-compose, Dockerfiles, terraform (later)
```

---

## 2. Data flow — the life of one investigation

```
create(seed, goal_text, policy, budget)
  → L1 gate: policy × seed_type × goal_intent → allow | deny | allow-with-redactions
  → P1: compile goal_text → Goal (LLM) → user confirms
  → planner lease acquired
loop until stop:
  planner pops top-K actions from frontier
    search(q)        → search adapter → candidate URLs → frontier.add(fetch(url), score)
    fetch(url)       → A1 cascade → Source row + blob → job classify
    connector(n, e)  → A3 module → Claim[] directly → job resolve-incremental
    expand(e, pred)  → hop policy → generates search/connector actions
  classify(source)   → X2: page kind + relevance → skip | extract(depth)
  extract(source)    → X1 chunks → Claim[] (quote-gated, X3-tagged, L1-redacted) → INSERT claims
  after each batch:  build worker → R1–R3 resolve new mentions → materialize entities/edges
                     planner reads coverage (must_answer status, gaps) → P4 LLM proposals → frontier
  stop check (P5)    → budget / floor / satisfied / user
finalize:
  full rebuild → derived edges (G3) → embeddings (G4) → snapshot (G5) → coverage report → external sync (G6)
```

Two invariants:
1. **Claims are append-only.** Every downstream table is derivable from `claims` + `resolution_decisions` + `policies`. `rebuild(investigation_id)` is idempotent and is the only writer of `entities`, `edges`, `entity_attributes`.
2. **The plan is an event log.** `plan_events` records every action considered, scored, taken, and its outcome. Replay = re-execute the log against cached sources with a different policy/scorer.

---

## 3. Storage design (Postgres)

Types: `id` = UUIDv7 (time-ordered) everywhere. `ts` = `timestamptz`. All tables carry `investigation_id`
except workspace-level ones. Row-level security by `workspace_id` (L5) is applied via a session variable.

### 3.1 Workspace & investigation

```sql
workspaces        (id, name, tier, settings jsonb, created_at)
users             (id, workspace_id, email, role enum('admin','analyst','viewer'), created_at)
policies          (id, workspace_id, name, spec jsonb, created_at)          -- see §10.1
investigations    (id, workspace_id, created_by, title,
                   seed jsonb,            -- {kind:'person'|'org'|'domain'|..., values:{name, hints[]}}
                   goal_text text, goal jsonb,   -- compiled Goal (§9.1)
                   policy_id, legal_basis text,  -- L2
                   budget jsonb,          -- {pages, usd, hops, minutes}
                   status enum('draft','running','paused','stopped','done','failed'),
                   focus_entity_id uuid null, created_at, updated_at)
```

### 3.2 Sources (A5)

```sql
sources  (id, investigation_id, url text, final_url text, domain text,
          kind enum('html','pdf','image','audio','video','api','archive'),
          fetch_method enum('http','browser','firecrawl','archive','connector'),
          http_status int, fetched_at ts, content_hash bytea,          -- sha256 of extracted text
          blob_key text,                                                -- object store key for raw bytes
          text text,                                                    -- extracted readable text
          title text, published_at ts null, lang text,
          page_kind enum('profile','article','directory','record','forum','listing','irrelevant') null,   -- X2
          relevance real null,                                          -- X2
          status enum('fetched','classified','extracted','skipped','failed'), error text null)
UNIQUE (investigation_id, content_hash)      -- same text twice = one source
INDEX  (investigation_id, status)
```

### 3.3 Claims — the root (spec §4.3)

```sql
claims   (id, investigation_id, source_id,
          subject jsonb,        -- Mention: {surface, type, hints:{email?,handle?,url?,org?,location?...}}
          predicate text,       -- from ontology registry, or 'attr:<key>' for literal attributes
          object jsonb null,    -- Mention (relation claims)
          literal jsonb null,   -- {value, datatype} (attribute claims)
          properties jsonb,     -- edge/attribute props: role, valid_from, valid_to, precision, amount…
          quote text, span_start int, span_end int,  -- verbatim, validated (§6.4)
          confidence real,      -- extractor confidence 0..1
          verified bool null,   -- X6 self-check result
          attribute_class enum('public','sensitive','restricted'),
          status enum('raw','resolved','rejected','redacted'),
          redaction_reason text null,
          extractor jsonb,      -- {model, prompt_version, chunk_index, cost_usd}
          chunk_hash bytea,     -- for idempotent re-extraction
          created_at)
INDEX (investigation_id, predicate)
INDEX (investigation_id, source_id)
INDEX gin (subject jsonb_path_ops), gin (object jsonb_path_ops)
```

**Why no `mentions` table:** a mention has no identity outside its claim; storing it inline keeps claims
self-contained (a claim row is a complete, portable fact). Resolution maps `(claim_id, role)` → entity.

### 3.4 Resolution

```sql
claim_entities        (claim_id, role enum('subject','object'), entity_id, PRIMARY KEY(claim_id, role))
entities              (id, investigation_id, type text, canonical_name text, name_norm text,
                       aliases text[], identity_keys jsonb,     -- {email:[], phone:[], handle:[], url:[], ext:{edgar:..,orcid:..}}
                       merged_from uuid[],
                       first_seen ts, last_seen ts, claim_count int, embedding vector(1024) null)
resolution_candidates (id, investigation_id, entity_a, entity_b, score real, features jsonb,
                       state enum('pending','merged','rejected','expired'), created_at)
resolution_decisions  (id, investigation_id, entity_a, entity_b,
                       decision enum('same','not_same'), method enum('identity_key','context','model','human'),
                       confidence real, decided_by text, rationale text, created_at)
investigation_links   (investigation_id, linked_investigation_id, created_at, PRIMARY KEY(investigation_id, linked_investigation_id))   -- R6: chosen at creation, editable
graph_links           (id, entity_a, investigation_a, entity_b, investigation_b, score real, features jsonb,
                       state enum('auto','confirmed','rejected','pending'), method, created_at)              -- R6: cross-graph same_as
```

`entities` rows are **rebuilt** from claims + decisions. `merged_from` records the pre-merge cluster IDs so
un-merge (R5) = insert a `not_same` decision + rebuild. `entities.registry_entity_id` is dropped: graphs are
never merged, only linked (§7.3).

### 3.5 Materialized graph (G1–G3)

```sql
edges              (id, investigation_id, src_id, predicate, dst_id,
                    properties jsonb,           -- merged props; conflicts kept as arrays with claim refs
                    valid_from date null, valid_to date null, date_precision text null,
                    observed_first ts, observed_last ts,
                    evidence_count int, max_confidence real, claim_ids uuid[],
                    derived bool default false, derivation text null)
UNIQUE (investigation_id, src_id, predicate, dst_id)
INDEX (investigation_id, src_id), (investigation_id, dst_id), (investigation_id, predicate)

entity_attributes  (entity_id, key, value jsonb, value_norm text, claim_ids uuid[], max_confidence real,
                    attribute_class, valid_from date null, valid_to date null, PRIMARY KEY(entity_id, key, value_norm))

places             (entity_id PK, formatted text, components jsonb, geom geography(Point), geocoder text, precision text)   -- X5
```

Inverse edges are **not stored**; the query layer reads both directions and applies the inverse label from
the registry. Storing both doubles writes and risks drift.

### 3.6 Planner (P)

```sql
frontier_actions (id, investigation_id, kind enum('search','fetch','connector','expand'),
                  params jsonb, score real, score_parts jsonb,      -- {relevance, novelty, quality, cost, hop}
                  origin jsonb,        -- {from_entity_id?, from_source_id?, proposer:'template'|'llm'|'user'}
                  state enum('queued','approved','running','done','failed','denied','expired'),
                  hop int, created_at, started_at, finished_at)
INDEX (investigation_id, state, score desc)

plan_events      (id, investigation_id, seq bigint, ts, kind text, payload jsonb)   -- the replayable log
coverage         (investigation_id PK, must_answer jsonb, gaps jsonb, stats jsonb, updated_at)
```

### 3.7 Snapshots (G5) & monitoring (W)

```sql
snapshots   (id, investigation_id, taken_at, stats jsonb, blob_key text)   -- graph.json in object store
snapshot_diffs (id, investigation_id, from_id, to_id, added jsonb, removed jsonb, changed jsonb, created_at)
watches     (id, investigation_id, cron text, channels jsonb, last_run ts, enabled bool)
alerts      (id, watch_id, diff_id, summary text, delivered jsonb, created_at)
```

### 3.8 Governance & platform

```sql
audit_log    (id, workspace_id, investigation_id null, ts, actor, action text, detail jsonb)   -- append-only, no UPDATE grant
erasures     (id, workspace_id, subject_hash bytea, identity_key_hashes bytea[], requested_at, completed_at)
cost_ledger  (id, investigation_id, ts, kind enum('llm','search','fetch','proxy','connector','embed'),
              provider text, units jsonb, usd numeric(10,6), ref jsonb)
api_keys     (id, workspace_id, hash, scopes text[], created_at, revoked_at)
```

pg-boss creates its own `pgboss.*` schema for jobs.

### 3.9 Object store
Keys: `ws/{workspace}/inv/{investigation}/src/{sha256}.{ext}`. Local filesystem in dev (`./data/blobs`),
S3-compatible in prod. Never store secrets or derived PII outside Postgres.

---

## 4. Ontology registry

**[D] The ontology is data, not code.** `packages/core/ontology/*.yaml`, loaded into a typed registry at
boot; validated with Zod. New node types / predicates ship as a YAML change + migration of the extraction
prompt version. Nothing in the pipeline hardcodes a predicate name.

```yaml
# node_types.yaml
person:       { label: Person,        identity_keys: [email, phone, handle, url, orcid, license] }
organization: { label: Organization,  subtypes: [company, school, agency, nonprofit, club], identity_keys: [domain, edgar_cik, registry_id] }
place:        { label: Place,         subtypes: [address, city, region, country], geocodable: true }
event:        { label: Event,         subtypes: [conference, hearing, incident, election] }
document:     { label: Document,      subtypes: [article, post, filing, record, page], identity_keys: [url, doi] }
account:      { label: Account,       subtypes: [email, phone, handle, domain] }
credential:   { label: Credential }
legal_matter: { label: LegalMatter,   identity_keys: [docket] }
money_flow:   { label: MoneyFlow }
# … artifact, position, asset

# predicates.yaml
works_at:        { inverse: employs,        domain: [person], range: [organization], props: [role, department, valid_from, valid_to] }
studied_at:      { inverse: educated,       domain: [person], range: [organization], props: [degree, field, valid_from, valid_to] }
lives_at:        { inverse: residence_of,   domain: [person], range: [place],        props: [valid_from, valid_to, kind], attribute_class: restricted }
located_in:      { inverse: contains,       domain: [place, organization], range: [place], transitive: true }
related_to:      { inverse: related_to,     domain: [person], range: [person],       props: [relation], attribute_class: sensitive }
associated_with: { inverse: associated_with,domain: [person, organization], range: [person, organization], props: [context, strength] }
participated_in: { inverse: had_participant,domain: [person, organization], range: [event], props: [role, date] }
authored:        { inverse: created_by,     domain: [person, organization], range: [document, artifact], props: [date] }
mentions:        { inverse: mentioned_in,   domain: [document], range: ['*'] }
owns:            { inverse: owned_by,       domain: [person, organization], range: [organization, asset, place], props: [share, valid_from, valid_to] }
member_of:       { inverse: has_member,     domain: [person, organization], range: [organization], props: [role, valid_from, valid_to] }
funded:          { inverse: received_from,  domain: [person, organization], range: [person, organization], props: [amount, currency, date] }
# derived-only (never extracted):
adjacent_to:     { derived: true, symmetric: true, props: [distance_m] }
preceded_by:     { derived: true, inverse: succeeded_by }
same_as:         { system: true }
not_same_as:     { system: true }

# attribute_classes.yaml  (X3 / L1)
restricted: [home_address, phone_personal, dob, gov_id, financial_account, health, sexual_orientation,
             religion, immigration_status, minor_identity, precise_geolocation, biometric]
sensitive:  [family_relation, personal_email, ethnicity, political_affiliation, union_membership, criminal_record]
public:     [employer, role, education, public_handle, work_email, publications, public_statements, awards]
```

**Derivations from the registry**

- **Extraction schema (X1):** the registry renders (a) the Zod/JSON schema the model must emit (predicate enum, per-predicate property keys, node-type enum) and (b) the human-readable predicate guide in the system prompt. Prompt version = hash(registry + template).
- **Validation:** a claim whose predicate's `domain/range` disagree with its mentions' types is rejected at insert (`status='rejected'`, reason `type_violation`).
- **Attribute class default:** the predicate's `attribute_class` is the floor; the extractor can raise it (e.g. a `works_at` for a minor at a school → `restricted`).
- **Inverse labels & transitivity** drive the query layer (§11).

---

## 5. Acquisition (A)

### 5.1 Fetch cascade (A1)

```
fetch(url, opts):
  0. policy/robots check → deny → Source{status:'skipped', error:'policy'}
  1. cache: sources by (url|final_url) within TTL (default 7d) → reuse
  2. HTTP GET (undici; UA string; timeout 20s; max 10 MB)
       content-type → html: readability (Mozilla Readability on linkedom DOM) → text
                    → pdf: pdf-parse → text (fallback OCR if < 200 chars/page)
                    → image: OCR (tesseract) + EXIF
                    → json/xml: raw
     success = status 2xx ∧ text.length ≥ 400 ∧ boilerplate_ratio < 0.8
  3. else BROWSER: Playwright Chromium (pool of N contexts, proxy per context), wait networkidle ≤ 15s,
     scroll once, extract via Readability on rendered DOM; also screenshot → blob (used by V3 highlight fallback)
  4. else FIRECRAWL (hosted, handles anti-bot) — same normalized result shape          [D: optional provider]
  5. else ARCHIVE: Wayback CDX API nearest capture; archive.today; mark fetch_method='archive', published_at from capture
  6. all fail → Source{status:'failed', error}, cost logged, frontier action marked failed (planner may retry once via different method)
```

Normalized result: `{ url, final_url, status, method, content_type, title, text, published_at?, lang, raw_blob, links[] }`.
`links[]` (same-domain + outbound, with anchor text) feeds the planner as cheap expansion candidates.

Per-domain rate limit (token bucket, default 1 req / 2 s, overridable per connector), global concurrency cap,
exponential backoff on 429/503. `robots.txt` honored by default; policy `licensed_investigator` may set
`robots: 'ignore'` per workspace with a logged justification (L3).

### 5.2 Search adapters (A2)

```ts
interface SearchProvider {
  name: string;
  search(q: Query): Promise<SearchResult[]>;   // {url, title, snippet, rank, provider}
  costUsd(q): number;
}
```
Providers: Brave (primary — API, cheap, no scraping), Google CSE (secondary), Exa (semantic; used for
`find pages like X`), SerpAPI (fallback). Results merged by URL, ranked by `Σ 1/rank_provider`.

**Query templates** (per seed/entity type; rendered with known hints):
- person: `"{name}"`, `"{name}" {org}`, `"{name}" {city}`, `site:linkedin.com/in "{name}"`, `"{name}" (interview OR profile OR bio)`, `"{name}" filetype:pdf`
- organization: `"{name}" (leadership OR team OR board)`, `"{name}" site:sec.gov`, `"{name}" lawsuit`, `"{name}" press release`
- place/address: `"{street} {city}"`, assessor/property templates
Templates live in `planner/templates.yaml`; P4 adds ad-hoc queries.

### 5.3 Connectors (A3)

```ts
interface Connector {
  name: string; supports: NodeType[]; costUsd: number; requiresPolicy?: PolicyFlag;
  query(entity: EntityRef, ctx: Ctx): Promise<Claim[]>;      // emits claims with source = the API response
}
```
Each connector stores the raw API response as a `sources` row (`kind:'api'`) so claims still point at a
retrievable source with a quote (the quoted JSON fragment). Initial set (M3): OpenCorporates, SEC EDGAR
(full-text + submissions), CourtListener, OpenFEC, OpenAlex, ORCID, USPTO PatentsView, Wikidata, WHOIS/RDAP,
GDELT. Behind flags: LinkedIn/X public-profile fetchers (headless; per-workspace opt-in). All written from
scratch for this codebase (decision 2026-08-29: no code lifted from other projects).

### 5.4 Media (A4)
- OCR: tesseract via `node-tesseract-ocr`, or hosted (Google Vision) per workspace setting.
- ASR: Whisper (local) or AssemblyAI — transcripts become `sources.kind='audio'`.
- Reverse image: Bing Visual Search / TinEye API → candidate URLs into the frontier (score capped so it never auto-expands).

---

## 6. Extraction (X)

### 6.1 Chunking
Text → paragraphs → greedy pack to ≤ 6 000 tokens with 300-token overlap; a chunk never splits a paragraph.
`chunk_hash = sha256(source.content_hash + index + prompt_version)` → idempotent re-runs skip done chunks.

### 6.2 Prompt structure (cache-friendly: stable prefix first)
```
system[0] (cached): role + rules + ontology guide (rendered from registry) + attribute-class taxonomy + examples
system[1]:          investigation context: goal summary, focus entity, known aliases, policy redaction list
user:               <page metadata: url, title, published_at> <chunk text>
output_config.format: zodOutputFormat(ExtractionSchema)
```
Model: `claude-opus-5`, adaptive thinking, `effort: medium` for bulk; re-extraction of low-confidence chunks
at `effort: high`. Refusal handling: `stop_reason === 'refusal'` → chunk marked `skipped:refusal`, logged.

Rules that matter (in the system prompt):
1. Emit only what the text states. No inference across sentences unless the connective is explicit.
2. Every claim carries a verbatim quote (≤ 300 chars) containing both mentions (or the mention + literal).
3. Prefer specific predicates; use `associated_with` only when nothing else fits.
4. Dates as written + normalized ISO with precision (`year|month|day`); "former"/"previously" ⇒ `valid_to` unknown but ≤ page date.
5. Tag `attribute_class` per taxonomy; when in doubt, escalate.
6. Never emit a claim about a person who is clearly a minor unless predicate is `related_to` from an adult subject — and tag `restricted`.

### 6.3 Output schema
```ts
ExtractionSchema = z.object({
  mentions: z.array(z.object({ ref: z.string(), surface: z.string(), type: NodeType, hints: z.array(KV) })),
  relations: z.array(z.object({ subject: z.string(), predicate: Predicate, object: z.string(),
                                properties: z.array(KV), quote: z.string(), confidence: z.number(), attribute_class: AttrClass })),
  attributes: z.array(z.object({ entity: z.string(), key: z.string(), value: z.string(), datatype: z.enum([...]),
                                 quote: z.string(), confidence: z.number(), attribute_class: AttrClass })),
  page: z.object({ published_at: z.string().nullable(), about_focus: z.boolean(), summary: z.string() })
})
```
`ref` is a chunk-local handle so one mention can appear in many relations; KV arrays (not records) keep the
schema strict-compatible.

### 6.4 Quote gate (the hallucination gate)
```
norm(s) = NFKC → lowercase → collapse whitespace → strip quotes/dashes variants
find quote: idx = norm(chunk).indexOf(norm(quote))
  if idx < 0: try fuzzy (Levenshtein ratio ≥ 0.92 over a sliding window of |quote| ± 10%)
  if still not found → REJECT claim (status 'rejected', reason 'quote_not_found')
  else span = map normalized offsets back to raw offsets (offset map kept during norm)
also require: norm(subject.surface) ⊂ norm(quote) ∧ (norm(object.surface) ⊂ norm(quote) ∨ literal ⊂ quote)
  → else REJECT reason 'mention_not_in_quote'
```
Reject rate is a first-class metric (F5); > 8 % on a source triggers re-extraction at higher effort once.

### 6.5 Classification pre-pass (X2)
Haiku 4.5, first 1 500 tokens + title + URL → `{page_kind, relevance 0..1, about_focus}`. `relevance < 0.15`
→ skip extraction (source stays, planner may revisit if it becomes relevant). `directory`/`listing` pages
get shallow extraction (mentions + `mentions` edges only).

### 6.6 Redaction hook (L1, applied *before* INSERT)
`policy.redact(claim)`: if `claim.attribute_class ∈ policy.redact_classes` or predicate flagged → store the
claim with `status='redacted'`, `quote` and `literal` replaced by a hash, `properties` stripped. The row
exists (so coverage knows a fact was found and withheld) but carries no content. Redacted claims never
materialize.

### 6.7 Temporal (X4) & geo (X5) normalizers
Deterministic post-processors: `chrono-node` for date phrases with page date as anchor; property
`date_precision`. Geocoding via Nominatim (self-hosted) or Mapbox per workspace; results cached by
normalized address; writes `places`.

### 6.8 Self-check (X6)
Sampled (10 % of claims + 100 % of `restricted`): Haiku reads (quote, claim) → `supported | unsupported |
partial`. Unsupported → confidence × 0.3 and flagged for review.

---

## 7. Entity resolution (R)

### 7.1 Pipeline
```
new claims → mention records (claim_id, role, surface, type, hints, source_id)
1. normalize: name_norm = strip honorifics/suffixes, NFKC, casefold, collapse; org: strip legal suffixes (Inc, LLC…)
2. identity keys from hints (email, phone E.164, handle@platform, canonical URL, ext ids)
3. R1: union-find on shared identity key (same type) → auto-merge, decision method 'identity_key', conf 0.98
4. same-source coreference: same (source_id, type, name_norm) → merge (a page is about one 'Jane Doe'), conf 0.95
5. R2/R3 blocking: candidate pairs where type equal ∧ (name_norm equal ∨ phonetic(name) equal ∨ last-name equal ∧ first-initial equal)
6. features per pair: name_sim (JW), context_overlap (shared neighbor name_norms via relations), org/location agreement,
   temporal plausibility (no contradictory intervals), hint conflicts (different emails ⇒ strong negative),
   embedding cosine (entity summary embeddings, G4)
7. score = logistic(w·features)  [D: hand-tuned weights at M1; trained on review decisions from M6 eval set]
   ≥ 0.90 → auto-merge (method 'context')  · 0.60–0.90 → resolution_candidates (pending)  · < 0.60 → nothing
   hard rules: identity-key conflict ⇒ never auto-merge; person with name_norm only (no context) ⇒ never auto-merge
8. apply human/model decisions (resolution_decisions) as constraints: 'same' forces union, 'not_same' forbids
9. emit entities (cluster → canonical_name = most frequent surface; aliases = all surfaces; identity_keys = union)
```
Rebuild is full per investigation (fast: claims per investigation are 10³–10⁵); incremental mode only
attaches new mentions to existing clusters and defers re-scoring to the next full rebuild.

### 7.2 Review queue (R4)
UI lists `pending` candidates with both dossiers side by side and the shared evidence; decision writes a
`resolution_decisions` row and triggers rebuild. "Model review" mode: Opus with both entity summaries +
evidence quotes → decision + rationale, stored with `method='model'`; workspace setting controls whether
model decisions auto-apply or queue for a human.

### 7.3 Graph linking (R6)
Graphs are never merged. An investigation created as *linked* lists the graphs it may connect to
(`investigation_links`). After each rebuild of either side, the same scorer (§7.1 steps 5–7) runs across
the pair and writes `graph_links` rows: `≥ 0.90` → `auto`, `0.60–0.90` → `pending` (review queue, same UI
as candidates), decisions persist as `confirmed`/`rejected`. Identity-key matches link at 0.98. Links carry
no claims; each side keeps its own entity, attributes, and edges. Consumers: queries with `scope: linked`
(§11) traverse `graph_links` as a `same_as` edge; the canvas draws linked entities as a dashed
cross-graph edge; the planner reads linked graphs for (a) frontier seeding — known employers, aliases,
identity keys of the focus — and (b) coverage, so it does not re-fetch what a linked graph already
established (facts still get re-verified if the goal needs them). Fresh investigations have no links and
behave as fully isolated graphs.

---

## 8. Graph build (G)

### 8.1 Materialization
```
for each investigation rebuild:
  BEGIN
  DELETE edges, entity_attributes, claim_entities, entities WHERE investigation_id = $1
  run resolver (§7) → entities, claim_entities
  edges: GROUP claims (status='resolved', relation) BY (src_entity, predicate, dst_entity)
         evidence_count = count, max_confidence, claim_ids, observed_first/last from sources.fetched_at
         properties = merge: scalar agreement → value; disagreement → {values:[{value, claim_ids}]}
         valid_from = min(valid_from), valid_to = max(valid_to) with precision = coarsest
  entity_attributes: GROUP attribute claims BY (entity, key, value_norm)
  derived edges (§8.2)
  COMMIT; enqueue embeddings + snapshot
```
Rebuild is serialized per investigation (pg advisory lock) and typically < 5 s at 50k claims.

### 8.2 Derived edges (G3)
- `located_in` transitive closure (bounded depth 5) — materialized for query speed.
- `adjacent_to`: places with `geom` within 150 m (ST_DWithin) — only when policy allows residence data.
- `preceded_by/succeeded_by`: two `lives_at`/`works_at` edges into the same place/org with disjoint intervals, ordered.
- `co_*` (co-worker, co-attendee, co-author): two persons with same-object edges of the same predicate; stored with `derivation` and the two contributing edge IDs. Kept out of the canvas by default (dense), available in queries.

### 8.3 Embeddings (G4)
Entity summary text = canonical name + type + top attributes + top edges (≤ 300 tokens) → embedding
(Voyage `voyage-3`, 1024-d) **[D]**; document embeddings per source (first 2k tokens). Used by R3 (feature),
Q2 (semantic search), P2 (novelty = 1 − max cosine to existing entities).

### 8.4 Snapshots & diff (G5)
Snapshot = `graph.json` `{entities:[{id, type, name, attrs}], edges:[{src, pred, dst, props, evidence_count}], links:[{entity, investigation, linked_entity, score}]}`
written to object store + stats row. `diff(a, b)` keyed by stable IDs where possible, else by
`(type, name_norm)` / `(src_key, pred, dst_key)`; output `{added, removed, changed}` with per-item claim refs.

---

## 9. Planner (P)

### 9.1 Goal model (P1)
```ts
type Goal = {
  intent: 'map_network' | 'locate' | 'verify' | 'due_diligence' | 'timeline' | 'self_audit';
  focus: { type: NodeType; name: string; hints: Record<string,string> };
  target_predicates: Predicate[];           // what edges matter (weights)
  must_answer: { id: string; question: string; predicate?: Predicate; satisfied?: boolean }[];
  exclude: { predicates?: Predicate[]; domains?: string[]; entity_names?: string[] };
  depth: number; time_window?: { from?: string; to?: string };
}
```
Compiled from `goal_text` by Opus (structured output), then displayed; the user edits before start.
Each intent has default `target_predicates` weights (e.g. `due_diligence` → owns/member_of/funded/legal_matter
high, lives_at excluded).

### 9.2 Frontier scoring (P2)
```
score(a) = w_r · relevance(a) × w_n · novelty(a) × quality(a) / cost(a) × decay^hop(a)
relevance : template prior (0.3–1.0) × goal predicate weight of the expansion × (about_focus ? 1 : 0.5)
novelty   : 1 − max cosine(candidate context, existing entity embeddings)   (search/expand), or 1 if URL unseen
quality   : domain prior table (gov/edu/major news 1.0 · social 0.7 · people-search aggregators 0.4 · unknown 0.5), decayed by past reject rate for that domain
cost      : $ estimate (fetch method + expected extraction tokens) normalized
decay     : 0.6 per hop from focus
```
Actions with `score < floor` (default 0.05) are never run. The frontier is re-scored after every rebuild
(novelty changes as entities appear).

### 9.3 Hop policy (P3)
| Node type | Default expansions | Max depth |
|---|---|---|
| person (focus) | all target predicates | — |
| person (non-focus) | works_at, member_of, participated_in, authored | focus depth − 1 |
| organization | leadership/staff (search + connectors), owns/owned_by, legal_matter, press | 2 |
| place: address | residence_of (policy-gated), assessor connector | 1 |
| place: city/region/country | **never** | 0 |
| event | had_participant (speaker lists), authored proceedings | 1 |
| document | mentions (extract only), authored | 0 |
Overridable per investigation; the Frontier UI shows the policy reason when an expansion is skipped.

### 9.4 LLM next-steps (P4)
After each rebuild, the planner assembles `coverage`: `must_answer` status (a question is satisfied when a
structural query over the graph returns ≥ 1 edge/attribute of the target predicate for the focus, with
confidence ≥ 0.6), timeline gaps (intervals on `works_at`/`studied_at` with > 2-year holes), unresolved
candidates, top unexplored entities. Opus receives coverage + a 40-line graph summary and returns ≤ 8
proposed actions `{kind, params, rationale, expected_predicate}`; each is scored by §9.2 with
`relevance = 0.8` prior and `origin.proposer='llm'`. Budgeted: one call per batch, effort `medium`.

### 9.5 Stop conditions (P5) & budgets (F4)
Checked before each batch: `pages_fetched ≥ budget.pages` ∨ `usd ≥ budget.usd` ∨ `elapsed ≥ minutes` ∨
`max frontier score < floor` ∨ `all must_answer satisfied ∧ hop ≥ depth` ∨ user stop. Cost is read from
`cost_ledger` (every provider call writes a row *before* the call with an estimate, updated after).

### 9.6 HITL modes (P6)
`auto` (default), `approve_all` (actions wait in `queued` until approved), `ask_when` rules
`[{match:{kind:'expand', predicate:'lives_at'}}, {match:{connector:'paid:*'}}, {match:{entity_type:'person', hop:'>1'}}]`.
The SSE stream emits `action.waiting`; the Frontier UI/MCP exposes approve/deny.

### 9.7 Event log & replay (P7)
Every transition writes `plan_events` (`action.scored`, `action.started`, `source.fetched`, `claims.inserted`,
`rebuild.done`, `proposal.made`, `stop`). `replay(investigation, {policy, scorer})` re-runs the log with
fetches served from `sources` cache — used for evals (F6) and for "re-run under a stricter policy".

---

## 10. Governance (L)

### 10.1 Policy spec
```yaml
name: professional_context
allowed_seed_types: [person, organization]
allowed_intents: [map_network, verify, due_diligence, timeline]
redact_classes: [restricted]                 # claims stored as redacted
deny_predicates: [lives_at, related_to]      # planner never expands; extractor claims redacted
deny_connectors: [people_search:*, assessor:*]
deny_domains: [spokeo.com, whitepages.com, …]
hop_overrides: { person: { max_depth: 2 } }
robots: respect
requires: { legal_basis: false, consent_artifact: false }
```
Built-ins: `self_audit`, `public_figure`, `organization_only`, `professional_context`, `consented_subject`
(requires consent artifact upload, hashed), `licensed_investigator` (requires legal_basis text; unlocks
`sensitive`, keeps `restricted` redacted unless workspace tier allows).

### 10.2 Enforcement points
1. **Create-time gate:** policy × seed type × intent → deny with reason, or allow.
2. **Plan-time gate:** `policy.allows(action)` before enqueue (predicate, connector, domain, hop).
3. **Extract-time redaction:** §6.6, before INSERT.
4. **Query-time filter:** redacted claims/edges never leave the DB; `restricted` attributes require role ≥ analyst.
5. **Export-time:** watermark (investigation id, user, ts) and policy name embedded in every export.
Each enforcement writes `audit_log`.

### 10.3 Erasure (L4)
Request → verify (workspace admin) → compute `subject_hash` (name_norm + identity keys) → for every
matching entity across investigations: claims `status='redacted', quote=hash`, entities removed on rebuild,
snapshots regenerated, client-system workspace records deleted via connector DELETE, `erasures` row → future
mentions matching the hash are redacted at extraction time (denylist check in §6.6).

### 10.4 Jurisdiction (L2)
Workspace `region` selects DB/object-store region; GDPR workspaces require `legal_basis` on every
investigation and expose `/subject-access` export. FCRA: ToS + an in-product attestation at investigation
creation ("not for employment, credit, insurance, or housing decisions"); intents `screening` do not exist.

---

## 11. Query (Q)

### 11.1 Structural templates (Q1)
Named templates with typed params, compiled to SQL (M1–M4) and to Cypher on the AGE projection (M5+):
`neighbors(entity, predicates?, as_of?)`, `paths(a, b, max_len ≤ 4)`, `residents(place, during?)`,
`members(org, during?)`, `timeline(entity)`, `shared(a, b)` (common neighbors), `co_occurrence(entity, min_shared)`,
`who_before(entity, predicate, place|org)`, `by_attribute(key, value)`. All apply the query-time filter (§10.2).
Inverse direction is handled by reading `edges` where `dst_id = $e` and labelling with `registry.inverse`.

### 11.2 Routing (Q4)
Haiku classifier: `structural | semantic | prose` + extracted params (entity names resolved by fuzzy match
against `entities.name_norm`). Structural first; if the template returns 0 rows, fall through to prose with
the empty result stated.

### 11.3 NL grounded (Q3)
Opus with tools = the templates in §11.1 (tool runner). Instruction: answer only from tool results; cite
`claim_ids`; say "not in graph" otherwise. Response post-processed: each citation resolved to
`{quote, url, span}` for the UI. Optional fan-out tool `external_ask` (§15) for private-world joins.

---

## 12. Monitoring (W)
`watches.cron` → job → `replay` (cached sources re-fetched if older than TTL) + one fresh search pass per
template → rebuild → snapshot → `diff(prev, new)` → alert if non-empty (filtered by saved questions Q5 and
by `alert_on: [new_edge:legal_matter, removed_source, attribute_change:role]`) → deliver (email via Resend,
Slack webhook, generic webhook, MCP notification).

---

## 13. Visualization (V)
Next.js app; canvas = `graphology` model + `sigma.js` WebGL renderer **[D]** (Cosmograph if > 50k nodes).
Data: `/investigations/{id}/graph?as_of&types&min_conf` returns the snapshot-shaped JSON (≤ 5 MB; server
pre-filters). Layouts: ForceAtlas2 (worker thread), dagre for hierarchical, geo via MapLibre underlay with
node coordinates from `places`, timeline = x from `valid_from`. Interactions: hover → edge tooltip
(predicate, props, evidence_count); click → dossier drawer; right-click → expand menu (P6 action);
scrubber → `as_of`. Source highlight (V3): stored `span_start/end` mapped onto the cached text; if the source
was fetched by browser, the screenshot is shown alongside.

---

## 14. Platform (F)

### 14.1 API (F1)
```
POST   /investigations                    create (seed, goal_text, policy_id, budget, mode)
POST   /investigations/{id}/start|pause|stop
GET    /investigations/{id}               status, coverage, cost
GET    /investigations/{id}/events        SSE: action.*, source.*, claims.*, rebuild.*, stop
GET    /investigations/{id}/graph         snapshot-shaped JSON (filters)
GET    /investigations/{id}/entities/{eid}         dossier
GET    /investigations/{id}/frontier      queued/running actions
POST   /investigations/{id}/frontier/{aid}/approve|deny
POST   /investigations/{id}/expand        {entity_id, predicate}
POST   /investigations/{id}/query         {template, params} | {cypher} | {question}
GET    /investigations/{id}/candidates    resolution candidates; POST decision
POST   /investigations/{id}/watch         cron + channels
POST   /investigations/{id}/export        {format}
GET    /sources/{id}                      text + highlights (policy-filtered)
POST   /erasures                          subject erasure
GET    /audit?investigation_id=           audit log
```
Auth: API keys (workspace-scoped) and session JWT from the web app. Rate limits per key.

### 14.2 MCP (F2)
Tools map 1:1 onto the API: `start_investigation`, `get_status`, `approve_action`, `expand`, `query_graph`
(templates), `ask` (NL), `dossier`, `watch`, `export`. Resources: `worldgraph://investigations/{id}/graph`.
Long operations return immediately with an id; `get_status` polls; SSE is bridged to MCP notifications.

### 14.3 Jobs (F3)
pg-boss queues: `fetch`, `classify`, `extract`, `connector`, `rebuild`, `embed`, `snapshot`, `watch`,
`external_sync`. Per-investigation concurrency via a `singletonKey`/partition; retries with backoff; dead-letter
to `plan_events`. Planner loop = a long-running job holding an advisory lock per investigation.

### 14.4 Cost (F4) · Observability (F5) · Eval (F6)
- Cost: every provider wrapper writes `cost_ledger`; LLM cost from `usage` (input/output/cache tokens × price table); budgets enforced by planner.
- Observability: OpenTelemetry traces per investigation (span per action); Prometheus metrics: reject rate, review rate, facts/$, p95 rebuild, fetch success by method.
- Eval: `packages/eval/gold/*.json` — 10 investigations with hand-verified entities/edges. Runner replays each with fetch cache → precision/recall on entities (by identity key or name+type), edges (src,pred,dst), merge accuracy (pairs), planner efficiency (correct facts per $ and per page). CI gate: no metric drops > 2 pts.

### 14.5 Deployment (F7)
Dev: `docker compose` (postgres+pgvector+AGE, minio, api, worker, web). Prod v1: containers on Fly.io/Railway
+ managed Postgres **[D — revisit; Vercel for `web` is fine but workers need long-running processes]**.
Self-host: same compose with env-only config. Secrets via env; per-workspace provider keys encrypted at rest.

---

## 15. Client-system sync (G6) — deferred, optional (M8, behind a flag)

Decision 2026-08-29: not now. Nothing elsewhere in this document depends on this section. Written from
scratch when the time comes; no code is taken from the client's loader.

| WorldGraph | client-system evidence type | Notes |
|---|---|---|
| `entities.type=person` | `contact` | name, aliases, work email/handle if `public`, `worksFor` ← `works_at`/`member_of` edge → becomes `member_of` |
| `entities.type=organization` | `company` | name, domain |
| `sources` (article/page) | `article` | url, title, author ← `authored` edges, published_at |
| other edges (lives_at, funded, dated props) | — | **not pushed** (no client-system edge type); stay client-side |

Flow: normalize → filter to declared fields → push batch to
`/knowledge/connectors/{id}/evidence` → `refresh` → poll `/knowledge/status` → **verify by SQL `/query`** that
nodes/edges are selectable → record `external_urn` on entities. One client-system workspace per WorldGraph
workspace. Read path: Q3 tool `external_ask(question)` → `/ask` with citations, returned as external
evidence (never as claims). Erasure propagates via connector `DELETE`.

---

## 16. Technology choices

| Area | Choice | Why | Alternative |
|---|---|---|---|
| Language | TypeScript / Node 22 | one stack, loader precedent, SDK support | Python (better ML libs; would split the stack) |
| DB | Postgres 17 + pgvector + AGE | one DB, claims-first model is relational | Neo4j (better traversal; second system) |
| Queue | pg-boss | in-DB, transactional enqueue | BullMQ+Redis, Temporal (for long workflows at scale) |
| Fetch | undici + Readability; Playwright; Firecrawl; Wayback | cascade covers 95 % of the web | Crawlee (heavier) |
| Search | Brave API primary | cheap, ToS-clean | SerpAPI (Google results, costlier) |
| LLM | Claude Opus 5 (extract/plan), Haiku 4.5 (classify/route) | structured outputs, caching, quality | Sonnet 5 for bulk at scale (cost) |
| Embeddings | Voyage 3 | quality; Anthropic-adjacent | local bge-m3 (self-host) |
| Web | Next.js + sigma.js/graphology | SSR app + WebGL canvas | Vite SPA |
| Geo | Nominatim (self-host) / Mapbox | free vs. quality | Google Geocoding |
| Object store | MinIO (dev) / S3 | standard | local FS only |
| Observability | OpenTelemetry + Prometheus/Grafana | vendor-neutral | Datadog |

---

## 17. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Extraction hallucination | poisoned graph | quote gate (§6.4) + self-check (X6) + reject-rate alarms |
| Wrong merges | unrecoverable trust loss | conservative thresholds, identity-key conflicts veto, human queue, un-merge by design |
| Anti-bot / blocking | coverage collapse on key sites | fetch cascade, Firecrawl, archive fallback, connectors over scraping where APIs exist |
| Legal exposure (GDPR/CCPA/ToS/FCRA) | shutdown | policies enforced in code, audit log, erasure, no screening intents, per-source ToS posture documented |
| Cost blow-up on open-ended goals | unusable economics | hard budgets, classification pre-pass, hop policy, Haiku routing, prompt caching |
| Planner rabbit-holes | wasted budget, noisy graph | relevance decay per hop, novelty term, floor, HITL modes |
| Client-system dependency | latency/availability | the client system is sync-only; no user-facing path waits on it |
| Ontology churn | prompt/schema drift | registry-as-data, prompt version hashing, evals gate changes |
