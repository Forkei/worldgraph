# The Investigation Model — the contract for research, planning, and knowledge

*v0.2 · 2026-08-30. The document the three "thinking" pieces of WorldGraph — **research/exploration**,
**planning**, **information organisation** — are built against. Resolves the research round
(`docs/research/01–13`), the walkthrough (`docs/WALKTHROUGH.md`), and the two voice memos. v0.2 applies
the maintainer's rule: **power in simplicity** — every object that was a special case of another was removed. After
this is agreed, changes to these pieces should be rows in tables, not rewrites. **[settled]** = from the
research; **[param]** = tuned from runs; **ASK** = needs the maintainer.*

---

## 0. The whole thing in one paragraph

An investigation is a **Question** with **indicators**. The graph — sources, claims, entities, links, slots,
hypotheses, justifications — is the memory the loop reasons over. Each pass, the **gap loop** computes what is
missing, uncertain, or contradictory and raises **Actions**; the **scheduler** orders them by expected
information per cost; **capabilities** execute them and return claims, media, and nulls; the **evaluate loop**
ripples every result through justifications, resolution, grades, and hypotheses; the **review loop** sweeps
stale work; the **stop rule** closes the Question with a proof argument. The LLM reads text and media into
claims, enumerates hypotheses and expected observations, judges the ambiguous middle, and can be consulted — it
never decides identity, absence, source reliability, or when to stop. Nothing about a subject type, a site, or a
tool is hardcoded: types, predicates, rules, capabilities, tiers, and weights are data.

## 0.1 Simplicity rules (apply to every piece)
1. **One representation for uncertainty: more edges.** Person A `lives_at` X and `lives_at` Y are two links,
   each with its own evidence. No `alternatives[]`, no "preferred value" field. A hypothesis may *refer* to a
   set of competing links; the links themselves stay plain.
2. **Anything pending is a slot or a hypothesis.** No separate "watch" object: every open slot and every open
   hypothesis *is* a standing pattern, and new facts are matched against them on arrival.
3. **Anything expected is a rule.** Expected records, shapes, derivations, lead-generators, anomaly detectors,
   hypothesis generators — all rows in one `rule` table with a `kind`.
4. **The research log is the Actions.** A resulted Action *is* the log entry (capability, query, scope, result,
   cost). No second table.
5. **Media is a source; "depicts" is a claim.** No media-specific claim type; the "quote" of a photo claim is a
   region, of an audio claim a time range.
6. **Everything derived carries its justification and is recomputed, never edited.**
7. **The LLM touches the graph only through the toolkit (§4.4), with bounded subgraphs.**

---

## 1. Objects (twelve)

### 1.1 Investigation · Question  [settled]
```
Investigation { title, seed{kind, values{}, media[]}, policy, ceiling?{usd|actions|minutes} (optional hard stop, unset by default),
                mode: auto|approve, linked_investigations[], status }
Question      { investigation_id, parent_question_id?, subject_ref, sought: text,
                indicators: [{name, predicates[], record_classes[], weight}],
                kill_criterion, stop_rule{min_independent_on[], mandatory_searched, stability_actions, max_open_contradictions},
                status: open|answered|killed|exhausted }
```
Compiled from free text (door 1b) against the registry, the indicator table (§1.11) and the rules. Sub-questions
are raised by hypotheses ("where was the wedding?") and by ring expansion ("household is silent → question it").

### 1.2 Source  [settled]
```
Source { locator, capability_id, kind: html|pdf|image|audio|video|api|dataset|manual, fetched_at,
         content_hash, blob_key (raw), snapshot_key (rendered/WARC/screenshot), text?, title, published_at,
         lang, source_family_id, tier, status }
```
Captured **before** extraction (raw + rendered snapshot + hash), so a claim's page can always be re-shown.
`source_family_id` groups outlets that share an upstream (all US people-search aggregators = one family; a
PR-wire syndication = one family) — the independence rule, as data.

**Reliability is never a property of a domain** (decision 2026-08-30: no hardcoded site lists). Each source
is classified *from its own content* — `doc_kind` (record, filing, minutes, roster, directory, article, paper,
transcript, profile, page, post, listing, forum), `publisher_name`, `self_published` — and a claim's
reliability tier is computed per claim: a small **evidence prior by document kind** (a filing is not a forum
post; ~14 rows, adjusted by observed agreement), **+1 step when the page is self-published about the entity it
concerns** (a company's own team page is authoritative about its roster — but not independent), a **learned
adjustment** once a source has ≥ 20 observed agreements/contradictions with independent origins, and an
**owner override** if one was decided. `source_tiers` holds only overrides; it is empty by default.

### 1.3 Claim  [settled; M0/M1]
Relation claims and attribute claims as in `M1_DESIGN.md` §2 — quote-gated, EDTF time, `asserted_at`,
`derivation`, `attribute_class`, `extractor_conf_raw` never scored. The quote's span is a character range in
text, a **bounding box** in an image, a **time range** in audio/video. A photo that shows Jane is
`source —depicts→ Jane {region}`; a node's profile picture is a `depicts` claim from an image source. Mentions
may carry a local `face_ref` (an embedding kept on this machine, used only by §6.6).

### 1.4 Entity · Link · Attribute  [settled]
Views over claims + decisions (M1). A link aggregates the claims for one `(src, predicate, dst)` and carries
the **evidence profile** (independent sources = distinct families × origin clusters, primary count, verified,
contradicting links) and the **grade** (reliability A–F from the tier table × credibility 1–6 from
independence/corroboration/contradiction → Established · Corroborated · Single-source · Unverified · Disputed).
Competing facts are simply **several links** with the same predicate; when they cannot all be true (a
functional predicate: date of birth, one current registered address), each is marked *contested* by the others,
and a hypothesis (§1.8) governs the question of which is right. Nothing is collapsed.

### 1.5 Slot  [settled]
```
Slot { entity_id | question_id, key (predicate | record_class | indicator), window?,
       status: unset|found|searched_absent|unknown|not_obtainable|not_applicable,
       source_id?, action_id?, searched_at?, scope ("what nil means"), reason?, raised_by_rule }
```
Absence is an object. `searched_absent` on a mandatory record is evidence. `not_obtainable` carries the reason
(law, paywall, CAPTCHA) and the capability that would obtain it if it ever exists. Every open slot is a
standing pattern: a new claim on `(entity, key)` closes it.

### 1.6 Rule  [mechanism settled; content param]
```
Rule { kind: shape|expected_record|derivation|lead|anomaly|hypothesis, when (pattern over graph/entity/jurisdiction),
       then (slot to open | action to raise | hypothesis to propose | flag), confidence, source: hand|mined,
       precision_observed, enabled }
```
Examples: shape "person has ≥1 residence per covered period"; expected_record "US-IL teacher ⇒ ISBE licence
(mandatory, capability ISBE)"; derivation "spouse(x,y) ∧ lives_at(x,a,t) ⇒ open slot lives_at(y,a,t)" (a place
to look, never a fact); lead "new email ⇒ actions Gravatar, Holehe, GHunt"; anomaly "person with > 5 addresses
in 2 years"; hypothesis "`related_to{unknown}` ∧ same surname ∧ close age ⇒ propose spouse|sibling". Hand-written
first; mined (AnyBURL) once graphs are large enough; a rule may raise Actions automatically only while its
observed precision is above a floor **[param]**.

### 1.7 Justification  [settled]
```
Justification { derived_id, derived_kind: link|attribute|merge|grade|hypothesis_score|slot_status,
                supports: [{kind: claim|decision|rule|source|slot, id}], status: in|out }
```
Retracting a claim, a merge, a source tier, or a rule re-derives everything resting on it. Grades are computed,
never stored by hand. "Why?" is a walk over this table.

### 1.8 Hypothesis  [settled; two kinds first]
```
Hypothesis { question_id, kind: identity|relation|value|event|free, exclusion_group?,
             pattern (what would be true), refers_to: [link|entity|slot ids],
             predicted_if_true: [{key, capability?, diagnosticity, cost}], predicted_if_false: [...],
             evidence: [{kind: claim|link|slot(searched_absent)|source, id, polarity, diagnosticity}],
             status: open|supported|established|disproved|abandoned, score, assumptions[] }
```
Mutually exclusive hypotheses share an `exclusion_group` and attack each other; the committed set is the
grounded extension (a fixpoint). Kinds at M1: **identity** ("mention X is entity Y") and **relation**
("Robert is spouse | sibling | co-owner") — rule-generated. Next: **value** ("the wedding was in Lyon | Aix |
Nice" — refers to the competing links) and **event** ("this photo is a wedding") — LLM-proposed (door 2).
`free` later. Never "proven": *established* means the stop-rule thresholds are met.

### 1.9 Action  [settled; HOLMES state machine; is also the research log]
```
Action { question_id, line_of_enquiry, kind: fetch|search|capability|read|resolve|verify|expand|manual|consult,
         target, capability_id?, params{}, raised_by: {kind: slot|hypothesis|rule|review|human|consult, id},
         originating_source_id?, priority, score, score_parts{},
         state: for_allocation|allocated|running|resulted|filed|referred|pended|failed, pend_until?,
         result: found|partial|no_trace|not_obtainable|error, scope ("what nil means"), result_refs[], cost, tier_used,
         started_at, finished_at }
```
One line of enquiry per Action; duplicate-check before raising; reopening a filed Action = a new Action citing
it; `manual` = a task for the owner with the expected return shape; `consult` = LLM door 4. A resulted Action
*is* the research-log row.

### 1.10 DecisionLog  [settled]
```
Decision { seq, at, actor: system|human|llm, kind: scope|merge|split|refer|pend|policy|stop|kill|capability,
           subject_ref, rationale, inputs[] (justification refs), reversible_by? }
```

### 1.11 Capability  [mechanism settled; inventory open]
```
Capability { name, kind: connector|pivot|search|fetch|browser_recipe|tool|dataset|manual,
             inputs: fact_type[], outputs: fact_type[] (+ predicates it can emit), cost{usd, seconds},
             tier: L0|L1|L2|L3|L4, jurisdictions[], entity_types[], cache{key_fields[], ttl}, rate{},
             requires{key?, session?}, yield_prior{hits, runs}, enabled, source_family_id, added_by: hand|acquired, spec }
```
The **capability graph**: fact types are nodes, capabilities are edges. The enabled set at any moment is
"capabilities whose inputs exist in the graph." Sites and tools are rows.

### 1.12 Indicator table  [param; seeded]
`indicator_template(subject_type, name, predicates[], record_classes[], weight)` seeded from the 40-scenario
matrix (research 09). Questions compile against it; it is a list, not an object with a lifecycle.

That is the whole vocabulary: Investigation, Question, Source, Claim, Entity/Link/Attribute (views), Slot, Rule,
Justification, Hypothesis, Action, Decision, Capability.

---

## 2. Loops

**Ingest.** Source captured → claims (door 1; tables → one claim per row; media → `depicts` with regions) →
quote gate, domain/range, policy hook, append → mentions to resolution; hard keys harvested → match new
`(node, key)` against open slots and hypotheses → lead/anomaly rules → Actions → the producing Action resulted.

**Gap.** For each open Question and each entity in its graph: open slots ← shapes ⋈ expected-record rules ⋈
indicators (on the delta) → Actions for slots with a runnable capability; Actions for hypotheses' unchecked
predicted observations (by diagnosticity); derivation rules with missing heads → slots. **Rings** (0 = the
subject; 1 = household, employer, officers; 2 = relatives, co-directors, agents; 3 = neighbours, associates) are
*computed* as graph distance along those predicate families and enter the score as one feature (§3); there is
no gate that opens or closes a ring — an Action far from the subject runs whenever it serves an indicator or a
hypothesis, and not otherwise. Each Action logs what it serves.

**Evaluate.** On result: tag to the Action and to what it served; `found | partial (→ "what remains" Action) |
no_trace (slot ← searched_absent with scope) | error`; delta pass — collective resolution (priority queue),
`same_as` closure, temporal bounds, contested links re-marked; justification maintenance and grade recompute;
hypotheses re-scored, transitions logged, disproved → their Actions filed; if any priority moved by > θ,
re-rank now.

**Review.** Every N actions / T minutes: stale allocated → re-allocate or refer; pended past date → for
allocation; slots older than TTL on covering predicates → stale; the Question's assumptions re-checked;
contrarian pass (door 3c) on any hypothesis about to become established.

**Stop / kill.** Kill when the kill criterion holds (seed unverifiable after mandatory records). Stop when the
stop rule holds → proof argument (door 1p) → context-isolated check (door 3c) → dossier. Exhausted when
the frontier is below floor with the stop rule unmet (or the optional ceiling is hit) → report what remains.
Nothing about money or counts is ever the criterion for "done."

---

## 3. Attention  [mechanism settled; weights param]
```
score(a) = expected_gain × p_find / cost × tier_factor × ring_decay
expected_gain = indicator weight (fills an indicator slot)
              + diagnosticity (tests a hypothesis: how far the result separates its exclusion group)
              + hard-key bonus (outputs include a hard key — hardest fact first)
              + structural delta (dependents that would re-derive; bridges; low-degree-high-evidence nodes)
              + novelty (a small exploration term, learned)
p_find = rule expectedness × capability yield_prior × freshness ; cost = usd + time (+ human time for manual)
tier_factor: L0/L1 = 1 · L2 = 0.9 · L3 = policy · L4 = 0
```
**No budgets shape the search.** There are no ring caps and no per-ring allowances (v0.2 had them; removed —
a fixed percentage per ring is a knob pretending to be judgment). What keeps the graph from sprawling is the
score itself: an Action on a ring-3 neighbour has near-zero `expected_gain` unless some indicator or hypothesis
of the Question is served by it — in which case it *should* run, however far out it is. `ring_decay` is one
learned feature in the score, expressing that far-out facts usually serve the Question less, never a limit.
The only budget that exists is an **optional hard ceiling** (`Investigation.ceiling`) the owner may set — it
stops the loop, it never steers it; unset by default. What ends an investigation is the stop rule.
**Weak-key ban**: Actions raised from D/E-grade or inferred facts are capped at Low unless a hypothesis names
them. **Answer from the graph first**: every slot is checked against this graph and linked graphs before a
capability runs; a hit is `found(cached)` at zero cost.

---

## 4. Graph reasoning services  [settled]

**Gaps.** Shapes as expectations (never rejections) · partial closed-world per (entity, predicate) · interval
coverage on `covering` predicates (holes = slots with a window) · expected-record rules · derivation rules with
missing heads · structural anomalies (missing reciprocals, one-sided relations, degree outliers vs peer group,
isolated nodes, provenance asymmetry) · salient negatives.

**Propagation.** Justifications + delete-and-rederive · collective resolution (neighbourhood similarity,
priority queue to convergence; a merge invalidates a bounded set; a split reverses it) · temporal bounds
(death / dissolution / marriage dates tighten adjacent intervals; `lo > hi` = contradiction) · grades recomputed
· soft joint scoring (PSL/KGI) only where the queue oscillates [later].

**Standing patterns.** Open slots and open hypotheses, matched by index on insert.

**The toolkit** — the only way the loop's LLM calls and the analyst touch the graph; every call returns a
bounded subgraph with grades:
```
ego(entity, hops, predicates?, as_of?, min_grade?)        paths(a, b, max_len, predicates?, window?)
intersect(sub_a, sub_b, on: place|event|org|person)         fold(meta_path)   e.g. person–event–person
timeline(entity|subgraph)                                   at(entity, t)
contested(entity, predicate)  → the competing links          gaps(entity)      → open/stale slots, holes
why(edge|entity|action)       → justification chain          similar(entity, k)
```
New operators are added here as needed; nothing else reaches the graph.

---

## 5. Contradictions  [settled]
Two links that cannot both be true, or `lo > hi` after bounds propagation: both links are marked *contested*
(Disputed grade), a `value` hypothesis is raised with the exclusion group = the competing links and their
existing evidence, an Action is raised for the most diagnostic missing observation, and a Decision row is
written. Nothing is deleted; the dossier shows every side.

---

## 6. Capabilities

**Contract.** A capability receives `{inputs, question context}` and returns `{claims[], sources[],
nulls[] (with scope), links_found[], cost, tier_used}`. It never writes to the graph; `knowledge` does.

**Cache.** One `source_cache` keyed by `(capability, normalized inputs)` with the capability's TTL. A bulk
dataset (INSEE deaths, DVF, Sirene, ISBE salary file, OpenSanctions) is a `dataset` capability whose first run
is one big fetch and whose TTL is long. Re-runs never refetch fresh sources. No source is special-cased.

**Search.** SerpAPI for Google/Scholar/Lens, Exa for semantic discovery, DuckDuckGo/Brave for unstored
gap-filling (approved (c)). Results are Sources like any page.

**The browser.** One authenticated-browser capability (Playwright with the owner's own sessions — approved (e),
tier L3) with primitives `open · list · expand · screenshot · download`, and **site recipes as data**
(`instagram.likes_of_post`, `instagram.story`, `x.replies`, `facebook.event_going`, …). A new site = a new
recipe row, hand-written or LLM-proposed, tested on one example, then enabled.

**Acquisition.** Propose (door 2c: from a page, an API doc, or a failed slot) → test on one known example →
record tier/cost/yield → **enable by human click** (b) → yield learned on every run → demoted when it stops
yielding, never deleted → workspace-wide. Later: auto-enable for low tiers once the test harness is trusted.

**Media & faces** (a). *Reference matching inside our own material* — faces or objects in a photo against
`depicts` media already on nodes in this or linked graphs, local, producing an **identity hypothesis** with a
score, one non-face corroboration before any merge; embeddings never leave the machine. Allowed (L3).
*External face-search services* — **not now; later**, as its own capability tier with its own policy gate, when
we decide to do "massive facial recognition." Reverse *image* search for object/scene reuse is L0 today.

**Manual.** A `manual` capability raises a task with the expected return; the Action pends; the loop continues.

---

## 7. LLM doors  [settled]
| Door | Call | Guardrail |
|---|---|---|
| 1 read | text / PDF / media → claims (quote or region, time as written, `inferred` flag) | quote gate; domain/range; no claim without a source |
| 1b compile | goal → Question + indicators, from registry + indicator table + rules | user-visible, editable |
| 1p prose | subgraph → proof argument / dossier; every sentence cites claim ids | checked by 3c |
| 2 hypothesize | node/subgraph → competing hypotheses with *if-true and if-false* observations; 2c capability/recipe proposals | scored by the graph, not the model |
| 3 judge | ambiguous ER pair with both dossiers; 3c context-isolated verifier (sees evidence only) | middle band only |
| 4 consult | "top-k next Actions and why — add or veto?"; "explain this anomaly" | candidates enter the queue scored; a veto lowers, never deletes; rate-limited |
The LLM never asserts identity, decides absence, grades a source, scores its own hypotheses, or decides to stop.

---

## 8. Reuse  [settled]
Before any Action: check this graph and linked graphs. A photo seed first tries reference matching against
`depicts` media in linked graphs. Linked graphs never merge; their facts arrive as claims whose source is the
other investigation (tier = that graph's grade).

---

## 9. Decisions on the open items
| Item | Decision |
|---|---|
| connector contract · cache · capture · independence · PDF/tables · SERP · Question/indicators · rule authoring · scheduler · contradictions · sub-questions · door-4 guardrails · slots/justifications · grade formula · same_as as claims · subgraph API · research log · reified nodes · snapshots | §1, §2, §3, §4.4, §5, §6 — all resolved above; reified-node rules adopted from research 06; snapshot/diff unchanged, sitting on justifications |
| (a) faces | reference matching allowed; external **later, not never** |
| (b) acquired capabilities | human enables, for now |
| (c) SerpAPI + Exa | approved |
| (d) ring budgets | **removed** — no caps, no per-ring allowances; ring is a score feature; only an optional owner-set ceiling exists, and it stops, never steers (§3) |
| (e) browser with own sessions | yes, default |

Still to discuss (the maintainer: "this will need some work"): walk each section against the simplicity rules once
more together; anything that still reads as a special case gets folded.

---

## 10. Module boundaries
| Package | Owns | A change looks like |
|---|---|---|
| `core` | registry, claim model, policy hook, ids, config | a YAML row |
| `knowledge` | sources, claims, entities/links/attributes, slots, rules, justifications, grades, same_as, hypotheses (storage), snapshots, the toolkit | a rule row; one grade function |
| `plan` | questions, actions, scheduler, review, stop/kill, decisions | an indicator row; a weight; a hypothesis kind |
| `acquire` | capability registry, cache, fetch/search/connectors, browser + recipes, datasets, manual tasks | a capability row; a recipe |
| `llm` | the doors as interfaces; prompt versions; model routing | a prompt or model swap |
Connectors never write to the graph; the LLM never touches it except through the toolkit; nothing derived is
edited by hand.

## 11. Effect on the plan
M0 stands. M1 = the reasoning substrate (claims v2, registry v2, sources with capture and families, slots,
rules, justifications, grades as views, same_as as claims + identity hypotheses, decisions, the toolkit, the
resolver as one Action type). M2 = the loop (Question, Actions, scheduler, review, stop) + capability registry +
the first ~15 capabilities. M3 = photos/faces (reference matching) + browser recipes + acquisition.
`BUILD_PLAN.md` is rewritten once this is agreed.
