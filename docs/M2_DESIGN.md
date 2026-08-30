# M2 — the loop, designed before it is built

*v0.1 · 2026-08-30 · for the maintainer to push on before code. Everything here is a reading of
`INVESTIGATION_MODEL.md` §1.1, §1.5, §1.9, §1.11–1.12, §2, §3, §6, §7 into tables, functions and one worked
example. Nothing new is invented; where the model left a parameter open, the choice is marked **(param)**.*

## 0. What M2 must prove
A Question written in one sentence compiles into indicators; the graph finds its own gaps; Actions are raised,
scored, run through capabilities, and their results re-enter the graph; the loop re-plans on every result and
stops by the stop rule — never by a budget. On seed A: `wg run 01a04f2b "Person A: every board seat, with
dates, and who he sat with"` runs unattended to a dossier with every board seat graded, and its research log
says why each Action ran.

## 1. Tables (five new, three touched)
```
questions      { id, investigation_id, parent_id?, subject_entity_id?, sought, indicators jsonb, kill_criterion,
                 stop_rule jsonb, status open|answered|killed|exhausted, compiled_by, created_at, closed_at, answer_ref? }
actions        { id, investigation_id, question_id, line_of_enquiry, kind, target jsonb, capability_id?, params jsonb,
                 raised_by jsonb {kind, id}, priority, score, score_parts jsonb, state, pend_until?, result?, scope?,
                 result_refs jsonb, cost_usd, seconds, tier_used, dedupe_key, cites_action_id?, created_at, started_at, finished_at }
capabilities   { id (name), kind, inputs text[], outputs text[], predicates text[], cost_usd, cost_seconds, tier,
                 jurisdictions text[], entity_types text[], cache_key_fields text[], cache_ttl interval, rate jsonb,
                 requires jsonb, yield_hits int, yield_runs int, enabled bool, source_family_id?, added_by, spec jsonb }
capability_runs{ id, capability_id, action_id, inputs_norm jsonb, cache_key, started_at, finished_at, result, n_claims, n_sources, cost_usd, error? }
source_cache   { cache_key PK, capability_id, inputs_norm jsonb, source_ids uuid[], fetched_at, expires_at }
indicator_templates { subject_type, name, predicates text[], record_classes text[], weight real }   -- seeded from research 09
slots          + question_id (exists), + action_id (exists)                                        -- no change
hypotheses     + predicted_if_true / predicted_if_false used for the first time                    -- no change
investigations + mode auto|approve, + ceiling jsonb?                                               -- two columns
```
Rule of the model §0.1: nothing here is edited by hand except `capabilities.enabled` and `questions.indicators`.

## 2. Door 1b — compile a Question
Input: the sentence, the seed entity's current dossier (type, kind, keys, 1-hop ego), the registry's predicate
tree, the indicator templates for the subject type, the rule ids that apply. Output (JSON schema, user-visible,
editable with `wg question edit`):
```
{ sought, subject_ref, indicators: [{name, predicates[], record_classes[], weight}],
  kill_criterion: text, stop_rule: { min_independent_on: [predicate…], mandatory_searched: true,
  stability_actions: N, max_open_contradictions: M } }
```
The model proposes; the graph keeps only predicates/record classes that exist in the registry or the rules
(unknown → `candidate:` with a parent, exactly like claims). Weights default from the template; the model may
move them, the owner may override. **Compiling is cheap and re-runnable** — a Question is recompiled when the
subject's type or kind changes (a person turns out to be an organization).

## 3. Gap → Actions (one function, no LLM)
```
gap(question):
  for each entity in ring(question.subject, ≤3):                         # ring = graph distance along household/employer/officer/relative predicates
    slots ← open slots on entity (rules already open them at rebuild)
         ∪ indicator slots (question.indicators × entity where entity is the subject or ring-1)
         ∪ hypothesis observations (predicted_if_true/false not yet checked, by diagnosticity)
    for each slot: answer-from-graph-first (this graph, linked graphs) → found(cached) at zero cost
                   else for each enabled capability whose inputs ⊆ facts we hold on the entity and whose outputs ∋ slot.key:
                        raise Action(kind by capability.kind, dedupe_key = (capability, inputs_norm, slot))
```
Deduplication is a unique index on `dedupe_key` among non-filed Actions. A slot with no runnable capability
becomes `not_obtainable(no capability)` — that is what capability acquisition (M3) reads.

## 4. Score (model §3, verbatim; weights **(param)** in `plan/weights.yaml`)
```
score = expected_gain × p_find / cost × tier_factor × ring_decay
expected_gain = w_ind·indicator_weight + w_diag·diagnosticity + w_key·hard_key_bonus + w_struct·structural_delta + w_nov·novelty
p_find        = rule_expectedness(mandatory 0.9 · usual 0.6 · possible 0.3) × yield_prior(hits+1 / runs+2) × freshness
cost          = usd + seconds/60 (+ 30 for manual)
tier_factor   = L0/L1 1 · L2 0.9 · L3 policy(1 for unrestricted) · L4 0
ring_decay    = 1 / (1 + ring)          # one feature, learned later; never a gate
weak-key ban  : raised from a D/E-grade or inferred fact → priority ≤ Low unless a hypothesis names it
```
`score_parts` is stored on every Action so `wg why <action>` explains the ranking. **No ring caps, no
per-ring allowance, no budget in the score.**

## 5. Run
```
loop(question):
  until stop|kill|exhausted:
    a ← highest-score Action in for_allocation (respecting capability.rate and requires)
    run capability → {claims[], sources[], nulls[], links_found[], cost, tier_used}   # never writes the graph
    knowledge.ingest(sources, claims)  → quote gate → classify → cluster → resolve → rebuild(delta)   # M0/M1 code
    evaluate(a): found | partial (→ "what remains" Action) | no_trace (slot ← searched_absent, scope) | error
    delta pass: new hard keys × open slots/hypotheses; lead/anomaly rules; hypotheses re-scored; if any priority moved > θ → re-rank
    every N actions: review()     # stale allocated, pended past date, stale slots, assumptions, contrarian pass (door 3c)
  stop  when stop_rule holds → door 1p proof → door 3c check → dossier
  kill  when kill_criterion holds
  exhausted when the best score < floor and stop_rule unmet (or the optional owner ceiling is hit)
```
`mode: approve` shows the top-k Actions and waits; `auto` (default) runs. `wg run <inv> "<question>"`,
`wg queue <inv>`, `wg log <inv>` (resulted Actions = the research log), `wg stop <inv>`.

## 6. The first capabilities (data rows, not code paths)
| name | kind | inputs → outputs | tier | cache |
|---|---|---|---|---|
| `fetch.page` | fetch | url → page (any predicate) | L0 | url · 30 d |
| `search.serpapi.google` | search | name (+ context tokens) → urls | L0 | query · 7 d |
| `search.serpapi.scholar` | search | name → publications, co-authors | L0 | query · 30 d |
| `search.exa` | search | description → urls (semantic) | L0 | query · 7 d |
| `search.exa.similar` | pivot | url → similar pages | L0 | url · 30 d |
| `pivot.wayback` | pivot | url → past versions | L0 | url · 90 d |
| `pivot.whois` | pivot | domain → registrant, dates | L1 | domain · 90 d |
| `pivot.email.gravatar` | pivot | email → avatar, name | L1 | email · 90 d |
| `pivot.handle.crossref` | pivot | handle → profiles on other sites (probe) | L1 | handle · 30 d |
| `dataset.opencorporates` | connector | org name → officers, filings | L1 | name · 30 d |
| `dataset.sec.edgar` | connector | person/org → filings, board seats (Form 4, 10-K) | L0 | name · 30 d |
| `dataset.fr.sirene` | connector | org/person (FR) → company records | L0 | name · 30 d |
| `dataset.fr.annuaire` | connector | name (FR) → phone/address | L1 | name · 90 d |
| `browser.recipe` | browser_recipe | recipe + inputs → page (owner session) | L3 | recipe+inputs · 1 d |
| `manual` | manual | task text → whatever the owner returns | — | — |

Each row carries `requires` (`SERPAPI_KEY`, `EXA_KEY`, a session name); a capability without its key is
present but `enabled=false` and the gap function reports the slots it would serve — so missing keys are
visible as `not_obtainable(needs SERPAPI_KEY)` rather than silent. A capability's code is a small adapter
implementing the §6 contract; the row is the truth about cost, tier, cache, yield.

## 7. Worked example — seed A, "every board seat, with dates, and who he sat with"
1. compile → indicators: `board_seats {board_member, weight 1.0}`, `board_dates {board_member[valid_from/to], 0.8}`,
   `co_directors {board_member on the same organizations, 0.7}`; stop rule: ≥ 2 independent origins on every
   board_member link, mandatory records searched (SEC Form 4 / company pages), 15 actions without change.
2. gap → today's graph already has 13 board seats (9 established). Open: dates missing on Pinnacle Dental,
   Summit Medical; co-directors known only for Meridian Space and Birch. Slots: `board_member` on
   11 organizations for their *other* directors; `valid_to` holes on 2 links; `sec.edgar` mandatory record for a
   VC partner in the US.
3. actions (top of queue): `dataset.sec.edgar(Person A)` (mandatory, hard key output, L0, $0);
   `fetch.page(harbormedical.com/board)` for co-directors ×11; `search.serpapi.google("Person A" board director)`.
4. run → results ingest through the M1 pipeline; each new page's claims resolve against existing entities;
   slot on Pinnacle Dental `valid_to` closes when a filing dates his departure; co-director folds appear in
   `wg fold person-board_member-organization-board_member-person --from "Person A"`.
5. stop when the rule holds → proof argument cites claim ids → verifier reads only the evidence → dossier.

## 8. What I need from the maintainer before building
- **Keys**: `SERPAPI_KEY`, `EXA_KEY` in `.env` (approved earlier; not present yet).
- **Push on §3–§5**: is the gap function too eager (it raises an Action for every open slot with a runnable
  capability — the score, not a cap, decides what actually runs)? Is `mode: auto` the right default for a
  first run on seed A?
- **Review the gold files** (`gold/*/entities.yaml`, set `reviewed: true`) — until then B³ is not a number.
- Nothing else: rules, indicator templates and capability rows are data I can seed from research 07–09.
