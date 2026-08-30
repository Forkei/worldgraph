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
6. **Decisions + the toolkit**: `decision` table; `ego · paths · intersect · fold · timeline · at · contested ·
   gaps · why · similar` as functions returning bounded, graded subgraphs; `wg dossier/neighbors/why`.
   *Test:* every toolkit call on seed A returns within 300 ms and every edge carries a grade and a why-chain.

M1 acceptance = all six tests, on gold seeds A (Person A), E (Person E), and a third common-name seed.

## Gold seeds
A Person A (public figure) · E the maintainer (self) · a third common-name public figure (to pick) · later: a
private individual the maintainer chooses (the original use case) · an event · an organization.

## Prerequisites
Anthropic, Gemini, Firecrawl keys (have). SerpAPI + Exa keys (M2, approved). Postgres runs natively (Docker
unavailable on this machine). Search-engine result storage: SerpAPI/Exa only.
