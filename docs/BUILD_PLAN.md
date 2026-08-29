# WorldGraph — build plan (working backwards)

*v0.2 · 2026-08-29. Derived from `PRODUCT_SPEC.md` §7 and `ARCHITECTURE.md`. Each milestone lists the
modules it creates, the tasks in order, and the acceptance test that proves it. A milestone is done only
when its acceptance test passes and nothing in it will be undone by a later milestone. No time estimates
(decision: no deadline). Everything is written from scratch in this repo (decision: no code reuse).
Nothing here is built yet.*

---

## Milestone map

| # | Name | Proves | Cumulative demo |
|---|---|---|---|
| M0 | Claim pipeline | extraction + claim model | URL list → quote-validated claims in Postgres, queryable by SQL |
| M1 | Resolved graph | resolution, views-over-claims | claims → entities/edges; un-merge; `wg neighbors`, `wg dossier` |
| M2 | Planner | the agent loop | seed + goal → approve-each-hop run → coverage report; auto mode flag |
| M3 | Connectors + media | precision beyond pages | 10 connectors, OCR/ASR, geocoding, dates |
| M4 | Query | the graph answers questions | structural / NL / semantic; saved questions |
| M5 | Governance + legal | safe to widen scope | policies enforced, audit, erasure — after the legal walkthrough |
| M6 | Canvas | the Iron-Man view | WebGL graph with provenance drill-down |
| M7 | Watch | standing value | scheduled re-run, diff, alerts |
| M8 | Platform | others build on / use it | API, MCP, evals in CI, shared registry, multi-tenant, optional client-system sync |
| M9 | Polish | final product | layouts, compare, reports, self-host |

Process rules (decision 2026-08-29): git from day one, small commits, one concern per commit; check the
vision with the maintainer at each milestone boundary and at any fork inside one; keep `docs/` in sync with what
is built (a decision that changes the design updates the spec in the same commit).

---

## M0 — Claim pipeline

**Creates:** `packages/core` (ontology registry, claim types, Zod schemas), `packages/db` (migrations for
`workspaces, investigations, sources, claims, cost_ledger, audit_log`), `packages/acquire/fetch` (HTTP +
Readability, PDF, Firecrawl fallback, archive fallback), `packages/extract` (chunker, prompt, extractor,
quote gate), `apps/worker` (minimal runner), `wg` CLI (`db:migrate`, `investigate --urls`, `sql`).

**Tasks**
1. Repo scaffold: pnpm workspace, TS strict, vitest, eslint; `infra/docker-compose.yml` (postgres 17 + pgvector + AGE, MinIO).
2. Ontology YAML (§4) + loader + validation; render (a) extraction JSON schema, (b) prompt guide. Unit tests: registry round-trip, domain/range validation.
3. Migrations for M0 tables (§3.1–3.3, cost, audit).
4. Fetcher cascade (§5.1) with normalized result; per-domain rate limiter; blob store abstraction (FS).
5. Chunker (§6.1) with overlap and hash; unit tests on paragraph boundaries.
6. Extractor: system prompt (cached prefix), structured output via `messages.parse` + Zod, refusal handling, cost capture from `usage`.
7. Quote gate (§6.4) with offset map; unit tests: exact, whitespace/quote variants, fuzzy accept, reject.
8. Insert path: validate predicate domain/range, attribute-class floor, `status`, dedupe by `chunk_hash`.
9. CLI `wg investigate --seed "…" --goal "…" --urls urls.txt` (no planner yet) → fetch→chunk→extract→insert; prints counts, reject rate, $ spent.
10. Governance hook stub: `policy.redact(claim)` with the `unrestricted` policy — wired now so M5 only adds rules.

**Acceptance**
- Gold seed A (~20 curated URLs): ≥ 150 claims, quote-gate reject rate ≤ 8 %, 0 claims without a resolvable span, cost ≤ $3, re-run is a no-op (chunk hashes).
- `SELECT` can answer "which sources mention org X" and "all claims with predicate works_at" directly.

## M1 — Resolved graph

**Creates:** `packages/resolve`, `packages/graph` (materialize, derived `located_in`, snapshots), migrations
for `entities, claim_entities, resolution_*, edges, entity_attributes, snapshots`, CLI commands
`rebuild`, `neighbors`, `dossier`, `candidates`, `decide`, `unmerge`.

**Tasks**
1. Normalizers (person/org names, emails, phones E.164, handles, URLs); tests.
2. R1 identity-key union-find; same-source coreference; R2/R3 blocking + feature scoring with hand-tuned weights; thresholds; hard vetoes.
3. `resolution_decisions` constraints; `resolution_candidates` emission.
4. Materialization transaction (§8.1) incl. property merge with conflict retention; advisory lock; `wg rebuild`.
5. Derived `located_in` closure; snapshot writer + `graph.json`.
6. CLI read commands: `wg neighbors <entity>`, `wg dossier <entity>` (attrs, edges grouped, claims with quotes + source URL), `wg source <id>` (text with quote spans marked).
7. CLI review: `wg candidates` (pending pairs with shared evidence), `wg decide <a> <b> same|not_same`, `wg unmerge <entity>` → rebuild.

**Acceptance**
- Gold seed A: entity precision ≥ 0.95 / recall ≥ 0.85 against the hand-labelled set; zero wrong merges; ≥ 2 pending candidates surfaced correctly as *not* auto-merged.
- Un-merge of a deliberately forced merge restores the two entities with their claims intact.
- `graph.json` snapshot round-trips (load → same counts).

## M2 — Planner

**Creates:** `packages/planner` (goal compiler, frontier, scorer, hop policy, stop rules, event log),
`packages/acquire/search` (Brave + one fallback), X2 classifier, cost budgets, planner loop in
`apps/worker`, CLI frontier commands.

**Tasks**
1. Goal compiler (structured output) + `wg goal` to show/edit the compiled goal before start.
2. Search provider interface + Brave + SerpAPI fallback; query templates YAML per entity type.
3. `frontier_actions`, `plan_events`, `coverage` migrations; frontier priority queue with re-scoring after rebuild.
4. Scorer (§9.2): relevance priors, novelty via embeddings (introduces G4: Voyage + pgvector), domain quality table, cost estimate, hop decay.
5. Hop policy table + per-investigation overrides.
6. X2 Haiku classifier gating extraction depth.
7. P4 LLM next-step proposals with coverage computation (must_answer satisfaction via structural checks; timeline gaps).
8. Stop conditions + budgets from `cost_ledger`; pause/resume; replay from event log with cached sources.
9. **Approve-each-hop mode is the default**: `wg frontier` lists scored actions with rationale; `wg approve <ids>` / `wg deny <ids>` / `wg run --auto` for the auto mode behind a flag.
10. Coverage report generation (found / not found / gaps / spend).

**Acceptance**
- Gold seeds A–C from seed+goal only: ≥ 70 % of gold edges recovered within budget $10 / 300 pages; no expansion of city/region nodes; hop-decayed frontier never spends > 25 % of budget beyond hop 2.
- Replay under the same policy reproduces the same graph from cache with $0 fetch/search spend.
- Approve mode fetches nothing until approved.

## M3 — Connectors + media

**Creates:** `packages/acquire/connectors/*` (OpenCorporates, EDGAR, CourtListener, OpenFEC, OpenAlex, ORCID, PatentsView, Wikidata, RDAP, GDELT), media (OCR, ASR), X4 temporal + X5 geocoding, `places` table, `adjacent_to`/`preceded_by` derivations.

**Tasks**
1. Connector interface + registry + per-connector ToS posture doc + policy flags; raw-response sources with quoted JSON fragments.
2. Ten connectors, each written against the provider's API docs.
3. Planner integration: connector actions in templates/hop policy with cost.
4. OCR + ASR pipeline (subprocess), EXIF; reverse-image as capped lead generator.
5. Temporal normalizer (chrono) + precision; geocoder + cache + `places`; derived geo/time edges.

**Acceptance**
- Gold seed D (company): ≥ 90 % of gold `owns`/`member_of`/`legal_matter` edges from connectors alone; every connector claim opens a source with a highlighted fragment.
- Dates: ≥ 95 % of gold intervals within precision; addresses geocoded ≥ 90 %.

## M4 — Query

**Creates:** `packages/query` (templates, router, NL answerer with tool runner), AGE projection + Cypher path, saved questions, `wg ask`, `wg q <template>`.

**Tasks**
1. Structural templates (§11.1) in SQL; AGE projection build + Cypher variants; parity tests.
2. Router (Haiku) + entity name resolution; fallthrough rules.
3. NL grounded answerer (Opus + tools), claim-level citations, "not in graph" behaviour; Q2 semantic search.
4. Saved questions per investigation.

**Acceptance**
- 30-question benchmark per gold seed: structural answers exact; NL answers cite only real claims (0 uncited assertions); p95 structural latency < 300 ms.

## M5 — Governance + legal

**Preceded by** the legal walkthrough with the maintainer (GDPR, CCPA, FCRA, scraping ToS) and a decision on the default policy for any second user.

**Creates:** policy engine (`packages/core/policy`), built-in policies incl. `unrestricted`, enforcement at create/plan/extract/query/export, audit log writers, erasure flow, retention jobs, abuse-volume checks.

**Tasks**
1. Policy spec (§10.1) + loader + built-ins.
2. Create-time gate; plan-time `allows(action)`; extract-time redaction (replaces M0 stub); query-time filter; export watermark.
3. Audit log writes at every enforcement + all mutations; append-only grants.
4. Erasure command + denylist check at extraction; snapshot regeneration.
5. Retention jobs; legal-basis / attestation fields (whatever the walkthrough decides).

**Acceptance**
- Under `professional_context`, seed A run produces zero stored `lives_at`/`related_to` content (rows exist as redacted), and the plan log shows those expansions denied with reasons; under `unrestricted` the same run stores them.
- Erasure of a test subject removes them from graph, snapshots, exports, and blocks re-acquisition on re-run.

## M6 — Canvas

**Creates:** `apps/api` (read endpoints: graph, dossier, source, frontier), `apps/web` (Next.js; sigma.js canvas + ForceAtlas2 worker; filters; dossier drawer; source highlight; review queue; expand-in-place via planner action).

**Acceptance**
- Canvas renders 2k nodes at interactive frame rate; every edge click reaches a highlighted source quote; expand-in-place enqueues a frontier action visible in `wg frontier`.

## M7 — Watch

**Creates:** `watches`/`alerts`, diff engine, scheduled replay + fresh search, delivery channels (email, Slack, webhook).

**Acceptance**
- A planted change on a cached source (new role) triggers exactly one alert with the correct diff.

## M8 — Platform

**Creates:** full REST API (§14.1) + SSE, MCP server, OpenAPI, job hardening, OpenTelemetry + metrics, eval harness in CI, workspace-level shared registry (R6) with per-workspace on/off, workspaces/users/roles/RLS, model-review mode for candidates, **optional** client-system sync behind a flag.

**Acceptance**
- An external agent (Claude Code via MCP) runs an investigation, approves actions, queries, exports — without the web UI.
- CI fails on a deliberate prompt regression that drops edge recall by 3 pts.
- A second workspace cannot read the first's investigations (RLS test).

## M9 — Polish / final

**Creates:** geo + timeline + hierarchical layouts, compare view, report generator (PDF/Markdown/JSON-LD/CSV/GraphML), self-host compose, docs.

**Acceptance**
- Every surface in `PRODUCT_SPEC.md` §2.1 exists and the §2.2 walkthrough can be performed verbatim on gold seed A with the default budget.
- Self-host: `docker compose up` on a clean machine → full product with env-only config.

---

## Gold investigations (needed from M0; grow to 10 by M8)

| Seed | Type | Why |
|---|---|---|
| A | public figure (investor/executive) with deep web footprint | rich `works_at`/`member_of`/`authored`; tests resolution on a common name |
| B | mid-profile academic | ORCID/OpenAlex connectors; timeline |
| C | small company + founders | `owns`/`member_of`; EDGAR/OpenCorporates |
| D | public company | connectors precision |
| E | self (the maintainer, `unrestricted`) | the "what does the web know about me" demo |
| F | event (conference) | `had_participant` fan-out; hop policy |
| G | a private individual the maintainer chooses (own workspace, `unrestricted`) | the original use case; tests residence/relatives/neighbors queries |
| H–J | added from real runs | drift detection |

Each gold set = hand-verified entities (with identity keys), edges (src, pred, dst, interval), and 30 questions with expected answers. Stored in `packages/eval/gold/`.

---

## What must be true before M0 starts
- Repo initialized, docs committed (done 2026-08-29).
- Anthropic key (exists), Firecrawl key (exists). Brave search key needed at M2, Voyage key at M2.
- Open items in `PRODUCT_SPEC.md` §9 answered: shared world graph (Q5) — can start M0 without it; legal (Q10) — needed before M5.
- Remaining voice-memo ideas from the maintainer folded into the spec.
