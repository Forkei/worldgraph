# Research 11 — Making the graph reason: gaps, propagation, hypotheses, attention

*Research agent report, 2026-08-30. Question (the maintainer, verbatim): "figuring out what info the graph is missing, to notice, to go look for, to keep an eye out for; updating other nodes and links based on new info even if not directly connected — that's graph theory." All citations verified by direct fetch except a handful of classic references (Doyle 1979, de Kleer 1986, Forgy 1982, Bhattacharya & Getoor 2007, Sarawagi & Bhamidipaty 2002, Gupta–Mumick–Subrahmanian 1993, Heuer 1999) cited from standard bibliography.*

## 1. Knowing what is missing (negative space)

### 1.1 Completeness is a first-class assertion, not an absence
The open-world assumption says "missing ≠ false" — which is what makes gap detection hard: the graph cannot distinguish "we never looked" from "it does not exist". The answer is to **add metadata that locally closes the world**. Survey: Razniewski, Arnaout, Ghosh & Suchanek, [*Completeness, Recall, and Negation in Open-World Knowledge Bases*](https://arxiv.org/abs/2305.05403) (ACM CSUR 2024): statistical completeness estimation, recall statements, **cardinality assertions** ("X has 3 children"), **explicit negative statements**. Four devices to copy:
- **Partial Closed-World Assumption (PCA)** (Galárraga et al., [AMIE](https://github.com/dig-team/amie)): *if the KB knows at least one object for (subject, predicate), assume it knows all of them*. A person with zero `employer` edges is *open*; one with two dated employers is *locally closed* for the covered periods. The single most useful heuristic for an investigation graph.
- **"No value" and "unknown value" snaks** ([Wikidata Help:Statements](https://www.wikidata.org/wiki/Help:Statements)): "Elizabeth I has *no value* for child" is a positive claim about absence, with references. Copy verbatim: a slot is `unset` · `no-value (source, date)` · `unknown (source, date)` · `valued`.
- **Expected completeness** ([P2429](https://www.wikidata.org/wiki/Property:P2429)): `always incomplete` / `eventually complete` / `is complete` / … — metadata about predicates; we want it per (entity type × predicate × jurisdiction).
- **Salient negative statements** (Arnaout, Razniewski, Weikum, Pan, [*Negative Statements Considered Useful*](https://arxiv.org/abs/2001.04425), JoWS 2021): if 95% of comparable entities have property p and this one doesn't, the absence is *notable*. Peer-group expectation = "what should be here".

### 1.2 Shapes as expectations, not validators
[SHACL](https://www.w3.org/TR/shacl/): `sh:minCount`, qualified shapes, **severities** `sh:Info` / `sh:Warning` / `sh:Violation`, structured validation reports naming focus node, path, constraint. Run shapes at Warning/Info severity as *expectations*; every non-conforming result is a **gap task**, not an error. Wikidata does this two ways: [property constraints](https://www.wikidata.org/wiki/Help:Property_constraints_portal) (item-requires-statement, inverse, symmetric, **contemporary**, mandatory-qualifier, citation-needed, single-value — "hints, not firm restrictions", with a bot compiling violation reports) and [ShEx EntitySchemas](https://www.wikidata.org/wiki/Wikidata:WikiProject_Schemas) ("formally described expectations"). Steal outright: `item-requires-statement` (company with officers should have registered address), `inverse`/`symmetric` (missing reciprocals), `contemporary` (related entities must have overlapping lifetimes — free temporal consistency), `citation-needed` (evidence-grade floor per predicate).

### 1.3 Mined rules as expectation generators
Shapes encode what the schema author knew; rule mining learns what the *data* says. [AMIE](https://github.com/dig-team/amie) mines Horn rules (`wasBornIn(x,y) ∧ isLocatedIn(y,z) ⇒ hasNationality(x,z)`) scored by head coverage and PCA confidence. [AnyBURL](https://web.informatik.uni-mannheim.de/AnyBURL/) (Meilicke et al., IJCAI 2019; VLDBJ 2023) — anytime bottom-up path sampling; seconds to minutes on mid-size graphs; human-readable rules with confidences; application yields ranked candidate objects per (subject, predicate). **The use here is not KG completion; it is prediction-as-collection-task**: a fired rule body with a missing head becomes `GapTask{subject, predicate, candidate_objects, rule_id, confidence}`. `spouse(x,y) ∧ lives_at(x,a,[t1,t2]) ⇒ lives_at(y,a,[t1,t2])` *tells the crawler where to look* (property records for y at a in that window), with the rule's confidence as the task's prior. Mine two classes: **structural** (co-officer ⇒ co-address) and **record-existence** (`type=company ∧ jurisdiction=FR ⇒ has_sirene_id`) — the mined complement to hand-written expected-record lists.

### 1.4 Temporal gaps and structural anomalies
- **Interval coverage.** For predicates declared `covering` (residence, employment, ownership, directorship), the union of intervals should cover the entity's lifetime. Holes = gap tasks with an explicit window. Consistency = [Allen's interval algebra](https://en.wikipedia.org/wiki/Allen%27s_interval_algebra) (13 relations; the general CSP is NP-complete, ORD-Horn is tractable); in practice you need **bounds propagation on endpoints** (§2.5), which is linear.
- **Structural signals** (each a cheap SQL query, each a gap-task generator): missing reciprocal/inverse edges · one-sided relations (A has household, spouse B has none in the same window) · degree outliers per (type, predicate) vs the peer group · isolated nodes (only `mentioned_in` edges → ER task or under-collected) · **provenance asymmetry** (an edge asserted only by a self-published bio where peers have registry confirmation — an *evidence* gap, not a *fact* gap).

### 1.5 The expected-record list
Genealogists formalized this: the [Genealogical Proof Standard](https://bcgcertification.org/ethics-standards/) requires "reasonably exhaustive research" — a per-(place × period × person-type) checklist of record classes that *should* exist, and a **research log** recording negative searches with source, date, terms. The OSINT analogue: a French company should be in Sirene/RNE and BODACC; a US-licensed teacher has a state licence record; a domain has an RDAP registrant.

`expected_record(entity_type, jurisdiction, period, record_class, source, expectedness ∈ {mandatory, usual, possible}, how_to_query)` joined against entities → `RecordSlot` rows: `unsearched | searched_absent(source, date, query) | found(document_id)`. **`searched_absent` for a `mandatory` record is itself evidence** (the company isn't where it says; the person isn't licensed) and feeds hypotheses. Record the search, not just the outcome.

## 2. Propagating new information to non-adjacent nodes

### 2.1 Truth maintenance: the dependency layer
Doyle's JTMS ([1979](https://dspace.mit.edu/handle/1721.1/6800)): every derived belief carries a **justification** (the beliefs it was derived from) and a status IN/OUT; retract a premise → everything whose only justifications depended on it flips OUT; dependency-directed backtracking finds which assumptions caused a contradiction. De Kleer's ATMS (1986): each node carries a **label** = minimal sets of assumptions under which it holds; contradictions become **nogoods**. Our graph is built from extractions + resolution decisions + rules — each is an *assumption*. An ATMS-style label on every derived edge ("this `controls` edge holds if same_as(A,A') ∧ doc_17 reliable ∧ rule_R12") is what lets a retracted merge or discredited document ripple correctly. Needed: the **justification graph stored as data** and a delete-and-rederive procedure.

### 2.2 Incremental materialization: the engine
Datalog gives propagation semantics for free: semi-naive evaluation processes only the delta; stratified negation expresses "expected but absent"; incremental maintenance under deletion is **DRed** (Gupta, Mumick, Subrahmanian, SIGMOD 1993): over-delete everything derivable from the retracted fact, re-derive what has alternative support — the JTMS in database clothing. Engines: [Soufflé](https://souffle-lang.github.io/) (compiled, **proof trees** for "why is this fact here?"), [CozoDB](https://docs.cozodb.org/en/latest/) (embeddable, transactional Datalog with recursion, **time travel**, vector/MinHash indices — a very good fit), DDlog, [Materialize](https://materialize.com/docs/) (SQL over differential dataflow, `SUBSCRIBE`). Rete (Forgy 1982): alpha/beta memories hold partial matches so asserting/retracting one fact touches only the joins it participates in — "standing pattern fires on arrival".

### 2.3 Probabilistic propagation: PSL and Knowledge Graph Identification
When the ripple is *soft* (a merge is 0.8 likely; an extraction 0.6 reliable), use joint inference. Probabilistic Soft Logic ([Bach, Broecheler, Huang, Getoor, JMLR 2017](https://jmlr.org/papers/v18/15-631.html)): truth values in [0,1], hinge-loss MRFs, MAP inference is *convex*, scales to millions of ground rules. **[Knowledge Graph Identification](https://linqs.org/assets/resources/pujara-iswc13.pdf)** (Pujara, Miao, Getoor, Cohen, ISWC 2013) does entity resolution, ontology constraints, and truth inference *jointly* over noisy extractions:
```
w1: SameEntity(A,B) ∧ Rel(A,R,C) ⇒ Rel(B,R,C)
w2: Extracted(src,A,R,C) ∧ Reliable(src) ⇒ Rel(A,R,C)
w3: Rel(A,R,C) ∧ Domain(R,T) ⇒ Type(A,T)
w4: Mutex(T1,T2) ∧ Type(A,T1) ⇒ ¬Type(A,T2)
```
A new hard identity key becomes `SameEntity` at 1.0; inference re-scores every atom in the connected component — the same_as chain, every relation that transferred across it, every type that became contradictory. **That is "update other nodes even if not directly connected", and it is purely structural.**

### 2.4 Collective ER as scheduled propagation
Bhattacharya & Getoor ([TKDD 2007](https://dl.acm.org/doi/10.1145/1217299.1217304)): similarity = α·attribute + (1−α)·neighbourhood (multiset of already-resolved cluster ids adjacent to each reference); candidate merges in a **priority queue**; after each merge, only entries whose neighbourhood contains the merged clusters are recomputed. Consequences: (i) a merge is an *event* that invalidates a bounded set of scores — keep the inverse index (cluster → dependent pairs); (ii) a split must reverse the same set — so merge decisions are records with justifications, never destructive updates.

### 2.5 Temporal and evidence propagation
**Temporal bounds**: a death date `d` asserts `end ≤ d` on every interval anchored on that person (residence, employment, directorship, marriage); company dissolution bounds all employments; a marriage date bounds spouse-derived edges. Every interval edge carries `(start_lo, start_hi, end_lo, end_hi)`; anchor events tighten adjacent bounds; `lo > hi` = contradiction handed to the TMS (which document asserted the impossible date?). Wikidata's `contemporary` constraint is the one-hop version.
**Evidence grades should be computed, not stored**: grade(e) = f(grades of its justifications). A new primary source raises an edge and, through the justification graph, everything derived from it; a contradiction demotes dependents. Stored: per-source reliability, per-document grade. Everything else is a view over the justification DAG, recomputed on the delta.

### 2.6 "Keep an eye out for": standing queries
Every pending thing — an expected-record slot, a hypothesis's predicted evidence, a rule body with a missing head, an analyst's watch — is a *standing pattern*. Mechanisms: Postgres [`CREATE TRIGGER … REFERENCING NEW TABLE`](https://www.postgresql.org/docs/current/sql-createtrigger.html) + [`NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html) (delivered on commit, in order) · Neo4j APOC triggers · Datomic `tx-report-queue` (the cleanest "react to new datoms" primitive) · Materialize `SUBSCRIBE` · stream reasoning (C-SPARQL — heavier than needed). **Opinionated**: a standing pattern is a row in a `watch` table with a normalized pattern (type, predicate, optional node, time window, value constraint); arrival of a fact does an index lookup on watches, not a re-evaluation of everything; only multi-hop patterns go to the Datalog layer.

## 3. Hypotheses as first-class graph objects
Heuer's [Analysis of Competing Hypotheses](https://en.wikipedia.org/wiki/Analysis_of_competing_hypotheses): matrix of evidence × hypotheses, cells consistent/inconsistent/n-a; work *across* rows to find **diagnostic** evidence; score hypotheses by inconsistencies, not confirmations. The graph representation:
- `Hypothesis` node with `claim` (a pattern: `same_as(A,B)`; `funds(X,Y) via Z`), `status`, `prior`.
- `supports` / `refutes` edges from `Evidence` — documents, edges, and **absences** (a `searched_absent` slot is legitimate refuting evidence for "P lives in Q").
- `attacks` between mutually exclusive hypotheses = [Dung's argumentation framework](https://en.wikipedia.org/wiki/Argumentation_framework) (1995); the **grounded extension** (the hypotheses you can currently commit to) is a fixpoint computable as a recursive CTE.
- Optional numeric layer: Hepler, Dawid & Leucari, [*Object-oriented graphical representations of complex patterns of evidence*](https://academic.oup.com/lpr/article/6/1-4/275/927717) (2007) — Wigmore charts + object-oriented Bayesian networks with reusable "idioms" (witness credibility, identity matching, document authenticity). Schum's *Evidential Foundations of Probabilistic Reasoning* (1994) is the theory.

Each new fact touching a hypothesis's pattern re-scores it (a watch). The **abductive loop** turns hypotheses into collection: if `same_as(A,B)`, then A's birth year should match B's, addresses should overlap in time, no document should name both as distinct parties. Each prediction is an `EvidenceTask` with a **diagnosticity** score (how much the outcome separates H from rivals). Highest diagnosticity-per-cost first. **Record the expected value before you look**, so the outcome grades as confirming / disconfirming / uninformative.

## 4. Attention allocation
- **Expected marginal gain**: priority = P(find) × Δ(what changes if found). P(find) from `expectedness` + the source's historical hit-rate; Δ computed structurally — hypotheses touched, derived edges that would re-score, gap tasks that would close.
- **Active learning for ER** (Sarawagi & Bhamidipaty, KDD 2002; Meduri et al., SIGMOD 2020): uncertainty near the decision boundary is where an LLM/human buys the most. Rule: ask about pairs in the ambiguous band **and** with high downstream Δ (many dependents), never about clear cases.
- **Active KG completion** (ActiveLink, WWW 2019): uncertainty alone over-samples redundant regions; diversify by community.
- **Centrality-guided expansion**: articulation points/bridges are where one confirmed edge changes the most; **low-degree-high-evidence** nodes are under-collected and reliable (good expansion seeds); **high-degree-low-evidence** nodes (a hub built from one scraped bio) are where a *refuting* search is most valuable.
- **Meta-path relevance** to the goal keeps explore/exploit honest; exploration is budgeted, relevance is goal-conditioned.
Practically: one `task` table, priority = `diagnosticity × P(find) × structural_delta / cost`, recomputed on the delta. The rationale columns *are* "why did you look there?".

## 5. Recommendation: architecture
**Postgres is the system of record and does 80% of the reasoning; a Datalog engine does recursive/soft inference on the delta; the LLM reads text and answers ambiguity questions the graph poses to it.** Everything derived is a view or a record with a justification; nothing derived is mutated by hand.

### 5.1 Data model
```
entity(id, type, created_from_doc)
edge(id, src, pred, dst, valid tstzrange, bounds jsonb, asserted_by doc_id, grade)        -- append-only
slot(entity_id, pred | record_class, status: unset|no_value|unknown|found|searched_absent, source, searched_at, query, doc_id)
expected_record(entity_type, jurisdiction, period, record_class, expectedness, how_to_query)
rule(id, body, head, source: shape|amie|anyburl|hand, pca_conf, head_cov)
justification(derived_id, kind: edge|merge|grade|hypothesis_score, supports jsonb[assumption ids])
same_as(a, b, decision: merge|split|undecided, score, justification_id)                     -- records, never deletes
hypothesis(id, claim jsonb, status, score); hyp_evidence(hyp_id, evidence_id, polarity, diagnosticity); hyp_attack(h1, h2)
watch(id, pattern jsonb, owner: slot|hypothesis|rule|analyst)
task(id, kind: gap|evidence|resolve|read, target, rationale jsonb, priority, status)
```

### 5.2 Layers
| Concern | Mechanism | Runs in |
|---|---|---|
| Schema expectations (shapes, cardinalities, inverse/symmetric/contemporary) | SQL views over entity/edge → `slot` rows | Postgres |
| Expected-record lists | `expected_record ⋈ entity` → `slot` | Postgres |
| Interval coverage holes | gaps-and-islands per (entity, pred) | Postgres |
| Degree / peer-group outliers | window functions per (type, pred) | Postgres |
| Reciprocal / one-sided checks | anti-joins | Postgres |
| Rule mining | AnyBURL nightly → `rule` | external batch |
| Rule application (predict missing heads) | ≤ 3-hop joins | Postgres; Datalog for recursive rules |
| same_as closure, ownership/control closure, temporal bounds | recursive rules | **Datalog** (CozoDB embedded); recursive CTEs work for closure but not DRed retraction |
| Justification graph, DRed | recursive CTE for dependents; re-derive via rules | Postgres walk + Datalog re-derivation |
| Evidence grade | view `grade(e) = f(grade(justifications))` | Postgres (recursive CTE, CYCLE) |
| Soft joint scoring (ER + constraints + reliability) | PSL / KGI | PSL batch on the affected component; optional at first — start with the priority-queue ER |
| Hypothesis acceptance (grounded extension) | fixpoint over attacks + evidence | Postgres recursive CTE |
| Standing patterns | `watch` lookup from AFTER INSERT trigger; NOTIFY on commit | Postgres |
| Task priority | view over `task` with structural Δ from justification fan-out | Postgres |
| Reading documents; judging ambiguous ER pairs; proposing hypotheses from a document | LLM | only via `task.kind ∈ {read, resolve}` |

### 5.3 The event loop
1. A document is read (LLM) → candidate edges with `asserted_by`, candidate mentions.
2. `AFTER INSERT` on edge: look up watches keyed on (node, pred) → close slots, re-score hypotheses, mark rule heads satisfied; enqueue affected nodes.
3. Delta pass (Datalog): recompute same_as closure and derived edges for the touched component; tighten interval bounds; emit contradictions as nogoods.
4. Justification maintenance: for retractions/splits, walk dependents, mark OUT, re-derive; recompute grades.
5. Expectation pass: regenerate slots and gap tasks for touched nodes; apply rules whose bodies now match.
6. Hypothesis pass: recompute grounded extension; regenerate evidence tasks from predicted observations, with diagnosticity.
7. Priority view re-ranks tasks; next `read`/`resolve` goes to the LLM, next `gap`/`evidence` to a collector.

### 5.4 Inspectability
"Why did you look there?" is a join, never prose: `task → rationale → (slot | rule | hypothesis) → justification → edges/docs`. Every negative result is a row (`searched_absent` with query and date) so "we looked in Sirene on 2026-08-12 with these terms and found nothing" is a fact the graph reasons from — including as evidence *against* a hypothesis.

### 5.5 What to build first
1. `slot` + `expected_record` + shape views + interval-gap query — "what's missing" for every entity, pure Postgres.
2. Append-only `same_as` + `justification` + the recursive-CTE dependents walk — retraction is safe before any soft inference.
3. `watch` + trigger + NOTIFY — standing patterns fire on arrival.
4. AnyBURL nightly → rules → gap tasks with confidence.
5. Hypotheses with support/refute/attack + grounded-extension view; evidence tasks from predicted observations.
6. Only then CozoDB for recursive derivation with retraction, and PSL/KGI for joint scoring where priority-queue ER oscillates.

**The LLM sits at exactly two doors**: text → candidate facts (with the document as justification), and "these two nodes have similarity 0.55 and 14 dependents — same person?" The graph decides everything else, and can show its work.
