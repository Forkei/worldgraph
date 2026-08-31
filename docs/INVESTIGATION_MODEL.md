# The Investigation Model — the contract for research, planning, and knowledge

*v0.3 · 2026-08-31. Rewritten after the maintainer's full review of the built system (stages 1–7, 2026-08-30/31).
v0.2's pipeline-with-doors becomes **mission agents around a shared evidence board**. The board and its
bookkeeping survive; the crutches die: regex text conversion, the quote gate, the source classifier, the
evidence-prior table, source families, text-similarity origins, hand-tuned resolution weights, blind chunking.
**[settled]** = agreed with the maintainer; **[param]** = tuned from runs; **ASK** = needs the maintainer.*

---

## 0. The whole thing in one paragraph

An investigation is a **Question** over a shared **evidence board** — the graph of sources, claims, entities,
links, notes, slots, hypotheses, justifications. A **dispatcher** cuts the Question into **missions** — small,
coherent pieces of the puzzle — and launches **agents** on them. An agent is a small investigator: it reads
whole pages, navigates on its own judgment, and interacts with the board — contributing testimony, suggesting
strings (hypotheses), challenging what looks wrong, leaving notes, proposing follow-up missions. The board's
**bookkeeping** is deterministic and reproducible: everything derived carries its justification and re-derives
from testimony + decisions; identity merges only on a shared identifier, a recorded judgment that read both
files, or the owner; reliability is a walk to the publisher entity, never a table. A **proposer** (heuristic
now, a learned graph model later) ranks what deserves attention; an **LLM verifies** what the proposer puts in
front of it; the owner decides anything, reversibly. Nothing about a subject type, a site, or a tool is
hardcoded: types, predicates, rules, capabilities, and expectations are data — and grow from casework.

## 0.1 Simplicity rules (apply to every piece)
1. **One representation for uncertainty: more edges.** Competing facts are several links, each with its own
   evidence. No `alternatives[]`, no preferred-value field.
2. **Anything pending is a slot or a hypothesis.** Open slots and open hypotheses are the standing patterns;
   new facts are matched against them on arrival.
3. **Anything expected is a rule — and rules are cached learning, not authored coverage.** A tiny hand-seeded
   core of universal reflexes; everything else proposed by agents from casework and saved for reuse.
4. **The research log is the Actions.** An agent's steps are Action rows; a resulted Action *is* the log entry.
5. **Media is a source; "depicts" is a claim.** The "quote" of a photo claim is a region, of audio a time range.
6. **Everything derived carries its justification and is recomputed, never edited.**
7. **Agents touch the board only through the toolkit** — bounded reads, evidence-carrying writes (§4.4).
8. **Nothing merges silently on a score.** Identity changes need an identifier, a judgment, or the owner (§5).

---

## 1. The board (objects)

### 1.1 Investigation · Question  [settled]
```
Investigation { title, seed{kind, values{}, media[]}, policy, ceiling?{usd|actions|minutes} (optional hard stop, unset by default),
                mode: auto|approve, linked_investigations[], status }
Question      { investigation_id, parent_question_id?, subject_ref, sought: text,
                indicators: [{name, predicates[], record_classes[], weight}],
                kill_criterion, stop_rule{min_independent_on[], mandatory_searched, stability_actions, max_open_contradictions},
                status: open|answered|killed|exhausted }
```
Compiled from free text (an agent job, user-visible and editable) against the registry, the indicator
templates and the rules. Sub-questions are raised by hypotheses and by agents.

### 1.2 Source  [settled; v0.3 rewrite]
```
Source { locator, capability_id, kind: html|pdf|image|audio|video|api|dataset|manual, fetched_at,
         content_hash, blob_key (raw), snapshot_key (rendered HTML / WARC / screenshot — the audit copy),
         text (canonical MARKDOWN — exactly what the reading agent saw), link_table [{n, anchor, url}],
         title, published_at?, lang, status, retracted_at?, retracted_reason? }
```
- **Markdown is the canonical text.** No markdown→plain-text conversion, no separate "reader-visible" form.
  Inline links are rewritten to footnote refs `[anchor][n]`; the numbered `link_table` is stored with the
  source — compact for reading, complete for navigation. The rendered snapshot is kept as the audit copy only.
- **PDFs**: transcribed to markdown by the reader model natively (layout, tables, scans); the transcription is
  the canonical text; the PDF blob is the audit copy. Huge documents are read section-wise by the agent
  (skeleton first, then chosen sections, with carried notes) — the agent turns pages; nothing slices blindly.
- **`published_at` is opportunistic**: metadata when present, date-in-URL, Wayback first-capture as an upper
  bound. Never guessed; null otherwise.
- **No classifier, no doc-kind, no tiers, no source families.** Who publishes a page, what they are, and who a
  fact is attributed to are **claims** the reading agent emits about the source, like any other claims
  (`page —published_by→ FFA`; `FFA —is→ France's athletics federation`; `fact —attributed_to→ Reuters`).
  Reliability is derived from that structure (§1.4); a config table about websites never exists again.
- **Failure is loud and durable**: the attempt trace stays on the source; a failed fetch opens
  `not_obtainable(reason)` so it appears in gaps; retry/escalation (other method, archive, owner-session
  browser) is Action state, not a silent drop.

### 1.3 Claim  [settled; v0.3: gate removed]
Relation claims and attribute claims (M1_DESIGN §2): typed against the registry, EDTF time as written,
`asserted_at`, `inferred` flag, `derivation` (age → date-of-birth range, computed deterministically — the
model never does arithmetic), qualifiers. **The quote is provenance, not a gate**: it is stored and shown
(`why` walks to it) but no longer verified or rejected — honesty is enforced by corroboration, challenges, and
grading, not by string matching (removed 2026-08-31; the gate was finicky and its normalizer brittle). The
quote's span is a character range in markdown, a bounding box in an image, a time range in audio/video.
Mentions carry the surface form and **hints** (title, employer, handles, urls seen nearby) — the raw material
for identity keys.

### 1.4 Entity · Link · Attribute · Note  [settled; v0.3: reliability ladder]
Views over claims + decisions, rebuilt never edited, with **persistent entity ids** (a merged bundle keeps the
id it was born with across rebuilds). A link aggregates the claims for one `(src, predicate, dst)`; an
attribute is a note *on* a node (occupation, date_of_birth); free-form notes are `free` hypotheses pinned to
anything. Qualifiers use **subsumption**: "Partner" under an existing "General Partner" is the same fact worded
weaker — recorded as corroboration, not conflict; conflict is reserved for actual disagreement.

**Grades are two raw facts and a name.**
- **Reliability = the publisher ladder**, derived by walking the graph to the source's publisher entity and
  asking its relationship to the fact: **originator of the record** (the FFA about licences) → **the subject
  about itself** (ACORN's team page about ACORN) → **independent witness/reporter** → **secondhand aggregator**
  → **unknown/anonymous**. The ladder is the definition of the A–E scale, not a judgment about any site.
  Cold start is honest: an unknown publisher grades low and climbs as the graph learns who they are — and the
  graph learns a publisher once, forever.
- **Credibility = independent origins**, where independence is provenance, not text shape: same page = one
  origin; same publisher entity = one origin; a fact **attributed** to X has origin X, wherever it was read
  ("according to Reuters" re-roots to Reuters); a page citing its source for a fact is derivative. No shingles,
  no similarity thresholds, no passage windows (removed 2026-08-31).
- The label (Established · Corroborated · Single-source · Unverified · Disputed) is display vocabulary for a
  combination of the two raw facts; the raw numbers are always shown beside it, and nothing downstream decides
  off the label.

### 1.5 Slot  [settled]
```
Slot { entity_id | question_id, key (predicate | record_class | indicator), window?,
       status: unset|found|searched_absent|unknown|not_obtainable|not_applicable,
       source_id?, action_id?, searched_at?, scope ("what nil means"), reason?, raised_by_rule }
```
Absence is an object; `searched_absent` on a mandatory record is evidence; `not_obtainable` carries the reason
and what would obtain it. Every open slot is a standing pattern — and a **link to something that does not
exist yet**: a pin waiting for a note.

### 1.6 Rule  [mechanism settled; content grows from casework]
```
Rule { kind: shape|expected_record|derivation|lead|anomaly|hypothesis, when, then, confidence,
       source: hand|agent|mined, proposed_in (investigation), precision_observed, enabled }
```
A tiny hand core of universal reflexes (a person has a birth date; an employment has an end; a company has
officers). Everything scenario-shaped — "French teenage athlete ⇒ FFA licence, club roster, race results" — is
**proposed by agents during missions** and saved as rows, so the next case of that shape gets it for free.
Rules are a cache of learned expectations, not a config file. Mined rules (AnyBURL) once graphs are large.

### 1.7 Justification  [settled]
```
Justification { derived_id, derived_kind: link|attribute|merge|grade|hypothesis_score|slot_status,
                supports: [{kind: claim|decision|rule|source|slot, id}], status: in|out }
```
Retraction re-derives everything resting on the retracted thing; "why?" is a walk over this table, ending at
quotes, pages, and publishers. Justifications also define the **blast radius** for incremental rebuild (§2).

### 1.8 Hypothesis  [settled]
```
Hypothesis { question_id, kind: identity|relation|value|event|free, exclusion_group?,
             pattern, refers_to[], predicted_if_true[], predicted_if_false[],
             evidence: [{kind, id, polarity, diagnosticity}], status, score, assumptions[], raised_by }
```
The strings and sticky notes on the board. Raised by rules, by the proposer, and **by agents** (with their
evidence attached). `free` = an open note pinned to anything. Never "proven": *established* means the
stop-rule thresholds are met. A **challenge** is a hypothesis targeting an existing link, merge, or source
("this claim misreads its quote", "this merge is wrong — look at the vintages", "this 'registry' is a scraper"):
raising one marks the target contested immediately; the machinery or the owner settles it.

### 1.9 Action  [settled; HOLMES state machine; is also the research log]
```
Action { question_id, mission_id?, line_of_enquiry, kind: fetch|search|capability|read|resolve|verify|expand|manual|consult,
         target, capability_id?, params{}, raised_by: {kind: slot|hypothesis|rule|review|human|agent, id},
         priority, score, score_parts{},
         state: for_allocation|allocated|running|resulted|filed|referred|pended|failed, pend_until?,
         result: found|partial|no_trace|not_obtainable|error, scope, result_refs[], cost, tier_used,
         started_at, finished_at }
```
Every agent step is an Action row, so the research log is complete even though the agent chose the steps.

### 1.10 Mission  [new in v0.3; settled]
```
Mission { question_id, objective (one sentence), scope { entities[], slots[], hypotheses[] },
          frontier [urls | queries], constraints { pages, model }, state: proposed|running|done|extended,
          verdict: found|partial|no_trace (with scope), trail (action ids), proposals (follow-up missions),
          launched_by: dispatcher|agent|human }
```
A mission is a **line of enquiry made real** — a small, coherent piece of the puzzle one agent can hold.
The agent gets: the objective · a **digest** of the relevant subgraph · the open slots/hypotheses it should
close · a starting frontier · the toolkit. Inside the mission it navigates freely with its own context.
It ends when the objective is met, the frontier is exhausted, or the agent asks for more room — an extension
request goes back to the dispatcher as a proposed mission, scored against every other. Missions run in
parallel; the sources table is the shared "already visited" ledger; scopes are declared so two agents don't
walk the same street. Decomposition is recursive: agents propose sub-missions they shouldn't absorb.

### 1.11 DecisionLog  [settled]
```
Decision { seq, at, actor: system|human|llm, kind: scope|merge|split|refer|pend|policy|stop|kill|capability,
           subject_ref, rationale, inputs[] (justification refs), reversible_by? }
```
Also the label stream for learning (§6): every recorded merge/split verdict is a training example.

### 1.12 Capability  [mechanism settled; inventory open]
```
Capability { name, kind: connector|pivot|search|fetch|browser_recipe|tool|dataset|manual,
             inputs: fact_type[], outputs: fact_type[], cost{usd, seconds},
             tier: L0|L1|L2|L3|L4, jurisdictions[], entity_types[], cache{key_fields[], ttl}, rate{},
             requires{key?, session?}, enabled, added_by: hand|acquired, spec }
```
Fetching learns **per-domain strategy** (which method worked last — plain HTTP for most of the web, the
headless service or the owner-session browser for walled domains) so speed is the default and escalation the
exception. Fetches of distinct URLs run concurrently; rate limits apply per service.

### 1.13 Indicator table  [param; seeded]
`indicator_template(subject_type, name, predicates[], record_classes[], weight)` seeded from research 09;
grown the same way rules are — agents propose, cases confirm.

---

## 2. Loops

**Ingest** (what happens to an agent's returns): sources + claims land → mentions to resolution →
hard keys matched against open slots and hypotheses → qualifier subsumption → lead/anomaly rules →
**incremental re-derive**: the justification chains name exactly what a new claim touches (one link
re-aggregated and regraded, one entity's rules re-run, one pair re-triaged) — milliseconds per contribution,
so many agents can work one board. The **full rebuild survives as the auditor**: board state is deterministic
from testimony + decisions, so incremental and full must be identical; the diff is run periodically and any
mismatch is a bug that announces itself.

**Dispatch (gap → missions).** For each open Question: open slots ← shapes ⋈ expected-record rules ⋈
indicators; unchecked predicted observations of hypotheses (by diagnosticity); challenges awaiting
investigation. The dispatcher bundles them into coherent missions, checks the board first (answer-from-graph:
a hit is `found(cached)` at zero cost), scores them (§3), and launches the top ones in parallel. **Rings**
(graph distance along household/employer/officer/relative predicates) are one score feature, never a gate.

**Evaluate.** On a mission's return: verdicts tagged to what they served (`found | partial → follow-up |
no_trace → searched_absent with scope | error`); re-triage touched pairs; temporal bounds propagate
(`lo > hi` = contradiction → both links contested, a value hypothesis raised); grades recompute along
justification chains; hypotheses re-scored; agents' proposals enter the dispatcher's queue.

**Review.** Every N actions / T minutes: stale allocated → re-allocate or refer; pended past date → back in
the queue; stale slots on covering predicates; assumptions re-checked; contrarian pass (a context-isolated
verifier that sees only the evidence) on any hypothesis about to become established.

**Stop / kill.** Kill when the kill criterion holds. Stop when the stop rule holds → proof argument (every
sentence cites claim ids) → context-isolated check → dossier. Exhausted when the frontier is below floor with
the stop rule unmet (or the optional owner ceiling is hit) → report what remains. Nothing about money or
counts is ever the criterion for "done."

---

## 3. Attention  [mechanism settled; weights are triage, not truth]
```
score(mission) = expected_gain × p_find / cost × tier_factor × ring_decay
expected_gain  = indicator weight + diagnosticity (how far the result separates an exclusion group)
               + hard-key bonus + structural delta + novelty
p_find         = rule expectedness × capability/domain yield × freshness ; cost = usd + time (+ human time)
tier_factor    : L0/L1 = 1 · L2 = 0.9 · L3 = policy · L4 = 0
```
The score **ranks what gets attention — it never decides truth** (that is §5's line). A bad rank costs a
fraction of a cent; that is why sloppy weights are tolerable here and nowhere else, and why this is the
natural first seat for the learned model (§6). **No budgets shape the search**: no ring caps, no allowances;
an Action far from the subject runs whenever it serves an indicator or a hypothesis. The optional owner
ceiling stops the loop, never steers it. **Weak-key ban**: Actions raised from low-grade or inferred facts are
capped at Low unless a hypothesis names them. **Answer from the graph first**, always.

---

## 4. Graph reasoning services  [settled]

**Gaps.** Shapes as expectations · partial closed-world per (entity, predicate) · interval coverage on
`covering` predicates · expected-record rules · derivation rules with missing heads · structural anomalies ·
salient negatives. Ranking which absence *matters* is the dispatcher's score now, the learned model's instinct
later (link prediction = machine-generated slots; "this absence is weird for this kind of node").

**Propagation.** Justifications + incremental re-derive (full rebuild as auditor) · collective resolution ·
temporal bounds · grade recompute · soft joint scoring only where the queue oscillates [later].

**Standing patterns.** Open slots and open hypotheses, matched by index on insert.

### 4.4 The toolkit — the agents' hands  [settled]
The only way anything LLM touches the board. **Reads** return bounded, graded subgraphs:
```
ego(entity, hops, predicates?, as_of?, min_grade?)     paths(a, b, max_len, predicates?, window?)
intersect(sub_a, sub_b, on)                            fold(meta_path)
timeline(entity|subgraph)                              at(entity, t)
contested(entity, predicate?)                          gaps(entity)
why(edge|entity|action)                                similar(entity, k)
find(name | key | text) → candidate nodes              digest(scope) → the compact text form a mission gets
```
**Writes** are evidence-carrying and land in the conjecture layer or as testimony — never directly in derived
state:
```
contribute(source, claims[])        suggest(hypothesis, evidence[])      challenge(target, reason, evidence[])
annotate(target, note)              propose_mission(objective, scope)    propose_rule(when, then)
```
What no agent can do directly: assert "same entity" as fact, delete or overwrite evidence, set a grade.
Their certainty enters as strongly-weighted evidence; the board stays derivable from evidence + decisions.

---

## 5. Identity  [settled; v0.3 rewrite — replaces score-band resolution]

**Things merge only when something real says they're the same:**
1. a **shared unique identifier** — an identifier that is one-per-entity *by design* (a licence number within
   its federation, a company registry number). Multi-valued keys (emails, handles) **match** as strong
   evidence but never *contradict* — a person has many;
2. a **recorded judgment that read both files** — the verifier (a different model family from the reader) or
   an agent, with both sides' dossiers, verdict + reason stored; "different" only on hard contradictions
   (identifiers, birth years, being in two places at once — never role, seniority, or style);
3. **the owner** — decisions beat everything, reversibly (`entity_members` is the un-merge path).

**Nothing merges silently on a score.** Everything else stays a visible open hypothesis — the honest state.

Around that line: every (page × person-name) starts as its own record — same-name persons must earn merging;
**orgs and places get the same caution** (structure and jurisdiction as context; two "Mercury Capital"s stay
apart until evidence). **The proposer** finds and ranks candidate pairs worth judging — name/key overlap,
phonetic and character-level blocking (nickname variants mostly arrive via agents' own search expansions),
temporal contradictions as negative evidence (different birth years, dead-before-active, two places at once).
The proposer is a transparent heuristic today and the learned graph model tomorrow (§6); its job is triage
order, so its errors cost cents, not identities. Structural org relations (fund series → siblings, unit →
part_of, manager LP → manages) are derived links, never merges. Contradictions after a merge (`lo > hi`)
raise challenges automatically.

---

## 6. Learning  [new in v0.3; settled direction]

The system trains on its own casework; nothing waits for a labelling project.
- **Labels accrue as a side effect**: owner decisions, verifier verdicts with reasons, reviewed gold files,
  hard-key-confirmed pairs. The decisions log is the label stream.
- **First model: learned pair-triage** — replace the hand heuristic's ranking with a model fit on accumulated
  verdicts (features already exist as `score_parts`). Truth stays with §5; the model only proposes.
- **Second: graph embeddings / GNN** — "these two subgraphs are the same person, 0.93" from structure;
  link prediction as machine-generated slots; anomaly attention. Proposals → LLM verification → decisions →
  better model: the flywheel. LLMs read and argue; the graph model holds the graph; bookkeeping stays
  deterministic between them.
- Hand-set numbers anywhere in the system are **bootstrap with a removal date**, named as such.

---

## 7. Capabilities

**Contract.** A capability receives `{inputs, question context}` and returns `{claims[], sources[], nulls[]
(with scope), links_found[], cost, tier_used}`. It never writes to the board; ingest does.

**Cache.** One `source_cache` keyed by `(capability, normalized inputs)` with TTLs; bulk datasets are
`dataset` capabilities with long TTLs. Re-runs never refetch fresh sources.

**Search.** SerpAPI (Google/Scholar/Lens), Exa (semantic), DuckDuckGo/Brave for unstored gap-filling.
Results are Sources like any page. Agents expand name variants themselves when searching.

**The browser.** Playwright with the owner's own sessions (L3), primitives `open · list · expand · screenshot
· download`, site recipes as data rows — hand-written or agent-proposed, tested on one example, then enabled.

**Acquisition.** Propose (from a page, an API doc, or a failed slot) → test on one known example → record
tier/cost → **enable by human click** → demoted when it stops yielding, never deleted → workspace-wide.

**Media & faces.** Reference matching inside our own material (local, embeddings never leave the machine,
identity hypothesis + one non-face corroboration before any merge) — allowed (L3). External face-search —
later, not never, behind its own policy gate. Reverse image search for object/scene reuse is L0.

**Manual.** A task for the owner with the expected return shape; the Action pends; the loop continues.

---

## 8. Reuse  [settled]
Before any mission: check this graph and linked graphs. Linked graphs never merge; their facts arrive as
claims whose source is the other investigation.

---

## 9. Decisions log (running)
| When | Decision |
|---|---|
| 2026-08-29/30 | v0.2 set: own graph · no reuse · private individuals in scope · grey ok, black not · no budgets steer · competing facts = multiple links · graphs link, never merge · two-axis grade, never a probability · faces later-not-never · SerpAPI+Exa approved · browser with own sessions · acquired capabilities enabled by human click |
| 2026-08-30 | no hardcoded domain lists (reliability from content, then v0.3: from publisher structure) |
| 2026-08-30 | LLM judge verdicts are evidence, never decisions (stereotype-merge lesson) |
| 2026-08-31 | **architecture: graph-driven dispatch + mission agents on one shared board** (the maintainer) |
| 2026-08-31 | markdown is canonical text; conversion layer and quote gate removed (quotes stay as provenance) |
| 2026-08-31 | classifier removed; publisher-as-entity + relationship ladder; families and shingles removed; attribution re-roots origins |
| 2026-08-31 | qualifier subsumption (weaker wording = corroboration, not conflict) |
| 2026-08-31 | identity: merge only on identifier / judgment / owner; scores are triage only; temporal contradictions as negative evidence; orgs get person-level caution; persistent entity ids |
| 2026-08-31 | rules and indicators grow from agent proposals (cache of learned expectations) |
| 2026-08-31 | incremental rebuild with full rebuild as auditor |
| 2026-08-31 | learning path: casework labels → learned triage → GNN; hand numbers are bootstrap with a removal date; `extractor_conf_raw` dropped; source-agreement learning parked for later |
| 2026-08-31 | agents read whole pages (agent-chosen section reading for monsters); registry-compiled claim schema **stays** (the one guardrail) — extraction questions parked in QUESTIONS.md |

---

## 10. Module boundaries
| Package | Owns | A change looks like |
|---|---|---|
| `core` | registry, claim model, policy hook, ids, config | a YAML row |
| `knowledge` | sources, claims, board views, slots, rules, justifications, grades, identity, hypotheses, toolkit (read+write), incremental derive | a rule row; one grade function |
| `plan` | questions, missions, dispatcher, actions, review, stop/kill, decisions | an indicator row; a weight |
| `acquire` | capability registry, cache, fetch/search/connectors, browser + recipes, datasets, manual tasks | a capability row; a recipe |
| `agents` | the mission agent (read, navigate, board verbs), the verifier, prompt versions, model routing | a prompt or model swap |
Capabilities never write to the board; agents touch it only through the toolkit; nothing derived is edited by
hand.

## 11. Effect on the plan
M0–M1 stand as built; the review's removals and replacements (markdown canonical, gate/classifier/families/
shingles out, publisher ladder, identity §5, persistent ids, incremental derive) are the first work items of
M2, since the loop builds on them. M2 = missions + dispatcher + agents + first capabilities (`M2_DESIGN.md`
v0.2). M3 = media + browser recipes + acquisition. Learning (§6) runs alongside from M2 on.
