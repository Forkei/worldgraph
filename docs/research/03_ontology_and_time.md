# Research 03 — Ontology governance and temporal modeling

*Research agent report, 2026-08-29. Questions: how to keep the vocabulary structured yet flexible without an `other` junk drawer; how time works for age vs works_at.*

## 1. How mature KGs stay structured yet extensible

- **Wikidata.** Closed, governed property set; anyone can *propose* (description, datatype, domain, allowed values, examples, `subproperty of`, duplicate check), then review, creation, and machine-checked *constraints* that are advisory ([proposal process](https://www.wikidata.org/wiki/Wikidata:Property_proposal), [Help:Properties](https://www.wikidata.org/wiki/Help:Properties), [constraints](https://www.wikidata.org/wiki/Help:Property_constraints_portal)). Specificity comes from **qualifiers**, not new predicates: employment = `employer (P108)` + `position held (P39)` / `subject has role (P2868)` / `start time` / `end time`. Property hierarchies via `subproperty of` (P1647), queryable with `wdt:P1647*`. No free-text predicate ever enters the graph; slow review is the point. Failure: ~12k overlapping properties, soft constraints.
- **schema.org.** Small type hierarchy, `domainIncludes/rangeIncludes`, no mandatory properties, a **`pending` staging namespace** before steering-group approval ([How we work](https://schema.org/docs/howwework.html), [Extensions](https://schema.org/docs/extension.html)). The two-tier namespace is the cleanest known replacement for an `other` bucket.
- **YAGO 4.** Forces Wikidata facts into schema.org's taxonomy, maps predicates manually, **drops unmappable facts**, enforces SHACL constraints for consistency ([YAGO 4](https://yago-knowledge.org/downloads/yago-4), [paper](https://suchanek.name/work/publications/eswc-2020-yago.pdf)). Small closed set + hard constraints beats coverage when consumers need to reason.
- **Diffbot / Google KG / Freebase.** Fixed per-type ontology *plus* "non-standard fields" harvested opportunistically — closed core + open attributes that never pollute the core ([Diffbot ontology](https://docs.diffbot.com/docs/ontology)). Freebase used **Compound Value Types** (reified nodes) for n-ary facts.
- **Property-graph practice (Neo4j).** Specific relationship types when queries filter on them; properties when only meaningful within one edge; reify into an intermediate node when the relationship needs its own relationships (`Employment` node) ([modeling](https://medium.com/neo4j/graph-data-modeling-all-about-relationships-5060e46820ce), [intermediate nodes](https://graphacademy.neo4j.com/courses/modeling-fundamentals/8-adding-intermediate-nodes/1-intermediate-nodes/)).
- **Open vs closed IE.** OpenIE = coverage, uncanonicalized phrases; closed IE = clean identifiers, misses the rest ([survey](https://aclanthology.org/C18-1326.pdf), [canonicalization](https://dl.acm.org/doi/10.1145/2661829.2662073)). `predicate: other + label` is OpenIE smuggled into a closed-IE graph — unqueryable and uncanonicalized.

## 2. Predicate hierarchies vs qualifiers

RDFS `subPropertyOf` lets a query for `associated_with` match `spinout_from` via closure at load or expansion at query time. In Postgres: a closure table over the predicate registry.

Rule of thumb:
- **New predicate (subtype)** when the specific relation changes *the edge's semantics* — direction, domain/range, or what queries filter on. `spinout_from(org→org)`, `board_member(person→org)` qualify.
- **Qualifier** when the variation is a *parameter of the same relation* — role, title, share %. `member_of {role: board}`.
- **Both**: shallow hierarchy (≤3 levels), subtypes declare default qualifiers (`board_member` ⇒ `member_of {role: board}`) so consumers query at either level.

## 3. Schema evolution in practice

- **Two-tier namespace** (schema.org `pending`, Diffbot non-standard): extraction may emit `candidate:` predicates, quarantined, with a **mandatory declared parent**; promotion requires review.
- **Proposal → review → promote loop** (Wikidata): proposal record with definition, domain/range, examples, parent, duplicate check (automate via embedding similarity against existing predicates + aliases); promotion is a human click.
- **Ranks** (Wikidata): preferred / normal / deprecated distinguish current, historic, wrong — without deleting ([Help:Ranking](https://www.wikidata.org/wiki/Help:Ranking)).
- **LLM ontology induction.** AutoSchemaKG reports 95% alignment with human schemas at web scale ([arXiv 2505.23628](https://arxiv.org/abs/2505.23628)); OntoEKG (2026) shows LLM-proposed classes/relations get fuzzy-F1 0.12–0.72 and can't judge scope ([arXiv 2602.01276](https://arxiv.org/html/2602.01276v1)). Consensus: schema-guided extraction with LLM-*proposed* extensions aligned by similarity + validation ([survey](https://arxiv.org/pdf/2510.20345)). **LLMs are good at proposing and clustering candidates; not at deciding.** Keep the human in promotion; generate the prompt's predicate list from the registry so prompt and schema can't drift.

## 4. Temporal modeling

- **Wikidata conventions.** Time values carry *precision* (year/month/day); intervals `start time`/`end time`; instants `point in time`; bounds `earliest/latest date`; fuzziness `sourcing circumstances = circa`. **Age is never stored**: "age 34 in 2019" → *date of birth* with precision=year and `determination method = age for a given year mentioned in source` ([Help:Dates](https://www.wikidata.org/wiki/Help:Dates)). Changing attributes = multiple statements with time qualifiers, current one ranked preferred.
- **EDTF** (Library of Congress): `2014`, `2014-05`, `2014~` (approx), `2014?` (uncertain), `201X`, `1990/1995`, `[1990,1992]` ([EDTF Level 1](https://id.loc.gov/datatypes/edtf/EDTF-level1.html)). Canonical string for what the LLM saw.
- **Bitemporal.** Valid time (true in the world) vs transaction time (when we learned it). Graphiti/Zep apply this to LLM-extracted graphs: every edge has `valid_at/invalid_at` and `created_at/expired_at`; a contradicting new fact *invalidates* the old edge rather than deleting ([Zep](https://blog.getzep.com/beyond-static-knowledge-graphs/), [Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)). OSINT needs both axes.
- **Event-centric vs fact-centric.** EventKG / Freebase CVTs reify the tenure as a node ([EventKG](https://arxiv.org/pdf/1804.04526)); property-graph practice keeps dates on the edge until the tenure needs its own relations.

## 5. Attributes vs relations vs reified nodes

- **Literal attribute**: atomic, no identity, never referenced by another node (`date_of_birth`, `founded_year`).
- **Relation to an entity**: value has identity and recurs (employer, city, school).
- **Reified node**: n-ary (person + org + position + dates), needs its own relations (a Position reporting to another; **an Address shared by five shell companies — the shared node is the OSINT signal**), or conflicting versions must sit side by side.

## Recommendation for WorldGraph

### Ontology governance
1. **Predicate registry as data** (table, not enum): `predicate(id, name, tier ∈ {core, candidate}, parent_id, domain_types[], range_types[], allowed_qualifiers, default_qualifiers, description, examples[], aliases[], proposal_id)` + closure table. Same shape for attribute keys.
2. **Delete `other`.** Replace with tier=`candidate` predicates that **must declare a parent from core** (`spinout_from` → `part_of` → `associated_with`). A candidate edge is always queryable at its parent level — never dark data.
3. **Core small and opinionated** (~25): `associated_with` > {`part_of` > {`subsidiary_of`, `spinout_from`}, `member_of` > {`works_at`, `board_member`, `advisor_to`}, `owns`, `funded_by`, `located_at`, `family_of`, `knows`, `attended`, …}. Role-like things are qualifiers on `member_of`/`works_at`; subtypes exist only where domain/range or direction differ.
4. **Proposal loop**: extractor emits `candidate:<snake_case>` with `parent`, `definition`, `evidence`. Nightly job clusters candidates by embedding, matches registry aliases (auto-merge at high similarity), files a proposal with counts and example sentences. Human promotes / merges / rejects-with-alias; promotion rewrites existing edges.
5. **Constraints checked, not just declared**: domain/range and required qualifiers validated at insert; violations flagged (Wikidata style) rather than dropped, counted per predicate.
6. **Prompt generated from registry**, `schema_version` stamped on every claim.

### Temporal model
Every claim (edge or attribute) carries:
- `valid_from`, `valid_to` as **EDTF strings** plus normalized `_lo/_hi` date ranges (year `2019` → 2019-01-01..2019-12-31) for Postgres range operators; `temporal_kind ∈ {interval, instant, snapshot}`; `time_qualifier ∈ {exact, circa, before, after, unknown}`.
- `asserted_at` (source publication date — the world-time anchor), `observed_at` (ingest), `retracted_at` (never delete), `rank ∈ {preferred, normal, deprecated}`.
- **Intervals** (`works_at`): open `valid_to` = ongoing *as of* `asserted_at`, never "forever".
- **Instants** (`attended`): `valid_from = valid_to`.
- **Snapshot attributes** (`title`, `follower_count`, `address`): `valid_from = asserted_at`; a later differing snapshot closes the older one and demotes its rank (Graphiti/Wikidata style).
- **Derived attributes are forbidden as facts.** `age` is never stored: "age 34" on a page dated 2019-05-01 → `date_of_birth = 1984~/1985~` (EDTF, precision year, `derivation = age_at_date`, evidence kept). "10 years at Acme" → `works_at.valid_from ≈ asserted_at − 10y`.
- **Reify when needed**: `works_at` stays an edge with qualifiers until a tenure needs its own relations; `Address` is always a node.
- Views: `claims_as_of(world_date, belief_date)`.

### Five rules for the extraction prompt
1. Only predicates/keys from the supplied list; if none fits, emit `candidate:<name>` with a `parent` from the list and a one-sentence definition — never `other`.
2. Roles, titles, capacities go in qualifiers, not in the predicate name.
3. Every claim gets a time: EDTF as written + `time_qualifier`; no date in text → `snapshot` anchored to page date, never invented.
4. Never emit derived quantities (age, tenure length, "years ago"); convert to the underlying dated fact and mark `derivation`.
5. Quote the evidence span and page date; separate stated from inferred (`inferred: true`).
