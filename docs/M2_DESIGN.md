# M2 — the loop, designed before it is built

*v0.2 · 2026-08-31 · rewritten to the missions architecture (`INVESTIGATION_MODEL.md` v0.3). The v0.1 pipeline
— gap → micro-Actions → capabilities — becomes **dispatcher → missions → agents on a shared board**. Nothing
here is invented past the model; where it left a parameter open the choice is marked **(param)**. For the maintainer
to push on before code.*

## 0. What M2 must prove
A Question in one sentence → the dispatcher cuts it into missions → agents read whole pages, navigate on their
own judgment, and work the board (contribute, suggest, challenge, propose) → the board re-derives incrementally
after each contribution → the loop re-plans and stops by the stop rule, never a budget. Acceptance on seed A:
`wg run 01a04f2b "Person A: every board seat, with dates, and who he sat with"` runs unattended to a graded
dossier, and `wg log` says which mission found each seat and why it ran. Parallel agents never corrupt the
board (worst case: a few wasted pages).

## 0.1 Prerequisite work (the review's removals, first commits of M2)
These land before the loop, because the loop builds on them (INVESTIGATION_MODEL §11):
1. **Markdown canonical** — store Firecrawl markdown as `text`; inline links → `[anchor][n]` + `link_table`;
   delete `markdown.ts` and the plain-text path. Re-derive the three seeds from stored raw (no refetch).
2. **Quote gate removed** — quotes stay on claims as provenance; drop the reject path. `extractor_conf_raw`
   column dropped.
3. **Classifier + priors + families + shingles removed** — replaced by §1.4 of the model: `published_by` /
   `attributed_to` claims, publisher ladder for reliability, page/publisher/attribution for origins.
4. **Identity §5** — merge only on shared unique identifier / recorded judgment / owner; scores are triage;
   temporal contradictions as negative evidence; persistent entity ids; orgs get person-level caution.
5. **Incremental re-derive** with the full rebuild kept as auditor (byte-identical check).
These are refactors of built code, each with the tests already in place; they shrink the system.

## 1. Tables (new for the loop)
```
questions   { id, investigation_id, parent_id?, subject_entity_id?, sought, indicators jsonb, kill_criterion,
              stop_rule jsonb, status, compiled_by, created_at, closed_at, answer_ref? }
missions    { id, investigation_id, question_id, objective, scope jsonb {entities[],slots[],hypotheses[]},
              frontier jsonb [urls|queries], constraints jsonb {pages,model}, state proposed|running|done|extended,
              verdict, trail jsonb [action_ids], proposals jsonb [mission drafts], score, score_parts jsonb,
              launched_by dispatcher|agent|human, dedupe_key, created_at, started_at, finished_at }
actions     { id, investigation_id, question_id, mission_id?, line_of_enquiry, kind, target jsonb, capability_id?,
              params jsonb, raised_by jsonb, priority, score, score_parts jsonb, state, pend_until?, result?, scope?,
              result_refs jsonb, cost_usd, seconds, tier_used, dedupe_key, cites_action_id?, timestamps }
capabilities{ id, kind, inputs text[], outputs text[], cost_usd, cost_seconds, tier, jurisdictions text[],
              entity_types text[], cache_key_fields text[], cache_ttl interval, rate jsonb, requires jsonb,
              enabled bool, added_by, spec jsonb }
capability_runs { id, capability_id, action_id, inputs_norm jsonb, cache_key, result, n_claims, n_sources, cost_usd, error?, timestamps }
source_cache    { cache_key PK, capability_id, inputs_norm jsonb, source_ids uuid[], fetched_at, expires_at }
domain_strategy { domain PK, best_method, last_ok_at, fail_count }               -- learned fetch strategy (§6)
indicator_templates { subject_type, name, predicates text[], record_classes text[], weight real }
investigations + mode auto|approve, + ceiling jsonb?
```
Model §0.1: nothing here is hand-edited except `capabilities.enabled` and `questions.indicators`.

## 2. Compile a Question (an agent job, user-visible)
Input: the sentence · the seed's current dossier (`digest`) · the registry predicate tree · indicator
templates for the subject type · applicable rule ids. Output (editable with `wg question edit`):
```
{ sought, subject_ref, indicators: [{name, predicates[], record_classes[], weight}],
  kill_criterion, stop_rule: { min_independent_on: [predicate…], mandatory_searched, stability_actions, max_open_contradictions } }
```
Only predicates/record classes that exist in the registry or rules survive (unknown → `candidate:` with a
parent, like claims). Cheap and re-runnable; recompiled when the subject's type/kind changes.

## 3. Dispatch — gap → missions (deterministic; no LLM)
```
dispatch(question):
  gaps ← for each entity in ring(subject, ≤3):
           open slots on entity (rules opened them at re-derive)
         ∪ indicator slots (question.indicators × subject and ring-1)
         ∪ unchecked hypothesis observations (by diagnosticity)
         ∪ challenges awaiting investigation
  answer-from-graph-first: a gap already satisfied in this or a linked graph → found(cached), $0, dropped
  bundle gaps into coherent missions (same subject-area + same line of enquiry → one mission)
  score each mission (§4); dedupe on dedupe_key against running/proposed missions
  launch the top-K in parallel (K = concurrency (param), respecting capability.rate and requires)
```
A mission is **coherent, not one-slot-each**: "Person A's board dates 2010–2016", "other directors of Meridian
Space", "is registry-profile Person E the university-Person E". A gap with no runnable capability becomes
`not_obtainable(reason)` — visible in `wg gaps`, the input to acquisition (M3).

## 4. Score (ranks missions; triage only, never truth — model §3)
```
score(mission) = expected_gain × p_find / cost × tier_factor × ring_decay
expected_gain  = w_ind·Σindicator_weight + w_diag·diagnosticity + w_key·hard_key_bonus + w_struct·structural_delta + w_nov·novelty
p_find         = rule_expectedness(mandatory .9 · usual .6 · possible .3) × domain/capability_yield × freshness
cost           = Σ(usd + seconds/60) over the mission's expected actions (+ human time for manual)
tier_factor    = L0/L1 1 · L2 .9 · L3 policy(1 unrestricted) · L4 0
ring_decay     = 1/(1+ring)      # one feature, never a gate
weak-key ban   : mission built only from low-grade/inferred facts → priority ≤ Low unless a hypothesis names it
```
Weights in `plan/weights.yaml` **(param)**; `score_parts` stored so `wg why <mission>` explains the ranking.
A bad rank wastes cents, not identities — this is the seat the learned triage model (model §6) takes first.
**No ring caps, no budget in the score.** Extension requests from agents re-enter here, scored against all.

## 5. The agent (the mission executor)
**Given:** objective (one sentence) · `digest(scope)` (the compact subgraph, the judge's dossier format
generalized) · the open slots/hypotheses to close · a starting frontier · the toolkit as tools · a page budget.

**Loop (its own context):**
```
until objective met | frontier exhausted | needs more room:
  step ← the agent decides: fetch a frontier url · follow link [n] from a page it read ·
         search (it expands name variants itself) · read the graph (ego/paths/contested/why/find) · report done
  each step is an Action row (research log stays complete though the agent chose the step)
  reading a page: whole markdown in context (monsters read section-wise: skeleton → chosen sections → carried notes)
  it emits board writes as it goes (see below)
returns: { verdict: found|partial|no_trace (scope), trail, proposals: [sub-missions] }
```
**Board writes (toolkit §4.4 write verbs — evidence-carrying, never direct derived state):**
`contribute(source, claims)` · `suggest(hypothesis, evidence)` · `challenge(target, reason, evidence)` ·
`annotate(target, note)` · `propose_mission(objective, scope)` · `propose_rule(when, then)`.
**Cannot** assert identity as fact, delete/overwrite evidence, or set a grade — its certainty enters weighted.

**Coordination:** the sources table is the shared "already visited" ledger (re-fetch of a stored page = free);
mission scopes are declared so two agents don't walk the same street; a hard key agent A finds closes a slot
agent B is chasing at the next incremental re-derive.

**Model:** reader = Gemini 3.7 Flash (1M context, cheap, holds a whole page); verifier (identity, door 3) =
Claude Haiku 4.5, a different family on purpose. Registry-compiled claim schema **stays** — the one guardrail.

## 6. Ingest + re-derive (what a mission's returns trigger)
`contribute` → sources stored (markdown canonical) + claims → mentions to resolution → hard keys matched to
open slots/hypotheses → qualifier subsumption → lead/anomaly rules → **incremental re-derive** over the
justification-named blast radius (one link re-aggregated & regraded, one entity's rules re-run, touched pairs
re-triaged) — milliseconds, so many agents share one board. **Full rebuild survives as the auditor**: run
periodically, diff against incremental; any mismatch is a bug that announces itself. Fetching learns
`domain_strategy` (plain HTTP for most of the web, headless/owner-session for walled domains); distinct URLs
fetched concurrently.

## 7. Run / evaluate / review / stop
```
run(question):
  until stop|kill|exhausted:
    launch top-K missions (§3) in parallel
    on each return: evaluate — verdict tagged to what it served; partial → follow-up mission; no_trace →
                    slot searched_absent(scope); temporal bounds propagate (lo>hi → contested + value hypothesis);
                    grades recompute along chains; agents' proposals enter the queue (§4)
    every N actions / T minutes: review — stale/pended missions requeued; stale slots; assumptions re-checked;
                    contrarian pass (context-isolated verifier, evidence only) on any hypothesis about to establish
  stop  when stop_rule holds → proof argument (cites claim ids) → context-isolated check → dossier
  kill  when kill_criterion holds
  exhausted when best mission score < floor and stop_rule unmet (or the optional owner ceiling is hit)
```
`mode: approve` shows the top missions and waits; `auto` (default) launches. CLI: `wg run · missions · queue ·
log · why <mission|action> · stop`.

## 8. First capabilities (data rows; a small adapter each implementing the §7-model contract)
| name | kind | inputs → outputs | tier | cache |
|---|---|---|---|---|
| `fetch.page` | fetch | url → page | L0 | url · 30 d |
| `search.serpapi.google` | search | query → urls | L0 | query · 7 d |
| `search.serpapi.scholar` | search | name → publications, co-authors | L0 | query · 30 d |
| `search.exa` | search | description → urls (semantic, `type:auto`, highlights) | L0 | query · 7 d |
| `search.exa.similar` | pivot | url → similar pages | L0 | url · 30 d |
| `pivot.wayback` | pivot | url → past versions, first-capture date | L0 | url · 90 d |
| `pivot.whois` | pivot | domain → registrant, dates | L1 | domain · 90 d |
| `pivot.email.gravatar` | pivot | email → avatar, name | L1 | email · 90 d |
| `dataset.sec.edgar` | connector | person/org → filings, board seats (Form 4, 10-K) | L0 | name · 30 d |
| `dataset.opencorporates` | connector | org name → officers, filings | L1 | name · 30 d |
| `dataset.fr.sirene` | connector | org/person (FR) → company records | L0 | name · 30 d |
| `dataset.fr.annuaire` | connector | name (FR) → phone/address | L1 | name · 90 d |
| `browser.recipe` | browser_recipe | recipe + inputs → page (owner session) | L3 | recipe+inputs · 1 d |
| `manual` | manual | task text → owner's return | — | — |

`requires` names the key/session; a capability without it is present but `enabled=false`, and gaps it would
serve read `not_obtainable(needs SERPAPI_KEY)` — never silent. `SERPAPI_KEY` and `EXA_API_KEY` are set and
verified (SerpAPI Starter 1,000/mo; Exa live). The row is the truth about cost/tier/cache; the adapter is code.

## 9. Worked example — seed A, "every board seat, with dates, and who he sat with"
1. **compile** → indicators `board_seats {board_member, 1.0}`, `board_dates {board_member[valid_from/to], .8}`,
   `co_directors {board_member on shared orgs, .7}`; stop rule ≥2 independent origins on every board_member
   link, mandatory records searched (SEC / company pages), 15 actions no change.
2. **dispatch** → graph already has 13 seats (9 established). Missions: **M1** "board dates for Pinnacle Dental
   & Summit Medical"; **M2** "other directors of the 11 boards"; **M3** "SEC Form-4 record for Person A";
   each scored, M3 highest (mandatory + hard-key output, L0, $0).
3. **agents** run in parallel: the SEC agent reads EDGAR, contributes filings, closes the `valid_to` hole on
   Pinnacle when a filing dates his exit; the co-director agent reads company board pages, follows link-table
   entries to bios, contributes `board_member` claims — which resolve against existing org entities.
4. **board** re-derives incrementally per contribution; co-director folds appear in
   `wg fold person-board_member-organization-board_member-person --from "Person A"`; a page that merely
   repeats Crunchbase is one origin, not a second.
5. **stop** when the rule holds → proof argument cites claim ids → context-isolated verifier reads only the
   evidence → dossier.

## 10. Build order within M2
1. Prerequisite refactors (§0.1) — markdown, gate/classifier/families out, publisher ladder, identity §5,
   persistent ids, incremental re-derive. *Proves:* the three seeds re-derive identically, cheaper, cleaner.
2. Capability registry + `fetch.page` + the two search capabilities (keys are in). *Proves:* a gap becomes a
   real fetch/search; results ingest.
3. Questions + compile + dispatcher + scoring (no agents yet — missions execute as scripted fetch/search).
   *Proves:* seed A gaps become scored missions; `wg missions` ranks them.
4. The agent + toolkit write verbs + the mission loop. *Proves:* one agent closes a real gap unattended.
5. Parallel dispatch + review + stop. *Proves:* the full acceptance run on seed A.

## 11. Open for the maintainer (parked, not blocking)
- **§3 eagerness** — the dispatcher bundles every gap into a mission; the *score* (not a cap) decides which
  launch. Right instinct, or want a floor on what's even proposed?
- **`mode: auto` as default** for the first seed-A run — or `approve` until you trust it?
- **Concurrency K** and page budget per mission — start conservative (K=3, 20 pages)?
- **Extraction questions** (docs/QUESTIONS.md) still parked — several touch the agent-as-reader.
- **Gold reviews** (`gold/*/entities.yaml`) — needed before identity §5 has a real B³ number.
