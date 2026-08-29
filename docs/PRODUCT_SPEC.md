# WorldGraph — the full and final product

*v0.1 · 2026-08-29. This is the target we build backwards from. Sections 1–3 say what
the finished product IS. Section 4 is the ontology. Section 5 is every capability: what it does, why, how
it works, how it's implemented. Section 6 is the client-system decision. Section 7 is the reverse-ordered build
plan. Section 8 is what's deliberately out. If a capability is listed here, the finished product has it.*

---

## 1. Thesis (one paragraph)

WorldGraph is an **investigation engine**: give it a seed (a name, an address, a domain, a company, a
photo, a phone number, a document) and a **goal**, and it builds — autonomously, breadth-first, with
provenance on every fact — a typed, temporal, queryable **relationship graph** of everything publicly
knowable that is relevant to that goal. The output is not a list of links; it is a graph where every
edge carries data (role, dates, source, confidence), every node has a resolved identity, and every claim
traces to the exact sentence it came from. On top of the graph: a visual canvas, structural and
natural-language querying, continuous monitoring for change, and exportable reports. Underneath: a
planner that decides where to look next, an extractor that turns any page into clean typed claims, a
resolver that decides whether two mentions are the same thing, and a governance layer that decides
whether the investigation is allowed at all.

**One-line:** *Palantir Gotham's graph, built by an agent from the open web, one investigation at a time.*

## 2. The finished product, as experienced

### 2.1 Surfaces
| Surface | What it is |
|---|---|
| **Investigations** | The unit of work. Each has a seed, a goal, a scope policy, a budget, a status, and a graph. |
| **Canvas** | The Iron-Man view. Force / hierarchical / timeline / map layouts; click node → dossier; click edge → claim + source quote; drag to expand; filter by type/time/confidence. |
| **Dossier** | Per-node page: resolved identity, aliases, every attribute with provenance, relationships grouped by type, timeline, sources, open questions ("negative space"), confidence summary. |
| **Query bar** | One box, three modes auto-detected: structural (`neighbors of X`, `path X→Y`, `who lived at A before 2019`), natural-language grounded prose with citations, and raw SQL/Cypher. |
| **Frontier** | Live view of what the planner is about to do and why; approve / deny / reprioritize hops; pin "must find" questions. |
| **Watch** | Any investigation becomes a standing monitor: re-run on schedule, diff the graph, alert on new nodes/edges/attribute changes/removed sources. |
| **Reports** | Dossier / PDF / Markdown / JSON-LD / CSV / GraphML export; every claim footnoted to its source. |
| **API + MCP** | Everything above is an endpoint; an MCP server exposes `investigate`, `expand`, `query`, `dossier`, `watch` so Claude or any agent drives it. |
| **Admin** | Workspaces, users/roles, scope policies, audit log, retention, deletion requests, cost dashboards. |

### 2.2 A full investigation, end to end
1. Analyst opens a new investigation: seed = `"Jane Doe", teaches at Lincoln Middle School, Springfield IL`; goal = **"Map professional network and public affiliations"**; scope policy = `professional_context` (§5.9); budget = 300 pages / $8 / 3 hops.
2. Governance gate evaluates goal + policy + seed type → allowed, with attribute classes `home_address`, `minor`, `health`, `financial` **redacted at extraction**.
3. Planner emits the initial frontier: name search across engines, school website staff directory, local news archive, state teacher-license lookup (public record).
4. Fetchers pull pages (static → headless browser → archive fallback). Each page stored raw + text + hash.
5. Extractor turns each page into **claims**: `(mention "Jane Doe") —works_at→ (mention "Lincoln Middle School") {role:"7th grade science", since:2016, quote, url, span}`.
6. Resolver merges mentions into entities: identity keys first (email, handle, profile URL, license #), then name + corroborating context; ambiguous pairs go to a review queue and stay split until confirmed.
7. Planner scores the new frontier by goal-relevance × novelty ÷ cost; expands "Lincoln Middle School" (principal, board minutes, PTA) and the license registry; **skips** "Springfield, IL" as a hop (hub node, low relevance).
8. Stops at budget or when frontier relevance drops below floor; writes a **coverage report** ("found: employer, 2 co-workers, 1 conference talk, university; not found: employer 2010–2016 — gap").
9. Analyst opens the canvas. Asks `who else at Lincoln MS presented at the same conference?` → structural query, answered from edges, no LLM. Asks `summarize her professional trajectory` → grounded prose with 9 claim-level citations.
10. Analyst sets a weekly Watch and exports a dossier. The audit log holds the goal, policy, every fetch, LLM call, merge, query, and export.

## 3. Product principles (these settle arguments later)
1. **Every fact has a source, a verbatim quote, a timestamp, and a confidence.** No source → not stored.
2. **Goal-directed, budget-bounded.** There is no "crawl everything"; only "answer this, within this."
3. **A split is recoverable, a merge is not.** The resolver is conservative; humans confirm hard merges.
4. **Structure answers first, LLM synthesizes second.** Most questions are edge traversals.
5. **Time is first-class.** Every edge has `valid_from / valid_to / observed_at`. "Lived at" is an interval.
6. **Governance is a pipeline stage, not a policy doc.** Scope policies are enforced in code at plan time and extraction time.
7. **Own the canonical graph.** The client system is a resolution/query engine we sync into, not the system of record (§6).

## 4. Ontology

### 4.1 Node types
Extensible via a schema registry, not code. Initial set:
`Person · Organization (company, school, agency, nonprofit, club) · Place (address, city, region, country, coordinates) · Property (parcel) · Event (conference, hearing, incident, fair, election) · Document (article, post, filing, record, transcript, page) · Account (email, phone, handle, domain, username) · Artifact (photo, video, paper, patent, product) · Position (reified role when it has its own attributes) · Asset (vehicle, vessel, aircraft) · Credential (license, degree, certification) · LegalMatter (case, filing) · MoneyFlow (donation, contract, grant)`

### 4.2 Edge types — all directional, all with an inverse label, all carry properties
| Edge | Inverse | Properties |
|---|---|---|
| `works_at` | `employs` | role, department, valid_from, valid_to |
| `studied_at` | `educated` | degree, field, valid_from, valid_to |
| `lives_at` | `residence_of` | valid_from, valid_to, kind (owner/tenant) |
| `located_in` | `contains` | — (address→city→region→country; transitive) |
| `related_to` | same | relation (parent/child/spouse/sibling/…) |
| `associated_with` | same | context, strength, evidence_count |
| `participated_in` | `had_participant` | role (speaker/attendee/organizer), date |
| `authored` | `created_by` | date |
| `mentions` | `mentioned_in` | span |
| `owns` / `controls` | `owned_by` | share, valid_from, valid_to |
| `member_of` | `has_member` | role, valid_from, valid_to |
| `same_as` / `not_same_as` | same | confidence, method, reviewer |
| `adjacent_to` (places) | same | distance_m — derived |
| `funded` | `received_from` | amount, currency, date |
| `preceded_by` (at an address, in a role) | `succeeded_by` | — derived |

### 4.3 The claim model — extraction produces claims; the graph is a view over them
```
Claim {
  id, investigation_id,
  subject_mention, predicate, object_mention | literal,
  properties: { ... },                          # edge / attribute properties
  source: { url, fetched_at, content_hash, span_start, span_end, quote },
  extractor: { model, prompt_version },
  confidence: 0..1,
  attribute_class: public | sensitive | restricted,   # governance tag
  status: raw | resolved | rejected | redacted
}
Mention  --(resolver)-->  Entity { id, type, canonical_name, aliases[], identity_keys{}, merged_from[] }
Edge = aggregation of Claims between two Entities with one predicate (evidence_count, date bounds, max confidence)
```
Claims are immutable and append-only. Entities and edges are **rebuilt from claims** by a deterministic
job. That is what makes re-resolution, un-merging, and redaction possible.

## 5. Capabilities — what / why / how it works / implementation

Layered bottom-up. IDs are referenced by the build plan (§7).

### 5.1 Acquisition (A)
- **A1 Multi-strategy fetcher.** *What:* the text of any URL. *How:* cascade — plain HTTP + readability extraction → headless Chromium (Playwright, proxy pool) on JS-only/403 → Wayback / archive.today on paywall or removal → PDF/DOCX/image through the document + OCR path. Store raw bytes, text, hash, headers, fetch method. *Impl:* worker pool, per-domain rate limiter, robots.txt policy flag, retry/backoff, content-hash dedupe.
- **A2 Search adapters.** *What:* query → candidate URLs. *How:* pluggable providers (Brave / Bing / Google CSE / SerpAPI; Exa or Tavily for semantic web search) with query templates per entity type (`"Jane Doe" "Lincoln Middle School"`, `site:linkedin.com/in "Jane Doe" Springfield`). *Impl:* provider interface, result normalizer, cross-provider dedupe.
- **A3 Structured-source connectors.** *What:* high-precision data that isn't a web page. Corporate registries (OpenCorporates, SEC EDGAR, state SoS), courts (CourtListener / PACER), campaign finance (OpenFEC), property / assessor records, professional licensing boards, patents (USPTO), academic (OpenAlex, ORCID), public social profiles (official APIs where they exist, headless otherwise), domain / WHOIS / DNS, breach-index presence (boolean only), Wikidata, news archives (GDELT). *Impl:* each connector is `{ supports(entityType), query(entity) → Claim[] }` — it emits claims directly, no extraction step. The campaign-intel intern's ~17 tools are the seed of this library.
- **A4 Media pipeline.** OCR for scans, speech-to-text for video/podcast mentions, reverse-image search as a *lead generator* (never identity proof), EXIF.
- **A5 Source store.** Every fetched artifact is content-addressed and retained per policy; an investigation can be replayed from cache without refetching.

### 5.2 Extraction (X)
- **X1 Schema-constrained LLM extraction.** *What:* page text → `Claim[]`. *How:* the prompt is generated from the ontology registry so the model can only emit known types/predicates; structured output; **every claim carries a verbatim quote validated against the source text** — hard reject otherwise (the hallucination gate already proven in `the client loader/extract.mjs`). Chunk with overlap, merge across chunks. *Impl:* Sonnet for bulk, Opus/Fable for low-confidence re-extraction; prompt versioning; per-page cost logged.
- **X2 Page classification.** Cheap pre-pass (Haiku): `profile | article | directory | record | forum | irrelevant` + relevance-to-goal → decides extraction depth or skip. Cuts extraction spend by roughly half.
- **X3 Attribute-class tagging.** Each claim is tagged `public / sensitive / restricted` against a fixed taxonomy (home address, phone, DOB, government IDs, health, minors, orientation, religion, immigration status, financial accounts…) so governance (§5.9) can redact **before persistence**.
- **X4 Temporal normalization.** "since 2016", "last spring", "former" → `valid_from / valid_to` with precision flags, anchored to page date.
- **X5 Geocoding.** Addresses → canonical components + coordinates; builds `located_in` automatically.
- **X6 Self-check.** A second pass reads each claim against its quote and sets `verified`; disagreement lowers confidence.

### 5.3 Entity resolution (R)
- **R1 Identity-key matching.** Same email / phone / handle / profile URL / license # / ORCID / registry ID ⇒ same entity. Auto-merge.
- **R2 Contextual name matching.** Same normalized name **plus** ≥1 corroborating context (employer, city, co-mention, timeframe) ⇒ auto-merge. Same name alone ⇒ **stays split**, flagged. Surname-only never merges.
- **R3 Blocking + scoring.** Candidate pairs from blocking keys (name phonetics, location, org); scored on string similarity, context overlap, temporal plausibility, embedding similarity. Thresholds: auto-merge / review / reject.
- **R4 Review queue.** Humans (or a stronger model in review mode) decide candidates; decisions persist as `same_as` / `not_same_as` claims so re-resolution respects them.
- **R5 Un-merge.** Delete the `same_as` claim, rebuild. Free, because entities are views.
- **R6 Cross-investigation registry.** Workspace-level identity so one person found in two investigations is one node — policy-gated, since some workspaces must keep investigations isolated.

### 5.4 Graph store (G)
- **G1 Canonical store.** Postgres for claims / sources / entities / audit (append-only), with a property-graph projection for traversal (Apache AGE on the same Postgres in v1; Neo4j or Memgraph if traversal load demands). Edges materialized from claims by an idempotent build job.
- **G2 Bitemporal edges.** `valid_*` = world time, `observed_at` = when we learned it. Every query accepts `as_of`.
- **G3 Derived edges.** Computed, not extracted: `adjacent_to` (geo), `preceded_by / succeeded_by` (same address or role, disjoint intervals), `co_*` (shared employer / event / author), transitive `located_in`.
- **G4 Embeddings.** pgvector on nodes and documents for semantic search, similar-entity, and planner novelty scoring.
- **G5 Snapshots + diff.** Every build is a snapshot; `diff(a, b)` → added / removed / changed nodes, edges, attributes. Watch (§5.7) is built on this.
- **G6 client-system sync.** Push resolved entities and edges as typed evidence to a client-system workspace; read back via `/search` + SQL `/query`; reconcile URNs ↔ our IDs. See §6.

### 5.5 Planner / agent (P)
- **P1 Goal model.** Structured: `{ intent: map_network | locate | verify | due_diligence | timeline | self_audit, focus_entity, target_predicates[], must_answer[], exclude[] }`. Free text is compiled to this by an LLM and shown to the user for confirmation before anything runs.
- **P2 Frontier.** Priority queue of actions — `search(q)`, `fetch(url)`, `connector(name, entity)`, `expand(entity, predicate)` — scored `relevance_to_goal × expected_novelty × source_quality ÷ cost`, decayed by hop distance from the focus.
- **P3 Hop policy.** Per node type: which expansions are permitted and to what depth (people: all; orgs: leadership / staff / press only; cities: never — they are hubs). Sensible defaults, per-investigation overrides.
- **P4 LLM next-steps.** After each batch, a planner model reads coverage state (unmet `must_answer`, timeline gaps, unresolved candidates) and proposes queries templates would not ("search the 2019 district board minutes — the article says she spoke there"). Proposals enter the frontier through the same scorer.
- **P5 Stop conditions.** Budget (pages / $ / time), frontier score under floor, all `must_answer` satisfied, or user stop. Emits coverage report + negative space.
- **P6 Human-in-the-loop modes.** Approve-everything, auto, and "ask me when" rules (before expanding a minor, before any paid connector, before any residence lookup).
- **P7 Replay / resume.** The plan is an event log: pause, resume, re-run under a different policy over cached sources.

### 5.6 Query (Q)
- **Q1 Structural.** Neighbors, k-hop, paths, filtered traversals, interval queries (`who lived at A during 2015–2018`), inverse lookups (address → residents; org → members over time), co-occurrence (`people sharing ≥2 events with X`). Cypher/SQL underneath; exposed as named templates + raw mode.
- **Q2 Semantic.** Vector search over nodes and documents; "entities similar to X".
- **Q3 Natural-language grounded.** LLM plans a structural query, runs it, writes prose with **citations to claims** (not pages). Refuses to go beyond the graph.
- **Q4 Routing.** Classifier picks Q1 / Q2 / Q3 per question; Q1 whenever expressible.
- **Q5 Saved questions.** Persisted per investigation; they become the checks Watch re-runs.

### 5.7 Monitoring (W)
- **W1 Scheduled re-run** with the same plan over cached sources plus a fresh search pass.
- **W2 Diff → alerts** on new nodes / edges / attribute changes / disappeared sources (a removed page is a signal).
- **W3 Delivery:** email, Slack, webhook, MCP notification.

### 5.8 Visualization (V)
- **V1 Canvas.** WebGL graph (Sigma.js or Cosmograph): thousands of nodes at 60 fps; layouts force / hierarchical / geo (map tiles) / timeline. Edge width = evidence count, color = type, opacity = confidence; time scrubber applies `as_of`.
- **V2 Expand in place.** Node context menu → "expand: employer / residence / associates" → planner action → nodes animate in.
- **V3 Dossier panel** with drill-down claim → quote → highlighted source page.
- **V4 Compare view.** Two snapshots or two investigations side by side.

### 5.9 Governance (L) — enforced in code, not in a document
- **L1 Scope policies.** Named policies on workspaces and investigations: `unrestricted` (owner workspace default — private individuals included; everything stored, everything audited), `self_audit`, `public_figure`, `organization_only`, `professional_context` (redact residence / family / minors), `consented_subject` (consent artifact uploaded), `licensed_investigator` (workspace tier + legal-basis field). The **planner refuses** out-of-policy actions; the **extractor redacts** tagged attribute classes before storage. Which policy is the default for a second user is decided after the legal walkthrough (§9 open items).
- **L2 Jurisdiction rules.** GDPR (legitimate-interest record, access / erasure endpoints, EU residency option), CCPA, FCRA guardrail (not a consumer report — policy and ToS block employment / credit / tenancy screening), documented per-source scraping posture with per-connector on/off.
- **L3 Audit log.** Immutable: who ran what, goal, policy, every fetch, LLM call, merge, query, export.
- **L4 Erasure / opt-out.** Subject request → tombstone all claims about the entity across investigations, hashed denylist blocks re-acquisition, propagates to the client-system workspace.
- **L5 Access control.** Workspaces, roles (admin / analyst / viewer), per-investigation ACLs, SSO.
- **L6 Abuse detection.** Volume anomalies on private-individual seeds, mandatory goal statements, reviewer sampling.
- **L7 Retention.** Raw sources and claims expire per workspace policy; exports watermarked with investigation ID.

### 5.10 Platform (F)
- **F1 API.** REST + SSE progress streams; OpenAPI; per-workspace keys.
- **F2 MCP server.** Tools `start_investigation`, `get_status`, `expand`, `query_graph`, `ask`, `dossier`, `watch`, `export`; investigation graphs as resources. This makes Claude Code — or any agent — the operator.
- **F3 Jobs.** Queue (BullMQ or Temporal) for fetch / extract / resolve / build; horizontal workers; per-investigation concurrency caps.
- **F4 Cost accounting.** Every LLM / search / proxy / connector call metered per investigation → budgets enforced (P5), shown live.
- **F5 Observability.** Traces per investigation; quality dashboards (quote-validation reject rate, resolver review rate, coverage vs goal).
- **F6 Eval harness.** ~10 hand-built gold investigations → entity/edge precision & recall, merge accuracy, planner efficiency (facts per $). Runs in CI; every prompt or model change is scored.
- **F7 Deployment.** Cloud SaaS plus self-host (docker-compose) for orgs that cannot send subjects to a vendor.

## 6. The client system — the decision

**The client system is a resolution-and-query engine we sync into, not the system of record.** From two months of
measured use (the client system's docs):
- The client system does **not** extract entities from pushed documents. We push typed entities/edges — so §5.2–5.3 are ours either way.
- Only affiliation-style edges (`member_of`) land today; no dated / money / directional edges. The §4 ontology cannot live there yet.
- Builds are async, roughly daily, unobservable; no change feed; no enumeration primitive; triggers gated. Frontier (§5.5) and Watch (§5.7) cannot depend on it.
- What the client system is **uniquely** good at: resolved cross-source entities with deterministic `/search` + SQL, and — when the user's own Gmail / Slack / Calendar are connected — **joining an investigation's public-web graph to the user's private-world graph** ("who in my network already knows this person?"). No OSINT tool has that. That is why the bridge exists.

So: **G1 is ours.** G6 (push resolved entities as `contact` / `company` / `article` evidence, verify by SQL, `external_ask` for the private-world join) is **deferred and optional** (decision 2026-08-29: "not now, too tough"). It lives in M8 behind a flag and is written from scratch — no code lifted from the client's loader. If the client system ships dated typed edges, a change feed, and enumeration, G6 widens; nothing else changes.

## 7. Working backwards — milestones (each proves what the next depends on)

| # | Milestone | Proves | Capabilities |
|---|---|---|---|
| M0 | **Claim pipeline** — 1 seed, curated URLs, claims with validated quotes in Postgres, queryable by SQL | Extraction + claim model are sound | A1, X1, G1 (claims only) |
| M1 | **Resolved graph** — entities/edges materialized, un-merge works, CLI queries (neighbors, dossier) | Resolution + views-over-claims | R1–R5, G1–G3 |
| M2 | **Planner** — goal → frontier → approve-each-hop run → coverage report; auto mode behind a flag | The agent loop | A2, X2, P1–P7, F4 |
| M3 | **Connectors + media** — structured sources, OCR / transcription, geocoding, temporal normalization | Precision beyond web pages | A3, A4, X4, X5 |
| M4 | **Query** — structural / NL / semantic routing, saved questions, AGE projection | The graph answers questions | Q1–Q5, G4 |
| M5 | **Governance + legal** — policies enforced at plan + extract time, audit log, erasure (after the legal walkthrough) | Safe to widen scope / add a user | X3, L1–L4, L6–L7 |
| M6 | **Canvas** — WebGL graph, dossier drawer, provenance drill-down, expand-in-place | The Iron-Man view | V1–V3 |
| M7 | **Watch** — snapshots, diffs, scheduled re-runs, alerts | Standing value, not one-shot | G5, W1–W3 |
| M8 | **Platform** — API, MCP, evals in CI, shared registry, optional client-system sync, multi-tenant | Others can build on it / use it | F1–F7, R6, L5, (G6) |
| M9 | **Polish** — geo / timeline layouts, compare view, reports, self-host | Final product | V4, exports |

Rule: nothing in M(n) is designed so that M(n+1) must undo it. Concretely: the claim model (§4.3), the
policy hook points (§5.9), and the plan event log (P7) exist from M0 even when the only policy is
"unrestricted" and the only planner mode is "approve each hop".

## 8. Non-goals / explicit exclusions
- Not a consumer background-check product (FCRA). Not for employment / credit / tenant screening.
- No covert access: no credential use, no private-account access, no breach-data *contents* (presence only), no CAPTCHA farms.
- No face recognition as identity. Reverse image produces candidates for the resolver, never an auto-merge.
- No "index the United States." Global coverage emerges from many bounded investigations sharing an entity registry (R6), never from an unbounded crawl.
- No user-facing latency that depends on the client system's build cycle.

## 9. Decisions log

**2026-08-29 — the maintainer's answers to the first question round**
1. **First user is the maintainer.** Built for him; others later. Multi-tenant, roles, SaaS deployment move to the end of the plan. One workspace until then.
2. **Own project.** Not the client's IP. The client system may become a customer/partner later; nothing is given away. Client-system sync (G6) is **deferred and optional** — the canonical graph is ours, and no design decision may depend on the client system.
3. **Private individuals are in scope** — explicitly interesting, not excluded. Governance still exists as a *mechanism* (policies, audit, redaction hooks) but the owner workspace runs an `unrestricted` policy by default. Legal posture (GDPR etc.) to be talked through together before any second user — see the open item below.
4. **Own the graph: yes.** Client-system bridge: not now.
5. **Shared world graph vs isolated investigations** — open, the maintainer asked what it means; see open item.
6. **Autonomy:** approve-each-hop mode first (we choose together while building), auto-within-budget as the eventual default.
7. **Canvas comes near the end; polish last.** Everything before it is CLI / MCP / SQL driven.
8. **Stack approved** (TypeScript, single Postgres with pgvector + AGE, pg-boss, later Next.js + sigma.js). Priority: power and flexibility.
9. **Spend during build:** ≈ ≤ $300/month is fine.
10. **Legal:** the maintainer wants to learn and decide together — open item.
11. **Time:** no deadline; no week estimates in the plan.
12. **No code reuse** from the client's intern or `loader/`. This is a clean, independent codebase. Learnings may be reused; code may not.
13. **Name:** "WorldGraph" is a working title.
14. **Process:** git repo from day one, small commits, clean and organized; build slowly, checking the vision at each step.

**Open items**
- *Shared world graph (Q5).* Decide whether entities persist across investigations in one world graph (the "map the United States" idea — every run enriches the same graph) or each investigation is an isolated graph merged only on request. See the explanation in the 2026-08-29 conversation; design supports both via the workspace registry (R6).
- *Legal posture (Q10).* Walk through GDPR / CCPA / FCRA / scraping ToS together; then set the default policy and what the product must do for erasure and access requests.
- *Licensed data-broker connectors.* Interface exists; none enabled until decided.
- *Graph DB.* Postgres + AGE + pgvector; revisit only if traversal p95 > 200 ms on 100k-edge investigations.
