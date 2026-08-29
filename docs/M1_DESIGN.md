# M1 design — resolved graph, real evidence, structured ontology

*v0.1 · 2026-08-30. Revised after the research round (`docs/research/01–05`) and the M0 results.
Supersedes the M1 sections of `ARCHITECTURE.md` where they differ. Lines marked **⟵ PUSH** are decisions
the maintainer should hit before build. Nothing here is built.*

---

## 0. What M1 proves

Claims (M0) become a **graph you can trust and undo**: mentions resolve to entities; edges carry an
honest evidence profile instead of a made-up number; the ontology is data with a hierarchy and a
proposal loop instead of an `other` bucket; every claim carries real time. Proven on gold seeds A
(Person A), E (Person E) and a third common-name seed.

Principles carried forward: claims immutable · everything else is a view · decisions are records ·
no number that isn't a count or an audited rate.

---

## 1. Ontology registry v2 (replaces `other`)

### 1.1 Tables (registry is data; YAML remains the authored source, loaded into tables)

```sql
node_types      (id, parent_id, label, description, identity_keys text[], geocodable bool, tier core|candidate)
predicates      (id, parent_id, tier core|candidate, inverse, domain text[], range text[],
                 qualifiers text[], default_qualifiers jsonb, description, examples text[], aliases text[],
                 symmetric bool, transitive bool, derived bool, system bool, proposal_id, created_at)
predicate_closure (ancestor, descendant, depth)          -- rebuilt on change
attribute_keys  (id, parent_id, tier, datatype, temporal_kind, description, aliases text[], derivation_rule)
proposals       (id, kind predicate|node_type|attribute_key, name, parent_id, definition, examples jsonb,
                 count, status pending|promoted|merged_into|rejected, merged_into_id, decided_by, decided_at)
```
Adding anything = one YAML entry (or one row). The extraction prompt is rendered from the registry at
run time; `schema_version` (registry hash) is stamped on every claim. Existing claims are never touched
by a registry change; promotion of a candidate is a relabel (`UPDATE … SET predicate = …`).

### 1.2 Candidates instead of `other`
The extractor may emit `predicate: "candidate:<snake_case>"` **only with** `parent` (a core predicate)
and `definition` (one sentence). The claim is stored with `predicate = parent`, `predicate_specific =
candidate:<name>`, so it is queryable at the parent level immediately. A nightly job groups
`predicate_specific` values, embeds them, matches against registry names + aliases, and writes/updates a
`proposals` row with counts and three example quotes. Decision (human, CLI): `promote` (creates the
predicate under the declared parent, relabels claims), `merge_into <existing>` (adds an alias so the
model stops proposing it), `reject`. Same for node types and attribute keys.

### 1.3 Draft core vocabulary ⟵ PUSH (strike / rename / add)

Hierarchy is shallow (≤ 3). Qualifiers hold parameters; sub-predicates exist only when direction or
domain/range differ. Inverse in brackets.

```
associated_with [associated_with]      *→*            {context, strength}        # the root; weakest link
├─ part_of [contains]                  org|place|event → org|place   {kind}
│  ├─ subsidiary_of [parent_of]        org → org
│  ├─ spinout_from [spun_out]          org → org      {date}
│  └─ located_in [contains]            place|org|event → place       (transitive)
├─ member_of [has_member]              person|org → org     {role, title, seniority, valid_from, valid_to}
│  ├─ works_at [employs]               person → org         {role, title, department, employment_kind}
│  ├─ board_member [has_board_member]  person → org         {board_role: director|chair|observer|advisory}
│  ├─ founded [founded_by]             person|org → org     {date}
│  └─ studied_at [educated]            person → org         {degree, field}
├─ owns [owned_by]                     person|org → org|asset|place|artifact  {share, kind}
│  └─ manages [managed_by]             org → org|asset      (management company → fund/brand)
├─ funded [received_from]              person|org → person|org|event  {amount, currency, round, date, kind}
├─ transacted_with [transacted_with]   person|org → person|org        {kind, amount, date}   (symmetric)
├─ related_to [related_to]             person → person      {relation: parent|child|spouse|sibling|partner|…}   (sensitive)
├─ knows [knows]                       person → person      {context}                  (symmetric)
├─ lives_at [residence_of]             person → place       {kind: owner|tenant|mailing}  (restricted)
├─ participated_in [had_participant]   person|org → event   {role, date}
├─ authored [created_by]               person|org → document|artifact   {date}
├─ mentions [mentioned_in]             document → *
├─ holds [held_by]                     person → credential|position     {issuer}
├─ party_to [has_party]                person|org → legal_matter        {role: plaintiff|defendant|counsel|…}
├─ uses_account [account_of]           person|org → account             {platform}
└─ same_as / not_same_as / suggested_link   (system; never extracted)
```
Node types unchanged from M0 (person, organization, place, event, document, account, artifact,
position, asset, credential, legal_matter, money_flow) — `other` type removed in favour of
`candidate:` with a parent, same mechanism.

Attribute keys get the same treatment: a core list (`date_of_birth`, `date_of_death`, `nationality`,
`gender`, `title`, `description`, `website`, `email`, `phone`, `handle`, `founded_on`, `dissolved_on`,
`headquarters`, `industry`, `ticker`, `registry_id`, `licence_number`, `follower_count`, `amount`, …)
with datatype + `temporal_kind` + optional derivation rule; unknown keys are `candidate:` with a parent
(`candidate:fund_size` → parent `amount`).

---

## 2. Claims v2 — time, derivation, no fudge

Added to both claim tables (M0 columns stay):

```sql
predicate_specific   text null           -- candidate:<name> when the model proposed a subtype
schema_version       text not null       -- registry hash
temporal_kind        text check in ('interval','instant','snapshot','timeless')
valid_from_edtf      text null           -- as written, EDTF: 2019 · 2019-05 · 2019~ · 1990/1995 · [1984,1985]
valid_to_edtf        text null
valid_from_lo/hi     date null           -- normalized bounds for range queries
valid_to_lo/hi       date null
time_qualifier       text check in ('exact','circa','before','after','unknown')
asserted_at          date null           -- page/publish date (world-time anchor for snapshots)
derivation           jsonb null          -- {rule:'age_at_date', from:'age=34', anchor:'2019-05-01'}
inferred             bool default false  -- model marked it as inference, not statement
extractor_conf_raw   real                -- the model's number, kept, never scored
```
Removed: the ×0.8 pronoun multiplier (the `surface_in_quote` flag stays on the Mention).

Rules (in the prompt, checked at insert):
- No date in text → `snapshot` anchored to `asserted_at` (page date) — never invented.
- Interval with open end → `valid_to = null`, meaning "ongoing as of asserted_at".
- **Derived quantities are forbidden**: `age` → `date_of_birth` (EDTF `[1984,1985]`, `derivation`);
  "10 years at X" → `valid_from ≈ asserted_at − 10y` with `time_qualifier = circa`.
- Attribute keys declare `temporal_kind`: `date_of_birth` timeless · `title` / `headquarters` interval ·
  `follower_count` / `amount` snapshot.
- Extraction rule 5: separate *stated* from *inferred*; `inferred: true` is stored and shown, never hidden.

⟵ PUSH: EDTF + normalized bounds + temporal_kind + qualifier — enough? too much?

---

## 3. Evidence model — profile and grade, never a probability

### 3.1 Per claim (computed after insert)
- `passage_fingerprint`: MinHash (or pg_trgm) of the quote's surrounding paragraph.
- `origin_cluster_id`: near-duplicate passages across sources (Jaccard ≥ 0.6) share a cluster — ten
  aggregators of one press release = one origin. The earliest / most-primary member represents it.
- `source_tier` (from a **data table**, editable): `primary` (subject's own site, government/registry/court/
  SEC, official filings) · `wire` (Reuters/AP/AFP) · `press` (established outlets) · `profile` (LinkedIn,
  Crunchbase, Wikipedia…) · `aggregator` (PR wires, scraper sites; counts 0 as independent) · `social` ·
  `unknown`. Seeded from Wikipedia Perennial Sources + a PR-wire list; per-domain overrides.
- `is_primary`: tier primary, or the page's domain matches an identity key of the subject entity (acorncap.com for ACORN).
- `verification`: `supported | partial | unsupported | null` from an independent checker (different model
  family from the extractor; Haiku-class or an NLI cross-encoder). Run on: every `restricted`/`sensitive`
  claim, every claim on an edge with a conflict, and a 10 % random sample. Stored with checker id.

### 3.2 Per edge (aggregation of resolved relation claims with the same src/predicate/dst)
```
independent_sources  = count(distinct origin_cluster_id)
primary_sources      = count(distinct origin_cluster_id where is_primary)
tier_max, tier_histogram
contradicting_sources = independent origins asserting a conflicting object for a functional predicate
                        (e.g. date_of_birth, headquarters) or an incompatible interval
verified             = any claim verification = supported
first_seen / last_seen (asserted_at bounds), valid_from / valid_to (merged, coarsest precision)
grade                = ordinal, see below
```
Grades ⟵ PUSH (labels and thresholds):
| Grade | Rule |
|---|---|
| **Established** | ≥ 2 independent sources incl. ≥ 1 primary · no contradiction · verified |
| **Corroborated** | ≥ 2 independent sources, or 1 primary verified · no contradiction |
| **Single-source** | 1 independent source, verified |
| **Unverified** | extraction only (no checker pass) or fuzzy-quote only |
| **Disputed** | any contradicting independent source of tier ≥ the supporting tier |

Display: `Corroborated · 3 independent sources (1 primary: acorncap.com) · verified · 2019 → present`.
A percentage appears nowhere until an audited precision-per-grade table exists (≥ 200 hand-graded edges).

Same profile on attributes (aggregated per entity + key + value_norm) and on `same_as` links.

---

## 4. Resolution — mentions → entities

### 4.1 Mentions (materialized from claims; immutable per claim)
```sql
mentions (id, claim_id, role subject|object|entity, investigation_id, source_id,
          surface, name, type, hints jsonb,
          name_norm, given, family, initials, org_core, legal_suffix, initialism, family_dmetaphone,
          hard_keys jsonb,          -- {email:[], phone:[], handle:[], url:[], licence:[], registry:[]}
          context jsonb,            -- {orgs:[], places:[], years:[], co_mentions:[]}  from sibling claims
          embedding vector(1024))   -- "name | type | org | place"
```
Normalization uses **dictionaries stored as data** (`dict_legal_suffixes`, `dict_honorifics`,
`dict_name_conventions` by country) — editable rows, not code. ⟵ PUSH if still feels hardcoded.

### 4.2 Blocking (Postgres, OR of cheap rules; target ≤ 50 pairs per mention)
same hard key · same `name_norm` · same `org_core` · `similarity(name_norm) > 0.45` (pg_trgm) ·
`family_dmetaphone` + first initial · initialism ↔ ALL-CAPS token · pgvector top-20 · same source & same type & name overlap (coreference).

### 4.3 Scoring — Fellegi–Sunter (weights learned, not hand-set)
Comparisons: name (exact / JW ≥ 0.92 / dmetaphone / TF-IDF ≥ 0.6 / none), hard-key (match / conflict /
absent), org agreement, place agreement, year overlap, co-mention Jaccard, type agreement,
neighbourhood Jaccard over already-resolved neighbours (collective ER, iterated once).
**u-probabilities learned from the corpus** (random pairs) ⇒ rare names weigh more than common ones
automatically; **m-probabilities via EM**; hard keys carry fixed +15 / veto.
Implementation ⟵ PUSH: **Splink (Python sidecar on DuckDB, scoring only)** vs. porting Fellegi–Sunter
to TypeScript (≈ +1 week, one language). Default: sidecar in M1, port later if it hurts.

### 4.4 Bands ⟵ PUSH
`≥ 0.95` auto-same · `< 0.30` auto-different · between → **LLM review**: batches of 5 pairs, each side
= `{surface forms, type, hard keys, 2 evidence quotes, context}`; output `same | different |
related:<parent|subsidiary|manages|fund_of|alias> | unsure` + one-line reason; `unsure` → human queue.
Model: Haiku-class (different family from the extractor). Expected cost < $1 per 10k pairs.

### 4.5 Clustering + guards
Connected components over `same ≥ 0.95 ∪ llm:same ∪ human:same`, **minus** `not_same`. Then per cluster:
- **Contradiction guard**: two distinct emails / licence numbers / registry IDs / dates of birth ⇒ split at
  the weakest edge; repeat.
- **Type-boundary guard (orgs)**: brand vs legal entity vs fund never auto-merge — the LLM/human may return
  `related:manages` etc., which becomes an *edge*, not a merge.
- Cluster size cap (50) → review.

### 4.6 Decisions, entities, undo
```sql
resolution_decisions (id, mention_a, mention_b, verdict same|not_same|related, related_kind,
                      method rule|score|llm|human, score, evidence jsonb, note, created_at, superseded_by)
entities   = view/materialization: one row per cluster; canonical_name (⟵ PUSH naming rule below),
             aliases[] (all surfaces), hard_keys (union), type, first_seen, last_seen, claim_count
claim_entities (claim_id, role, entity_id)
graph_links (cross-investigation same_as; unchanged from spec)
```
Undo = insert a superseding `not_same` decision → rebuild. Rebuild is deterministic from claims + decisions.
**Hard-key harvesting**: a human `same` decision attaches every hard key of either side to the entity, so
the next mention with that key resolves deterministically.

Naming ⟵ PUSH: default `canonical_name` = the form used by a primary source about itself (acorncap.com →
"ACORN"), else the most frequent surface; legal name kept as attribute `legal_name`; all forms as aliases.

### 4.7 Orgs specifically
Alias seed table from Wikidata (aliases, official website, Crunchbase id) + OpenCorporates/SEC registry
names, loaded on demand for names that appear. Website domain = strongest cheap key. Suffix stripped for
matching but kept as a feature; "Acorn Capital Management LP" → separate legal-entity node with
`manages → ACORN` unless a source states they are the same.

---

## 5. Materialization (rebuild)

```
rebuild(investigation):
  1. mentions ← claims (status raw/resolved)                   deterministic
  2. blocking → pairs → scores (sidecar) → bands               deterministic + cached scores
  3. apply decisions; LLM band only for pairs without a decision and not scored before
  4. clusters + guards → entities, claim_entities
  5. edges ← group relation claims by (src, predicate, dst) with evidence profile + grade
     attributes ← group attribute claims by (entity, key, value_norm) with profile + time
     candidate predicates counted → proposals
  6. derived: located_in closure; predicate_closure views
  7. snapshot graph.json (entities, edges, attributes, links, profiles)
```
Serialized per investigation (advisory lock); incremental mode attaches new mentions to existing clusters
and defers re-scoring to the next full rebuild.

---

## 6. CLI (M1)

```
wg ontology list|show <pred>|propose|promote <candidate> --parent <core>|merge <candidate> --into <pred>|reject
wg rebuild <inv> [--full] [--no-llm]
wg entities <inv> [--type person] [--grade established]
wg dossier <inv> "<name or id>"        aliases · hard keys · edges by predicate with grade + time · attributes with time · sources
wg neighbors <inv> "<name>" [--predicate member_of] [--as-of 2017]
wg candidates <inv>                    pending pairs with both sides + shared evidence
wg decide <inv> <a> <b> same|not_same|related:<kind> [--note]
wg unmerge <inv> "<name>"
wg verify <inv> [--sample 0.1] [--class restricted]      run the checker
wg sources tiers [--set domain tier]
wg proposals <inv>                     candidate predicates / keys with counts and examples
```

---

## 7. Acceptance (gold seeds A, E, and a third common-name seed ⟵ PUSH: pick one)

- **Resolution**: 300-pair scenario-sampled gold set (grouped by comparison vector + adversarial cases:
  two people with the same name, AMCD vs AM, ACORN vs the LP). Cluster-level B³ F1 ≥ 0.90; **zero**
  merges that the contradiction guard should have caught; the registry-profile Person E pair lands in the LLM band
  and resolves `same` or `unsure` (never `different`).
- **Un-merge**: forcing a wrong merge then `wg unmerge` restores both entities with all claims intact.
- **Evidence**: every edge has a grade; LUMEN board seat (acorncap + crunchbase) is ≥ Corroborated; ten
  aggregator copies of one release count as one origin (planted test).
- **Ontology**: every relation claim resolves to a core predicate (directly or via parent); `wg proposals`
  lists the M0 candidates (`spinout_from`, `co-founded`…); promoting one relabels its claims with no re-extraction.
- **Time**: no `age` attribute exists; "age N" pages produce `date_of_birth` with derivation; `neighbors
  --as-of 2017` returns Person A at Alder Maple, not at ACORN.
- **Cost**: rebuild of seed A < $1 (LLM band + checker sample).

---

## 8. Build order inside M1

1. Registry v2 tables + loader + closure + `candidate:` handling in extractor + `wg ontology`; re-extract
   seed A once with the v2 prompt (cached pages, ≈ $0.40).
2. Claims v2 columns + EDTF normalizer + derivation rules + time in prompt.
3. Mentions materialization + normalization dictionaries + blocking.
4. Scoring sidecar (Splink) + bands + decisions table + clustering + guards + `wg rebuild/candidates/decide/unmerge`.
5. LLM review band.
6. Evidence: passage fingerprints, origin clusters, tier table, verifier, edge/attribute profiles + grades.
7. Entities/edges/attributes materialization + `dossier` / `neighbors` / `entities`.
8. Gold set + evaluation script; third seed.

Deferred to later milestones: graph_links across investigations (M8), embeddings for novelty (M2),
meta-path projections / paths (M4), client-system sync (M8).

---

## 9. Push list (collected)

1. Core predicate list (§1.3) — strike / rename / add.
2. Time model scope (§2).
3. Grade labels + thresholds (§3.2); what counts as `primary` for you.
4. Normalization dictionaries as data (§4.1) — acceptable?
5. Splink sidecar vs TS port (§4.3).
6. Bands 0.95 / 0.30 (§4.4).
7. Canonical-name rule (§4.6).
8. Third gold seed (§7).
