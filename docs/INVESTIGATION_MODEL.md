# The Investigation Model — the contract for research, planning, and knowledge

*v0.1 · 2026-08-30. This is the document the three "thinking" pieces of WorldGraph are built against:
**research/exploration**, **planning**, **information organisation**. It resolves the open items from the
research round (`docs/research/01–13`), the tick-by-tick walkthrough (`docs/WALKTHROUGH.md`), and the two
voice memos (`docs/transcripts/`). After it is agreed, changes to these pieces should be rows in tables, not
rewrites. Items marked **ASK** need the maintainer's answer. Items marked **[settled]** come from the research and
would only change if the premise is rejected; **[param]** are tuned from real runs.*

---

## 0. One paragraph

An investigation is a **Question** with **indicators**. The graph — claims, entities, links, slots, hypotheses,
justifications — is the memory the loop reasons over. Each pass, the **gap loop** computes what is missing,
uncertain, or contradictory and raises **Actions**; the **scheduler** orders them by expected information per
cost; **capabilities** (connectors, pivots, tools, the browser) execute them and return claims, captures, and
nulls; the **evaluate loop** ripples every result through justifications, resolution, grades, hypotheses and
standing patterns; the **review loop** sweeps stale work; the **stop rule** closes the Question with a proof
argument. The LLM reads text and media into claims, enumerates hypotheses and expected observations, judges the
ambiguous middle, and can be *consulted* — it never decides identity, absence, source reliability, or when to
stop. Nothing about a subject type, a site, or a tool is hardcoded: types, predicates, expected records, rules,
capabilities, tiers, and weights are data.

---

## 1. Objects

Every object has `id`, `investigation_id` (or `workspace_id`), `created_at`; every *derived* object has a
`justification`. Fields shown are the contract, not the full DDL.

### 1.1 Investigation · Question · Indicator  [settled]
```
Investigation { title, seed: Seed, policy, budget{usd, actions, minutes}, mode: auto|approve,
                linked_investigations[], status }
Seed          { kind: person|org|place|event|photo|document|account|address|free_text, values{}, media[] }
Question      { investigation_id, parent_question_id?, subject_ref (entity or seed), sought: text,
                indicators: Indicator[], kill_criterion: text+rule, stop_criterion: StopRule,
                budget_share, status: open|answered|killed|exhausted }
Indicator     { question_id, name, kind: presence|absence|value|relation,
                expected_predicates[], expected_record_classes[], weight }
StopRule      { min_independent_sources_on: [indicator ids], require_mandatory_records_searched: bool,
                stability_actions: int, max_open_contradictions: int, overturn_risk: low|med }
```
A Question compiles from free text **[LLM door 1b]** using the registry, the indicator taxonomy (§1.13) and
the expected-record table as its only vocabulary. Sub-questions are raised by hypotheses ("where was the
wedding?") and by the FAN rule ("ring 1 is silent → question the household"). An investigation may hold many
Questions; each owns its Actions and its stop.

### 1.2 Source · Capture  [settled]
```
Source   { url|locator, capability_id, kind: html|pdf|image|audio|video|api|dataset|manual,
           fetched_at, content_hash, text, title, published_at, lang, capture_id, source_family_id,
           tier (from source_tier table), status }
Capture  { source_id, blob_key (raw bytes), snapshot_key (rendered/WARC/screenshot), hash, taken_at }
```
Every fetch is captured (hash + raw + rendered snapshot) **before** extraction — the Hunchly rule — so a claim's
page can always be re-shown. `source_family_id` groups outlets that share an upstream (all US people-search
aggregators = one family; PR-wire syndications = one family) — the independence rule lives here, as data.

### 1.3 Claim · Mention · Media  [settled; from M0/M1]
Relation claims and attribute claims as in `M1_DESIGN.md` §2 (quote-gated, EDTF time, `asserted_at`,
`derivation`, `attribute_class`, `extractor_conf_raw` never scored), plus:
```
MediaClaim { source_id, media: {blob_key, kind: photo|video|audio, hash, exif{}}, depicts: Mention[],
             quote_region? (bbox/timestamp), confidence, attribute_class }
Mention    { surface, name, type, hints{}, surface_in_quote, face_ref? (embedding id, local only) }
```
Photos, videos, logos, maps are first-class: a node can carry media; a claim can be "this photo depicts X"
with a region. The graph is not text-only.

### 1.4 Entity · Link · Attribute · Grade  [settled]
Entities are views over claims + decisions (M1). Links aggregate claims and carry the **evidence profile**
(independent sources = distinct source families × origin clusters, primary count, contradictions, verified) and
the **two-axis grade** (reliability A–F from the source-tier table; credibility 1–6 from independence,
corroboration, contradiction), rolled up to the five labels (Established … Disputed). **Competing values**
(two residences, two spouses, three candidate wedding venues) are *not* collapsed: a link may have
`alternatives[]`, each with its own profile and grade — "multiple arrows to the same place, each with a
confidence" — and a hypothesis (§1.8) governs which, if any, is preferred.

### 1.5 Slot · ExpectedRecord  [settled]
```
ExpectedRecord { entity_type, jurisdiction, period?, record_class, capability_id, expectedness: mandatory|usual|possible,
                 how_to_query (template), source_note }
Slot           { entity_id, kind: predicate|record_class|indicator, key,
                 status: unset|found|searched_absent|unknown|not_obtainable|not_applicable,
                 source_id?, searched_at?, query?, scope: text ("what nil means"), reason? , grade? }
```
Absence is an object. `searched_absent` on a `mandatory` record is evidence. `not_obtainable` carries the
reason (law, paywall, CAPTCHA) and a `capability_id` that would obtain it if it ever exists.

### 1.6 Rule  [settled mechanism; param content]
```
Rule { kind: shape|expectation|derivation|hypothesis_generator|lead|anomaly, body (pattern), head (pattern),
       source: hand|mined, confidence, jurisdiction?, enabled, created_from }
```
Shapes ("a person has ≥1 residence per covered period"), expectations ("US-IL teacher ⇒ ISBE licence"),
derivations (`spouse(x,y) ∧ lives_at(x,a,t) ⇒ lives_at(y,a,t)` with confidence → gap task, never a fact),
hypothesis generators ("`related_to{unknown}` + same surname + close age ⇒ H: spouse|sibling"), leads ("new
email ⇒ Actions Gravatar, Holehe, GHunt"), anomalies ("director on > 50 orgs", "a person with 6 addresses in
2 years"). Hand-written first; mined (AnyBURL) once our own graphs are large enough; every rule has an
observed precision that gates whether it may raise Actions automatically **[param]**.

### 1.7 Justification  [settled]
```
Justification { derived_id, derived_kind: link|attribute|merge|grade|hypothesis_score|slot_status|alternative,
                supports: [ {kind: claim|decision|rule|source|slot, id} ], status: in|out, computed_at }
```
The dependency graph. Retracting a claim, a merge, a source's tier, or a rule re-derives everything that
rests on it (delete-and-rederive; §4.2). Grades are computed from justifications, never stored by hand.

### 1.8 Hypothesis · Evidence · Alternative  [settled; two kinds first]
```
Hypothesis   { question_id, kind: identity|relation_kind|value|event|free,
               claim_pattern (graph pattern), alternatives: Alternative[]  (mutually exclusive),
               status: open|supported|established|disproved|abandoned, prior, score,
               predicted_if_true: Observation[], predicted_if_false: Observation[], assumptions[] }
Alternative  { label, pattern, score, evidence: HypEvidence[] }
HypEvidence  { hypothesis_id, alternative_id?, evidence: {kind: claim|link|slot(searched_absent)|media, id},
               polarity: supports|refutes, diagnosticity, recorded_expectation }
Observation  { record_class|predicate|pattern, where (capability/source), diagnosticity, cost_estimate }
```
Kinds at M1: **identity** ("mention X is entity Y") and **relation_kind** ("Robert is spouse | sibling |
co-owner"), both rule-generated. Added next: **value** ("the wedding was in {Lyon | Aix | Nice}") and **event**
("this photo is a wedding") — these are what the photo memo needs, and they are where the LLM proposes
**[door 2]**. `free` (narrative hypotheses) later. A hypothesis is never "proven"; *established* means the
stop-rule thresholds are met. Mutually exclusive alternatives attack each other; the committed set is the
grounded extension (a fixpoint query).

### 1.9 Action  [settled; HOLMES state machine]
```
Action { question_id, line_of_enquiry: text, kind: fetch|search|capability|read|resolve|verify|expand|manual|consult,
         target (entity/slot/hypothesis/source), capability_id?, params{},
         raised_by: {kind: slot|hypothesis|rule|lead|review|human|consult, id}, originating_source_id?,
         priority: high|medium|low, score, score_parts{expected_gain, p_find, cost, tier, ring},
         state: for_allocation|allocated|running|completed|resulted|filed|referred|pended|failed,
         pend_until?, result_summary?, result_refs[], cost_actual, started_at, finished_at }
```
One line of enquiry per Action. Duplicate check before raising. Reopening a filed Action = a new Action citing
it. `manual` Actions are tasks for a human (CAPTCHA portal, a phone call), with what the system expects back.
`consult` Actions are LLM door 4.

### 1.10 Watch  [settled]
```
Watch { owner: {kind: slot|hypothesis|rule|indicator|human, id}, pattern (type, predicate, node?, window?, value?),
        fires: Action template | hypothesis re-score | slot close, expires_at, dedupe_key, muted }
```
Every pending thing is a standing pattern; arrival of a matching claim/link fires it (index lookup, not rescan).
Free-floating rules are not allowed: a Watch always names the Question it serves.

### 1.11 ResearchLog · DecisionLog  [settled]
```
ResearchLog  { action_id, capability_id, query, scope ("what nil means"), executed_at,
               result: found|no_trace|error|partial, refs[], cost, tier }
DecisionLog  { seq, at, actor: system|human|llm, kind: scope|merge|split|refer|pend|policy|stop|kill|capability,
               subject_ref, rationale, inputs[] (justification refs), reversible_by? }
```
"Why did you look there?" = `Action → raised_by → (slot|hypothesis|rule) → justification → claims/sources`.
"Why did you decide that?" = the DecisionLog row.

### 1.12 Capability  [settled mechanism; open inventory]
```
Capability { name, kind: connector|pivot|search|fetch|browser_action|tool|dataset|manual,
             inputs: fact_type[], outputs: fact_type[] (+ claim predicates it can emit),
             cost{usd, seconds}, tier: L0|L1|L2|L3|L4, jurisdictions[], entity_types[],
             cache: {key_fields[], ttl}, rate: {per_min, per_day}, requires: {key?, cookie?, account?},
             yield_prior: {hits, runs} (learned), enabled, source_family_id, added_by: hand|acquired, spec_ref }
```
This is the **capability graph**: nodes are fact types (name, city, employer, username, email, phone, address,
licence#, DOB, photo, face_ref, Gaia ID, SteamID, parcel, club, …), edges are capabilities. Given the current
graph, the enabled set is "capabilities whose inputs exist". It is what the memo calls *not hardcoded*: X,
LinkedIn, Instagram, athle.fr, ISBE are rows, not code paths. See §6 for acquisition of new ones.

### 1.13 Indicator taxonomy  [param; seeded]
A table `indicator_template(subject_type, name, kind, expected_predicates, expected_record_classes, default_weight)`
seeded from the 40-scenario matrix (research 09): person → {employer/tenure, credential, residence per period,
DOB, household, relatives, accounts, activities, legal, assets}; organization → {officers, ownership, registered
address, filings, litigation, funding, sanctions}; event → {when, where, who attended, organizer, kind}; photo →
{who is depicted, when, where, what event}. Questions compile against this table.

---

## 2. Loops

### 2.1 Ingest  (Receiver → Reader → Indexer)
```
on Source captured:
  extract → claims (door 1); media → MediaClaims (door 1m); tables → one claim per row, row = span
  quote gate; domain/range; policy hook; insert (append-only)
  mentions → resolution candidates (M1 pipeline); hard keys harvested
  fire Watches on every new (node, predicate) and every new hard key
  lead rules → Actions ("new email ⇒ …"); anomaly rules → Actions or hypotheses
  ResearchLog row for the Action that produced this Source (found | partial)
```

### 2.2 Gap  (Action Manager + Collection Manager)
```
for each open Question, for each entity in ring ≤ R (R from budget):
  slots ← shapes ⋈ expected_records ⋈ indicators (regenerated on the delta)
  gap Actions ← slots with status unset|stale and a runnable capability
  hypothesis Actions ← predicted observations not yet checked, ordered by diagnosticity
  derivation rules with missing heads → gap Actions (confidence = rule precision)
  ring rule: if ring 0 slots are exhausted or silent on an indicator → open ring 1 (household/officers),
             then ring 2 (relatives/co-directors/agents), then ring 3 (neighbours/associates); each hop logs its reason
  duplicate-check; score (§3); enqueue
```

### 2.3 Evaluate returns
```
on Action resulted:
  tag result to the Action and to the slot/hypothesis/indicator it served
  found | partial ("what remains" → new Action) | no_trace (slot ← searched_absent, scope recorded) | error (retry policy)
  delta pass: resolution (collective, priority queue), same_as closure, temporal bounds, alternatives re-scored
  justification maintenance: re-derive dependents; recompute grades; contradictions → §5
  hypotheses touched → re-score; established/disproved transitions → DecisionLog; disproved → its Actions filed
  cueing: if the result changed any priority by > θ, re-rank now (don't wait for the tick)
```

### 2.4 Review
```
every N actions or T minutes:
  stale Actions (allocated too long) → re-allocate or refer; pended past pend_until → for_allocation
  Watches past expiry → muted; slots searched > TTL ago on covering predicates → stale
  key-assumptions check: the Question's assumptions[] re-evaluated against current grades
  budget check: spent vs share; ring budgets
  contrarian pass (door 3c) on any hypothesis about to become established
```

### 2.5 Stop / kill
```
kill:  kill_criterion true (e.g. seed unverifiable after mandatory records) → status killed, report why
stop:  StopRule satisfied → status answered → proof argument (door 1p) → context-isolated check (door 3c) → dossier
exhausted: budget gone or frontier below floor with StopRule unmet → status exhausted, report what remains
```
Budget is a ceiling, never the stop criterion.

---

## 3. Attention — the priority of an Action  [mechanism settled; weights param]

```
score(a) = expected_gain(a) × p_find(a) / cost(a) × tier_factor(a) × ring_decay(a)
expected_gain = Σ over things the result would change:
    indicator weight (if it fills an indicator slot)
  + diagnosticity (if it tests a hypothesis: how far it separates alternatives)
  + hard_key_bonus (if outputs include a hard key)           # hardest-fact-first
  + structural_delta (dependents that would re-derive; bridges/articulation points; low-degree-high-evidence nodes)
  + novelty (1 − max similarity to existing entities)       # only for exploration budget
p_find   = expectedness prior × capability yield_prior (learned) × source freshness
cost     = usd + seconds×rate + human_time (manual)
tier     = L0/L1 = 1 · L2 = 0.9 · L3 = policy-dependent · L4 = 0 (never)
ring     = decay per ring; ring budgets enforced separately
```
Weak-key ban: Actions raised from a D/E-grade or inferred fact are capped at Low unless a hypothesis names them.
Answer-from-graph-first: before any capability runs, the slot is checked against the graph and linked graphs;
a hit costs nothing and is logged as `found(cached)`.

---

## 4. Graph reasoning services  [settled]

### 4.1 Gaps
Shapes as expectations (Warning-severity, never rejections) · Partial Closed-World per (entity, predicate) ·
interval coverage on `covering` predicates (holes = slots with a window) · expected-record join · derivation
rules with missing heads · structural anomalies (missing reciprocals, one-sided relations, degree outliers per
peer group, isolated nodes, provenance asymmetry) · salient negatives (peers have it, this one doesn't).

### 4.2 Propagation
Justification graph + delete-and-rederive (DRed) on retraction · collective resolution (neighbourhood
similarity, priority queue to convergence; a merge invalidates a bounded set of scores; splits reverse it) ·
temporal bounds (death/dissolution/marriage dates tighten adjacent intervals; `lo > hi` → contradiction) ·
grades recomputed from justifications · soft joint scoring (PSL / KGI) only for components where the queue
oscillates **[later]**.

### 4.3 Standing patterns
`watch` table + insert trigger + index lookup; multi-hop patterns evaluated on the delta by the rule engine.

### 4.4 The graph toolkit ("SQL on drugs")  — what the loop and the LLM both call
```
ego(entity, hops, predicates?, as_of?, min_grade?)          → subgraph
paths(a, b, max_len, predicates?, time_window?)              → paths with evidence
intersect(subgraph_a, subgraph_b, on: place|event|org|person) → shared nodes   # "which events were both at"
fold(meta_path)  e.g. person–org–person, person–event–person   → projected graph with path evidence
timeline(entity | subgraph)                                  → dated edges/attributes, gaps, contradictions
neighbors_by_time(entity, t)                                  → what was true at t
competing(entity, predicate)                                  → alternatives with grades
gaps(entity)                                                  → open slots, stale slots, holes
why(edge | entity | action)                                   → justification chain
similar(entity, k)                                            → embedding + structural neighbours
```
Every call returns a bounded subgraph with grades, sized for a model context; the LLM never receives the whole
graph. New operators are added to this toolkit as needed — it is the *only* way the LLM touches the graph.

---

## 5. Contradictions  [settled]
A contradiction is a graph object, not an exception: two `lo > hi` bounds, two primaries disagreeing on a
functional predicate, a `not_same_as` decision that would split a live cluster. On detection: (1) the link
becomes **Disputed** with `alternatives[]`; (2) a `value` hypothesis is raised with the alternatives and their
existing evidence; (3) an Action is raised for the most diagnostic missing observation; (4) DecisionLog row.
Nothing is deleted; the dossier shows both sides.

---

## 6. Capabilities — inventory, cache, acquisition  [mechanism settled]

### 6.1 Execution contract
A capability receives `{inputs, question context, budget}` and returns `{claims[], media[], sources[], nulls[]
(with scope), links_found[], cost, tier_used}`. It never writes to the graph; `knowledge` does. Manual
capabilities produce a task with the expected return shape.

### 6.2 Cache  (answers "no hardcoding — cache instead")
One `source_cache` keyed by `(capability, normalized inputs)` with the capability's TTL. A bulk dataset
(INSEE deaths, DVF, Sirene, ISBE salary file, OpenSanctions) is a capability of kind `dataset` whose first run is
a big fetch and whose TTL is long; every later query reads the cache. Re-runs never refetch fresh sources;
Watch decides when "fresh" expires. No source is special-cased in code.

### 6.3 Search engines  [decision]
Google via **SerpAPI** (only route to Google/Scholar/Lens; litigation risk accepted for private use), **Exa**
for semantic discovery, DuckDuckGo/Brave for gap-filling without result storage. Search results are Sources
(kind `api`) captured like any page.

### 6.4 The browser as a capability  (the memo's "checking likes, stories, comments")
A generic **authenticated browser** capability (Playwright with the owner's own sessions, L3) exposes
primitives — `open(url)`, `list(selector)`, `expand`, `screenshot`, `download(media)` — and site *recipes* as
data (`instagram.likes_of_post`, `instagram.story`, `x.replies`, `facebook.event_going`) that compose those
primitives. A new site = a new recipe row, authored by hand or proposed by the LLM from a page (§6.5), tested
on one example, then enabled. Never per-site code.

### 6.5 Capability acquisition  (the memo's "learns that this tool is useful, keeps it")
```
propose:  the LLM (door 2c), from a page, an API doc, or a failed slot, drafts a Capability spec + recipe
test:     run on one known example; compare output to expectation; record tier, cost, yield
enable:   ASK — auto-enable when the test passes, or require a human click?  (default proposal: auto for L0–L2, click for L3)
learn:    yield_prior updates on every run; capabilities that stop yielding are demoted, not deleted
share:    capabilities are workspace-level: learned on one investigation, available to all
```

### 6.6 Media & faces  — ASK
Two different things the memo conflates, treated separately:
- **Reference matching inside our own material**: comparing faces/objects in a photo against media already on
  nodes in this or linked graphs (profile pictures we captured), locally, producing an *identity hypothesis* with
  a score, never an assertion. This is local biometric processing of data we hold for private purposes.
  Proposal: **allowed** (tier L3), always as a hypothesis, always requiring one non-face corroboration before
  a merge. Face embeddings never leave the machine and are never stored outside the investigation.
- **External face-search services** (PimEyes, FaceCheck, Clearview-like): the hard-no tier (L4) — Art. 9 /
  BIPA exposure and third-party processing. Reverse *image* search for object/scene reuse stays L0.
**ASK:** accept this split? (The wedding-photo walkthrough works with reference matching + scene/object pivots
+ the graph; it does not need external face search.)

### 6.7 Manual tasks
Capabilities of kind `manual` raise a task for the owner with a form for the expected return (a CAPTCHA
portal's result, a phone call's outcome). The loop pends the Action and continues.

---

## 7. LLM doors  [settled]
| Door | Call | Contract | Guardrail |
|---|---|---|---|
| 1 read | text/PDF/media → claims | schema from registry; verbatim quote/region; time as written; `inferred` flag | quote gate; domain/range; never a claim without a source |
| 1b compile | goal → Question/indicators | vocabulary = registry + indicator table + expected records | user-visible; editable |
| 1p prose | graph subgraph → proof argument / dossier text | every sentence cites claim ids | door 3c checks it |
| 2 hypothesize | node/subgraph → competing hypotheses + predicted observations (+ 2c capability proposals) | must list alternatives and *if-false* observations | scored by the graph, not by the model |
| 3 judge | ambiguous ER pair with both dossiers; 3c context-isolated verifier (sees evidence only, not the prior conclusion) | verdict ∈ {same, different, related:kind, unsure} + reason | only the middle band; never clear cases |
| 4 consult | "top-k next Actions and why — add/veto?"; "explain this anomaly" | returns candidates with rationale | candidates enter the queue *scored*; a veto lowers priority, never deletes; rate-limited per Question |
The LLM never asserts identity, decides absence, grades a source, scores its own hypotheses, or decides to stop.

---

## 8. Reuse — answer from the graph first  [settled]
Before any Action runs: check the slot against this graph and every linked graph (`graph_links`, cross-graph
`same_as` at ≥ threshold). A hit is `found(cached)`. A photo seed first tries reference matching against media
in linked graphs (§6.6). Linked graphs never merge; their facts arrive as claims with the other investigation
as source (tier = that graph's grade).

---

## 9. Resolution of the open items (from the "what's missing" list)

| # | Item | Decision |
|---|---|---|
| 1 | Connector/pivot contract | §1.12 + §6.1 |
| 2 | Source cache semantics | §6.2 |
| 3 | Capture for provenance | §1.2 — every fetch captured before extraction |
| 4 | Independence of sources | `source_family` on Source + origin clusters on claims; both feed the grade |
| 5 | PDF/table pipeline | tables → one claim per row, row = span; scanned → OCR; part of door 1 |
| 6 | SERP provider | §6.3 — SerpAPI + Exa (+ DDG/Brave unstored). **ASK**: approve ~$30–60/mo |
| 7 | Question schema + indicator taxonomy | §1.1, §1.13 |
| 8 | Rule authoring before mining | hand-written rules with observed precision gating auto-actions; mining when graphs exist |
| 9 | Scheduler | §3 + ring budgets + concurrency per capability rate; referral = Low for 2 reviews → referred |
| 10 | Contradictions | §5 |
| 11 | Multi-question / linked graphs | §1.1 sub-questions; §8 |
| 12 | Door-4 guardrails | §7 |
| 13 | Slots / expected records / justifications | §1.5, §1.7 |
| 14 | Grade formula | reliability from tier table; credibility from independent families/origins, corroboration, contradictions; labels as in M1 §3.2; computed view |
| 15 | same_as as claims + split test | identity hypotheses (§1.8) with a split-test Action before merge |
| 16 | Subgraph API | §4.4 |
| 17 | Research log with scope | §1.11 |
| 18 | Reified-node rules | adopt research 06: address/position/transaction become nodes per its rules |
| 19 | Snapshot/diff | unchanged; sits on justifications |
| + | Media on nodes; faces | §1.3, §6.6 **ASK** |
| + | Capability acquisition | §6.5 **ASK** (auto-enable tiers) |
| + | Browser recipes | §6.4 |
| + | Competing values with confidence | §1.4 alternatives + §1.8 value hypotheses |

**ASK list for the maintainer:** (a) §6.6 face split; (b) §6.5 auto-enable tiers for acquired capabilities; (c) §6.3
SerpAPI/Exa budget; (d) default ring budget (proposal: ring 0–1 unlimited within Question budget, ring 2 ≤ 30%,
ring 3 ≤ 10%); (e) whether L3 browser recipes using *your* logged-in sessions are acceptable by default (memo says
yes — confirm).

---

## 10. Module boundaries

| Package | Owns | Depends on | A change looks like |
|---|---|---|---|
| `core` | registry, claim model, policy hook, ids, config | — | YAML row |
| `knowledge` | sources/captures, claims, entities/links/attributes, slots, expected records, rules, justifications, grades, same_as, hypotheses (storage), snapshots, graph toolkit (§4.4) | core, db | rule row, expected-record row, one grade function |
| `plan` | questions, indicators, actions, scheduler, watches, review, stop/kill, research & decision logs | knowledge | indicator row, weight, hypothesis kind |
| `acquire` | capability registry, cache, capture, fetch cascade, search, connectors, browser + recipes, datasets, manual tasks | core | drop in a capability row/module or a recipe |
| `llm` | the doors as interfaces; prompt versions; model routing | core, knowledge (toolkit) | swap a prompt/model |
Contracts between packages are tables and the interfaces above. Connectors never write to the graph; the LLM
never touches the graph except through the toolkit; nothing derived is edited by hand.

---

## 11. What this changes in the plan
M0 stands. M1 becomes "the reasoning substrate": claims v2, registry v2, sources+captures+families, slots +
expected records, justifications + grades as views, same_as as claims with identity hypotheses, research and
decision logs, the graph toolkit, and the resolver as one Action type. M2 becomes the loop (Question, Actions,
scheduler, watches, review, stop) with the capability registry and the first ~15 capabilities. Photos/faces and
capability acquisition are M3 items. `BUILD_PLAN.md` is rewritten after this document is agreed.
