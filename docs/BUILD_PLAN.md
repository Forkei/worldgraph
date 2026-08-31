# WorldGraph — build plan

*v0.3 · 2026-08-30. Rewritten under `INVESTIGATION_MODEL.md` (v0.2). Milestones are ordered so nothing in
M(n) is undone by M(n+1). No time estimates; no code reuse from other projects. Each milestone names what it
creates and the test that proves it.*

## Process
Small commits, one concern each. Docs in sync with what is built (a design change updates the model or spec in
the same commit). Simplicity rules (model §0.1) applied to every table and interface. The 12 objects are the
vocabulary; a new feature reads them, it does not reshape them.

## Milestones

| # | Name | Proves | Creates |
|---|---|---|---|
| M0 | Claim pipeline ✅ | extraction + claim model | fetch → chunks → quote-gated claims in Postgres; CLI |
| **M1** | **Reasoning substrate** | the graph can hold, grade, and re-derive knowledge | registry v2 · claims v2 · sources v2 (capture, family, tier) · slots · rules · justifications · grades as views · same_as as claims + identity hypotheses · decisions · resolution as an Action · the toolkit |
| M2 | The loop | Question → Actions → results → re-plan → stop | Question compile · gap loop · scheduler · evaluate · review · stop/kill · capability registry · first ~15 capabilities · cache |
| M3 | Seeing and acquiring | photos as seeds; new tools without code | `depicts` media claims · reference matching (local) · browser recipes · capability acquisition (human-enabled) |
| M4 | Query | the graph answers questions | structural templates on the toolkit · NL grounded answers with claim citations · saved questions |
| M5 | Governance + legal | safe to widen scope | policies enforced at compile/plan/extract/query/export · audit · erasure (after the legal walkthrough) |
| M6 | Canvas | the Iron-Man view | WebGL graph · dossier drawer · provenance drill-down · expand-in-place |
| M7 | Watch | standing value | scheduled re-runs on open slots/hypotheses · diffs · alerts |
| M8 | Platform | others build on / use it | API · MCP · evals in CI · linked graphs · multi-tenant · optional client-system sync |
| M9 | Polish | final product | layouts · compare · reports · self-host |

## M1 — reasoning substrate, in build order

1. **Registry v2 + claims v2** (this commit). Predicate hierarchy with parents; `candidate:` with mandatory
   parent replaces `other`; attribute keys with datatype and `temporal_kind`. Claims gain `predicate_specific`,
   `schema_version`, EDTF time (`valid_from/to`, `date`) + normalized bounds, `temporal_kind`,
   `time_qualifier`, `asserted_at`, `derivation`, `inferred`, `extractor_conf_raw`. Extractor prompt follows the
   five rules (no derived quantities; roles as qualifiers; time as written; stated vs inferred; candidate with
   parent). The ×0.8 multiplier is removed. *Test:* re-extract gold seed A from cache; no `other`; every
   relation resolves to a core predicate directly or via parent; `age` never appears as an attribute.
   **✅ 2026-08-30 (`0f3086e`)** — seed A re-extracted under prompt `6764fa989be8` (Gemini 3.7 Flash, $0.54):
   378 claims kept (309 rel + 69 attr), 8 rejected (2.1%, all real: stitched "…" quotes, page titles, URLs),
   0 candidates needed (the 29-predicate tree covered everything: works_at 127 · board_member 48 · paid 21 ·
   founded 18 · located_in 14 · …), 143/309 relations carry EDTF time, 15 marked inferred, no `age`, one
   `founded_on` derived. The four old `other` claims were relabeled to `associated_with` + `candidate:`.
2. **Sources v2**: capture before extraction (raw + rendered snapshot + hash), `source_family`, `source_tier`
   tables (editable), origin clusters on claims (near-duplicate passages). *Test:* ten planted copies of one
   press release count as one origin.
   **✅ 2026-08-30** — `source_families` (us_people_search, pr_wire, linkedin_derived, wikipedia) and
   `source_tiers` (Admiralty A–F by domain pattern, ~50 seed rows, `wg tiers` to edit); every fetched page now
   stores a rendered HTML snapshot; claims carry a `passage` window; `clusterOrigins` (5-shingle Jaccard ≥ 0.6
   within one fact, same page = same origin, same family = same origin) with the planted test (10 copies → 1
   origin; a paraphrase is *not* a copy). Seed A: 1,273 claims → 984 origin clusters over 871 facts, 80 facts
   with ≥ 2 independent origins — e.g. "Person A works_at Alder Maple": 22 claims, **6** independent origins.
3. **Slots + rules**: `slot`, `rule` tables; shape rules and expected-record rules (US-IL teacher set, FR
   company set) as YAML → rows; the gap query (open/stale slots, interval holes, missing reciprocals).
   *Test:* seed A shows its open slots; a planted interval hole appears as a slot with a window.
4. **Justifications + grades**: `justification` table written by every materialization; grades as a view over
   justifications with the two-axis code; delete-and-rederive on retraction. *Test:* retract one source → its
   dependent links regrade or drop; nothing else moves.
   **✅ 3+4 (first cut) 2026-08-30** — migration 0004: `entities`, `claim_entities`, `links`, `attributes`
   (all rebuildable, stable hashed ids so slots survive), `justifications`, `rules`, `slots`; migration 0005:
   claims from an older prompt become `superseded` when their chunk was re-extracted. `rebuild` groups
   mentions by (type, normalized name) — the placeholder the M1.5 resolver replaces — aggregates claims into
   links/attributes with the evidence profile (independent origins from clusters, primary origins, best tier,
   contested for functional attributes) and the **two-axis grade** (A–F × 1–6 → established / corroborated /
   single_source / unverified / disputed); 11 core rules in `packages/knowledge/rules/core.yaml` open slots;
   interval holes on covering predicates become windowed slots. `wg rebuild · entities · dossier · gaps · rules`.
   Seed A (v2 claims only): 309 claims → 214 entities · 228 links · 66 attributes; grades established 26 ·
   corroborated 11 · single_source 207 · unverified 50; slots 69 found · 728 open · 1 interval hole. Person A's
   dossier reads correctly (e.g. board_member Harbor Medical 2010→2016, **established B1, 3 origins**).
   Still to do in 4: delete-and-rederive on retraction (needs decisions, M1.5).
   **✅ reliability v2 (same day)** — the maintainer: "we don't hardcode that a certain website is this." The seeded
   domain-tier table is gone. Each source is classified from its own content (`wg classify`, Gemini Flash-Lite,
   ~$0.0006/source): document kind, publisher, self-published. Reliability per claim = evidence prior by
   document kind (14 rows, adjusted by observed agreement) → +1 step if self-published about the entity the
   claim concerns → learned adjustment (≥ 20 observations) → owner override (empty by default). Result on
   seed A: acorncap.com correctly classified "profile, self-published by ACORN"; Person A's Birch board seat from
   it now grades B2 instead of F6; grades established 35 · corroborated 2 · single_source 257.
5. **Resolution as claims**: mentions → blocking → scoring (Fellegi–Sunter, learned u/m; sidecar or TS port)
   → identity hypotheses with predicted observations → split-test Action before merge → `same_as` decisions
   → entities/links as views; `wg candidates/decide/unmerge`. *Test:* B³ F1 ≥ 0.9 on the 300-pair gold set;
   registry-profile Person E lands as an identity hypothesis, never `different`; un-merge restores everything.
   **✅ first cut 2026-08-30** — TypeScript-native (no Python sidecar). Provisional entities (exact normalized
   name) → blocking (shared informative token, initialism, hard key) → additive log-odds scoring: hard-key
   match +15 / conflict = never; token overlap weighted by **corpus-learned rarity** (idf); Jaro–Winkler;
   org name structure (alias / manages / part_of / sibling by ordinal); initialism (AMCD); shared-neighbour
   context; different long numeric ids = never. Bands ≥0.95 merge · 0.60–0.95 identity hypothesis · else
   nothing. Decisions (`resolution_decisions`, human/llm/rule) win over scores and are reversible
   (`superseded_by`); score-merges are recomputed every rebuild, never persisted. `entity_members` = the
   un-merge path; slots migrate to the canonical entity. Related pairs become **derived links**
   (`manages`, `part_of`, `associated_with[derived:sibling]`). Seed A: 214 names → 206 entities;
   ACORN = Acorn Capital = Acorn Capital Associates LLC; Alder Maple = AMCD = Cedar & Dale; Acorn Capital
   Management LP —manages→ Acorn Capital; Acorn II / III funds are siblings, not merged; Stanford GSB part_of
   Stanford; 9 open identity hypotheses (San Francisco variants, Birch Insurance ↔ Birch, Org X ↔ Org Y).
   Still to do: LLM judge (door 3) on the hypothesis band; gold set + B³ evaluation; the athle.fr test.
   **✅ LLM judge (door 3) 2026-08-30** — `wg judge <inv>`: each open identity hypothesis is put to a second
   model family (Claude Haiku 4.5, ~$0.002/pair) with both sides' own facts, identifiers and up to three quotes;
   it answers same / different / related(kind) / unsure with a reason. Its verdict is **evidence on the
   hypothesis, never a decision**: the resolver shifts that pair's log-odds by ±4 (a 62 % same-name pair
   becomes 98 %; a "different" sinks it out of the band), a directed `related` becomes a derived link, and a
   hard-key conflict still wins over any verdict. Only human decisions are records (migration 0009 removed
   the earlier `llm` decisions). Lesson from the first run: the judge called Person E-the-athlete and
   Person E-the-"Chief AI Engineer" *different* on seniority stereotypes — so the prompt now allows
   'different' on hard contradictions only (identifiers, birth years, places at the same time), and "unsure"
   is a welcome answer. Result: seed E's four per-source Person E records → 3 same + 3 unsure → **one entity** with
   both handles and the athle.fr licence; seed A: 37 same-name pairs judged (Person B ×10, Person F,
   Person G, Person H …) → 265 names → **205 entities, 0 open hypotheses**, the Acorn fund vehicles
   related (sibling / parent), Person B one entity with 20 claims (founded Acorn Capital, established B1,
   4 origins). Hypothesis status is re-derived on every rebuild (a superseded decision reopens the pair).
6. **Decisions + the toolkit**: `decision` table; `ego · paths · intersect · fold · timeline · at · contested ·
   gaps · why · similar` as functions returning bounded, graded subgraphs; `wg dossier/neighbors/why`.
   *Test:* every toolkit call on seed A returns within 300 ms and every edge carries a grade and a why-chain.
   **✅ 2026-08-30** — `packages/knowledge/src/toolkit.ts`: pure functions over a loaded graph (`loadGraph`,
   ≈25 ms for seed A; every operator 0–13 ms), each returning a bounded subgraph whose edges carry the
   two-axis grade and the link id that `why` explains: `ego` (hops, predicates, as-of date, min grade, edge
   limit → truncated flag), `paths` (iterative deepening, simple paths, time window, weakest grade per path),
   `intersect`, `fold` (meta-paths with `*`), `timeline`, `at` (holds / not-then / undated), `contested`
   (qualifier disagreements listed with counts), `similar` (neighbour Jaccard). `why` walks justification →
   claims grouped by independent origin → quote, page, document kind, tier; for an entity it shows the names
   it was assembled from, the decisions and the judge's reasons. `decisions` table (model §1.10) written by
   scope (investigate), merge/split (decide, unmerge) and refer (judge); `wg decisions`. Six new toolkit
   tests (70 total). On seed A: Person A ↔ Person B has 30 paths ≤ 3 (knows; Acorn Capital; Alder
   Maple…), fold person–board_member–org–board_member–person from Person A gives his co-directors at
   Meridian Space and Birch, `at(Person A, 2015-06-01)` holds Granite Partners + 6 board seats and puts ACORN in
   "not then". Still to do in M1: delete-and-rederive on retraction, gold set + B³, third common-name seed.
   **✅ M1 close-out 2026-08-30** — *Retraction:* `wg retract <inv> <source|domain>` withdraws a source
   (status `retracted`, its claims `retracted`), rebuilds and reports the diff; `wg reinstate` undoes. On seed A
   retracting gritt.io: 28 claims out → 9 links dropped, 13 regraded, **230 untouched**; reinstating restores
   exactly (stable ids make delete-and-rederive a property, not a procedure). *Gold + B³:* `wg gold <inv>
   export <file>` writes the current clustering as YAML (provisional ids with names, `reviewed: false`) for
   a human to correct; `wg gold <inv> eval <file>` scores B³ precision/recall/F1 and lists over-/under-merged
   clusters. Files exported for all three seeds — **the maintainer still has to review them** before F1 means
   anything. *Seed C — Person C* (`01a053d7`, 13 URLs, $0.74): the Berkeley professor, the
   basketball player and the actor are mixed on purpose. Result: 212 names → 190 entities; **three namesakes, three entities** (athlete 154 claims / professor 88 / actor 40), no cross-namesake path ≤ 3, no
   cross-namesake hypothesis was even raised; the judge said *different* on every real contradiction (White
   Sox ↔ Bulls, NBA 2K11 ↔ 2K12, EECS ↔ Statistics departments, AAAI ↔ ACM, two same-surname people) and *same*
   on the name variants (four name variants). *Quote gate:*
   Firecrawl renders Wikipedia citations as `[[65]](url)`; the markdown → text pass now drops them and the
   gate blanks them offset-safely (`wg regate` re-checks rejected claims: +8 on seed C, +3 on seed A). The
   remaining wiki rejections are stitched "…" quotes across award tables — correctly refused.

M1 acceptance = all six tests, on gold seeds A (Person A), E (Person E), and C (Person C). **Status: built;
B³ ≥ 0.9 awaits the human-reviewed gold files (`gold/*/entities.yaml`).**

## Gold seeds
A Person A (public figure) · E the maintainer (self) · a third common-name public figure (to pick) · later: a
private individual the maintainer chooses (the original use case) · an event · an organization.

## Prerequisites
Anthropic, Gemini, Firecrawl keys (have). SerpAPI + Exa keys (M2, approved). Postgres runs natively (Docker
unavailable on this machine). Search-engine result storage: SerpAPI/Exa only.


## M2 prerequisite refactors (2026-08-31) — the review's removals, built before the loop
the maintainer's full review (INVESTIGATION_MODEL v0.3/0.4) replaced the crutches. Status:
- **1/5 markdown canonical** ✅ — markdown is the text the reader sees; inline links → `[anchor][n]` + a
  stored link table; the regex converter is deleted.
- **2/5 quote gate removed** ✅ — quotes stay as provenance, never located or rejected; structural guardrails
  (bad ref, type violation, dedup, unknown predicate) and the registry schema remain the wall.
- **3a/5 publisher ladder** ✅ — reliability = the publisher's relationship to the fact (authority A / self B /
  independent C / platform D / anonymous·unknown E), `self` graph-verified. The classifier, doc-kind priors,
  source families and shingle origins are gone; the reader emits the publisher. athle.fr → authority (a
  licence grades A); acorncap → self; TechCrunch/Fortune → independent; aggregators → platform.
- **3b/5 attribution** ✅ — the reader emits `attributed_to` ("according to Reuters"); origins count by
  attributed source, so many pages citing one filing are one origin.
- **4/5 identity** ✅ — the resolver never merges on a score; only a shared unique identifier, a recorded
  judgment (the verifier/agent, method `llm`, reversible), or the owner merges. Orgs get the same caution as
  persons. Cost: more judge calls and some genuine merges now depend on the judge (seed C left the actor in
  two entities — fixable by re-judge/human); the three namesakes stay apart, which is the point.
- **5/5 incremental rebuild** ⏳ deferred — pure performance (full rebuild ≈ 1.5 s); it only matters once many
  agents write concurrently, so it will be built alongside the agent/mission loop, with the full rebuild kept
  as the byte-identical auditor.

All three seeds re-run clean on the new pipeline; 67 tests pass. Next: the loop itself (M2_DESIGN v0.2) —
missions, dispatcher, agents — starting with the capability registry + fetch/search (keys are in).
