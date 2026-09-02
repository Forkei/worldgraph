# Handoff — the arsenal is wired into the loop; next is inference + the benchmark

*Rewritten 2026-09-02 (second session of the day, autonomous overnight run on the maintainer's "you drive"). Covers (1) where
we are, (2) the vision and standing steers, (3) what was built tonight and the decisions taken, (4) what remains,
(5) the forks waiting on the maintainer, (6) how to run/verify. Companion docs: `research/16` (broad capability catalog),
`research/17` (live-verified capability specs incl. §D organizations), `ROADMAP.md`, `INVESTIGATION_MODEL.md`.*

---

## 0. The one-paragraph state
WorldGraph is the maintainer's autonomous OSINT investigation engine (name/domain/org → agents + capabilities → provenance-
graded typed entity graph). Tonight the recommended path from the previous handoff was executed end to end and
**everything is committed on `main`** (nothing pushed): Wave 1 committed in six chunks · **Cluster D organizations**
built (9 sources, 6 keyless live-verified) · **B1 — capability results flow into the graph** through the same
claim path as page facts, with a **pivot engine** that chains typed values cache-first · **B2 — the dispatcher
expands to indicator-linked neighbours** (rings 1–2, ontology-derived, weak-key ban, structural-vs-transactional
routes) and the loop **stops on saturation** instead of a pass count, runs agent missions **in parallel**, and gives
agents `propose_mission` + evidence-gated `same_as` · a **shareable case-file page** (`wg export-html`). Two live
investigations exercised it: Palantir (org seed) and examplerealm.online (domain seed, the maintainer's ask). 165 tests
green, typecheck clean.

## 1. The vision — unchanged, don't lose it
Bar: **"actually OP, basically magic"** — a relentless analyst, not a lookup. Relentless pursuit (every fact is a
lead), the pivot arsenal (name→email→username→accounts→domains…), detective inference (hypotheses hunted to
confirm/refute), graph-as-insight (centrality, communities, the surprising N-hop link), all on a trustworthy
substrate (grading, provenance, resolution — that's what makes it believable).

**Standing steers (apply):** data-in first then processing (done: now processing) · push into darker data-access
sources behind a gate, on for private use — hard line: reading data only, never intrusion/fraud · extract
everything, aggregate recurring-identical · no hardcoding, power in simplicity · small commits, docs in sync ·
he checks vision at fork points and pushes back on results.

## 2. What was built tonight (all committed)
### 2a. Cluster D — Organizations (`packages/acquire/src/capabilities/org.ts`, 32 tests, research/17 §D)
`org.edgar` (SEC profile/filings/former names; ticker file + company-browser HTML for private filers) · `org.gleif`
(LEI + parent/children tree) · `org.wikidata` (orgs AND people; SPARQL resolves linked-item types so founders come
back as persons) · `org.nonprofit` (ProPublica 990) · `org.usaspending` (contracts+grants, aggregated per agency)
· `org.court` (CourtListener dockets+opinions) — keyless, live. `org.companies_house`, `org.opencorporates`
(officer reverse-search = shell-network pivot), `org.sanctions` (OpenSanctions) — keyed, parse-tested.
Probe findings: EDGAR full-text search 403s non-browsers; `cik_lookup` returns 0 hits for everything; OpenCorporates
and OpenSanctions now require keys even to search.

### 2b. B1 — the bridge + pivot engine
- `acquire/capabilities/toExtraction.ts`: `CapabilityResult → ExtractionOutput`. Rendered fact lines are the
  quotes (so spans resolve exact); external ids become `registry_id` identity hints (lei > cik > ein > …) — this is
  why EDGAR + GLEIF + Wikidata **merged into one Palantir entity on the first run**; inverse predicates swap onto
  registry ones (founded_by→founded, led_by→manages, officer_of by role); addresses → `located_in` place mentions;
  emails/handles → `uses_account`; anything unmapped survives as `candidate:<label>` under the root. 17 tests.
- `acquire/capabilities/runners.ts`: one runner table (id → fn, consumed kinds, `auto`, `maxPerRun`) shared by
  `wg cap` and the engine.
- `plan/src/pivot.ts`: `runPivots` — cache-first (`source_cache`, per-capability TTL), per-investigation dedupe
  via the `actions` log, waves by depth with per-kind depth caps (infra deep, name/org 1), bounded concurrency +
  run budget, per-runner caps. `ingestCapability` writes an `api` source with `tier_kind=capability` carrying the
  adapter's grade; `build.ts` honours it as the tier. `harvestPivots` re-arms from the graph (accounts anchored to
  the subject/people/orgs, the subject, its orgs); `seedPivots` from the investigation seed.
- CLI: `wg pivot <inv> [kind:value …] [--depth --max --only --skip --weak --refetch --dry]`; `wg run` fires a
  pivot pass at bootstrap and after every rebuild (also on the ring≤1 entities the dispatcher ranked).

### 2c. B2 — pursuit
- `plan/src/dispatch.ts`: gaps for the subject **and** entities reached through indicator predicates (rings 1–2).
  Which indicators apply to a neighbour is derived from predicate domain/range (no per-type lists). Score =
  weight × kind × ring_decay × link_quality × route. **Weak-key ban:** unverified/disputed links cap attention.
  **Structural vs transactional** (derived from the ontology tree): a counterparty reached via `paid`/`party_to`
  inherits only the indicator that reached it and scores ×0.4 — this cut Palantir's gaps 154→67 and pushed "find
  leadership of the Department of the Army" to the bottom where it belongs.
- `wg run --loop`: stop = *N passes without material change* (question `stability_actions`, default 2);
  `--passes` is an owner ceiling (12), `--budget` an optional USD ceiling; `--parallel 3` agent missions; judge
  failures no longer kill the loop; an agent facing 3 consecutive tool failures is told to finish.
- Agent tools: `propose_mission(entity, objective, why)` → queued, ranked with everything (launched_by=agent);
  `same_as(a, b, url, quote)` → an `aliases` claim on the page's source with the quote — the resolver proposes,
  the judge decides, never a direct merge.

### 2d. Shareable output
`wg export-html <inv> [--out f]` → one HTML file (graph, dossiers, grades, findings sheet, search, embedded
evidence quotes + sources; bottom-sheet on phones). Template `apps/web/src/export.html`.

### 2e. Decisions taken (override if you disagree)
1. **Recurring-fact aggregation** (old §5.4): implemented — ≥3 dated numeric edges with the same triple collapse
   into one (from→to, value=total, qualifiers count/total/first/last). Applied to FEC and USAspending.
2. **Vocabulary** (old §5.3): mapped explicitly in `toExtraction.ts`; new node kinds ride on existing types
   (`legal_case`→`legal_matter`, hostnames/ips→`account`). Unmapped predicates are candidates, never dropped.
3. **Pivot kind `org`** added (org name) distinct from `name` (person).
4. **Capability grade = source tier** (`tier_kind=capability`), overridable by the `source_tiers` domain override.
5. **Reverse-IP self-gates**: asks the ASN first, refuses siblings on CDNs; >40 tenants → a count only. Learned
   live on examplerealm.online (Cloudflare) when the first run dumped ~2,000 unrelated co-hosted domains.
6. SEC EDGAR needs a contact email in the User-Agent: env `SEC_CONTACT_EMAIL` (placeholder otherwise). Set your own in `.env`.

## 3. What remains (in the order I'd do it)
1. **B3 — inference + graph intelligence.** Hypotheses (shared registrant/nameserver/phone → one owner; timeline
   gaps → events), proposed then hunted; centrality / Louvain communities / shortest-path; dossier output that
   calls out corroboration/contradiction and reconstructs the timeline. Nothing of this exists yet.
2. **Wave 2 keys** (only the maintainer can provision): Hunter, HIBP, IPinfo, certSpotter, VirusTotal passive-DNS (the
   right CDN-proof sibling finder), SecurityTrails, Companies House, OpenCorporates, OpenSanctions, CourtListener
   token. Add them to `core/config` (adapters read `process.env` directly today).
3. **Favicon-hash pivot (Shodan/Censys)** — the CDN-proof sibling detector the Trump-scam benchmark needs.
4. **Wave 3 gated/darker** sources (brokers, breach aggregators, face search, AI-geo) behind the gate flag.
5. **The Trump-scam-domains benchmark** (seed two domains, no goal) — `wg investigate --kind domain` + `wg run
   --loop` is now the shape of it; needs favicon-hash + passive DNS to be convincing.
6. Quality follow-ups seen tonight: agents can burn 20 steps retrying a dead search (now capped at 3 failures but
   watch it); nameserver hostnames get DNS-resolved needlessly (low value); `people.username` on a common word
   ("Palantir") fans out to 60+ url pivots (they don't chain further, but they clutter); same-name duplicates
   between RDAP (lowercase) and DNS (as-returned) hostnames; Wikidata `employee_count` emits every dated snapshot
   (by design — "extract everything").

## 4. Forks waiting on the maintainer
1. Keys to provision (§3.2) and which darker sources to fund.
2. Whether ring-2 expansion should stay on by default (`--ring 2`) — it is ranked below ring-0/1 and gated by
   saturation, but it is where cost goes once the subject saturates.
3. The `same_as` design: alias claim + judge (chosen) vs. a direct decision row. The chosen path keeps "LLM
   verdicts are evidence, never decisions" intact.
4. Push `main`? Nothing was pushed.

## 5. How to run / verify
```
pnpm test          # 165 passing (46 capability parse + 32 org + 17 bridge + 7 dispatcher + …)
pnpm typecheck     # clean
pnpm wg caps                                    # list capabilities (syncs SEED rows — run once after pulling)
pnpm wg cap org.wikidata "Palantir Technologies"
pnpm wg investigate --seed "X" --kind organization|person|domain --goal "…" [--urls file]
pnpm wg pivot <inv> [org:"Acme Corp"] [--max 40 --depth 1]
pnpm wg dispatch <inv> [--ring 2 --limit 30]
pnpm wg run <inv> --loop [--passes 12 --max 5 --per 3 --parallel 3 --budget 4 --pivot-max 30]
pnpm wg export-html <inv> --out case.html
```
Live investigations from tonight (delete with `wg forget`): `01a05fdd` "PIVOT-TEST Palantir" (throwaway),
`01a05ff7` "examplerealm.online" (the maintainer's ask; the exported page was published as an artifact).

## 6. Honest caveats
- Network flaked twice tonight (DNS for api.anthropic.com and the search backends) — the loop now survives it,
  but a whole pass can come back empty; the saturation rule then counts it as a quiet pass.
- Capability sources of grade A yield "corroborated A2" on a single claim — that is the existing `grade()`
  semantics for authoritative records, not a bug, but it reads strong for e.g. a Wikidata-derived fact (B2).
- `people.relatives` (WikiTree) shape still assumed; `media.exif` needs the exiftool binary; free-tier quotas are
  the real constraint — cache-first is core.
- `wg sql` needs full UUIDs (prefixes fail); join through `investigations` with `id::text LIKE '01a05ff7%'`.

## 7. Addendum — the maintainer's review of the examplerealm case file (same night)
He spotted three things in the published page; all three are fixed and committed (`89bac3d`):
1. **Same-name fusion.** examplerealm.com (a coaching site) and examplerealm.online (the Minecraft server) merged into
   one "Example Realm" because organizations grouped by normalized name at build time, before the resolver.
   Now: organizations are provisional per identity key (registrable domain, else registry id); different registrable
   domains **conflict** (org-only), same registrable domain **matches** (investors.palantir.com = palantir.com);
   keyless same-name mentions attach only when exactly one keyed record carries that name, otherwise they stay
   their own record and the judge gets a hypothesis per side. Verified on the live graph: three records, 24
   hypotheses for the judge. The same principle should be extended to places/events later (still name-grouped).
2. **No deep dive on the owner.** Alex Sample ("Alexh", itch.io) and the other members were reached only via
   `member_of`/`founded` edges the indicators didn't name. Now: anyone bound *structurally* to the subject is
   reached (family edges excluded per his 2026-09-01 steer), indicators then decide what to look for; the pivot
   harvest also fires the arsenal on those people's names and handles.
3. **Sources not visible.** The OnlyFans "account" came from a WhatsMyName probe of `@example.realm` — a catch-all
   page false positive. Now: a profile must echo the username to count; the `@` is stripped; the page shows source
   chips on every row plus a Sources sheet.
4. **Follow-ups from the second run** (commits `7bd609e`…`89fbda7`+): the pivot harvest walks from a domain seed
   to the org/person that owns or uses it, then harvests their people and handles (this is how `alexhs` got
   probed); two accounts with different identifiers never merge (the judge was spending calls on Cloudflare IP
   pairs); the username probe control-checks every hit with a random name and drops catch-all sites — and drops
   hits whose control could not be checked (non-404 failure). **Caveat:** that last rule is conservative: for
   `example.realm` it dropped Instagram/TikTok hits that were real (those sites block the control), though the
   Instagram account is known anyway from the site itself. A retry-once on the control would recover most of them.
   `wg pivot --refetch` now bypasses the cache. Agents also `propose_mission`ed Alexh, member22 and Kim on
   their own — the pursuit behaviour works; what they find is bounded by how little the open web says about a
   small Minecraft community.

## 8. The investigator (built after the maintainer's "agent in control" steer, same day)
Direction change from him: **nothing automatic; one agent in full control; no sub-agents; hundreds of steps; all
tools, all knowledge; powerful graph read/write; "ask the graph" as a one-shot run of the same tools.**
Built and committed (`955a11a`…): 
- **Search instrument** (`acquire/search.ts`): pages on every engine (Google/Bing/DuckDuckGo/Yandex/Yahoo via
  SerpAPI with the right pagination params, Exa emulated), `lang`, "more pages" flag; an empty result is not an error.
- **Playbooks** (`docs/playbooks/search.md`, `investigator.md`) written from real sources (Google operator docs,
  SEOSLY Bing/Yandex lists, Compass OSINT sheet, X-Ray dorks, SerpApi pagination, Heuer & Pherson ACH/key
  assumptions/devil's advocacy, Bellingcat method, Bazzell), served by `consult_playbook(topic)` (18 topics).
- **`wg agent <inv> [--agent-model sonnet-5] [--ceiling usd] [--steps 600]`** (`plan/src/investigator.ts`): one
  agent, seven tool families — search · read (claims + raw text) · capabilities (all 30 as tools + catalog) ·
  graph read (dossier, ego, paths, timeline, contested, gaps, scoped read-only SQL, why) · graph write (link,
  attribute, same_as, not_same_as, split, retract — quote-backed or recorded+reversible) · thinking (hypothesis
  board, notebook, playbooks) · control (rebuild, judge, cost, finish). Transcript trims old tool results in
  batches (prompt cache stays warm); notebook table `notes` (0019) is durable memory; optional $ ceiling ends
  the run gracefully; no step cap in practice (600).
- **First live run** on examplerealm.online (Sonnet 5 low): 69 steps, 130 tool calls, $1.82, 11 min. It read
  the method, inventoried the graph, chased Alex Sample/Alexh, ran connectors, went to archived pages,
  **retracted the gardening-site fusion itself with a reason**, kept a hypothesis board, and wrote a report
  that meets the domain stopping bar (operator, infrastructure, money flow, three disambiguated homonyms,
  legitimacy assessment with caveats). Report is in `notes` (kind=report).
- Bugs found by that run and fixed: `graph_sql` leaked other investigations (now shadowed by scoped CTEs);
  all decision writers inserted the superseding row *after* pointing at it (FK violation once a prior decision
  existed) — order fixed + `id<>$1` guard in judge, decide, unmerge, split, not_same_as; judge no longer
  spends verdicts on account pairs (an account is its identifier).
**Not yet done from the plan:** the "ask the graph" one-shot entry point (`wg ask <inv> "question"` — same tools,
read-only, ends with an answer); the model eval harness (Sonnet-low did well; Haiku/Gemini/open-weights not yet
compared); a `read_url` that can fetch PDFs/archives explicitly; the old `wg run` loop still exists alongside
(keep for scripted/cheap runs or retire — the maintainer's call).

## 9. Same day, later: mobile app, eval, cleanup
- **`wg serve` is now the mobile app** (`apps/web`): investigations list, new case (goal optional — defaults to
  "learn everything", phrased per kind), graph with bottom-sheet dossier + evidence, **Ask** (the ask-the-graph
  agent, streamed, answers kept in the notebook), **Report**, **Run** (start/stop the investigator, live log).
  Runs are **server-side jobs** that outlive the browser (the first version tied them to the SSE connection and
  killed the investigator when the phone navigated away — real bug, found by the maintainer). Binds 0.0.0.0 so the phone
  reaches it over Tailscale. Node ≥ 20 on Windows: spawn `node` + tsx directly, never `pnpm.cmd`.
- **Model eval** (`wg eval`, `research/18`): Sonnet 5 low is the default investigator model; Haiku is not good
  enough to drive; Sonnet medium finishes early with fewer facts. Gemini/open-weight need a tool loop first.
- **Cleanup**: `wg run` loop and mission agent retired; `wg dispatch` / `wg pivot` remain as tools.
- **Resilience**: the machine's DNS dropped three times today; the tool loop now retries transient API failures
  with backoff (8 attempts, up to ~8 min). Under a longer outage the run fails and must be restarted from the app.
- Small thing seen: the agent sometimes passes a made-up hypothesis id ("h2") — accept ordinals or list ids in
  the board output more prominently.

## 10. 2026-09-03 — the investigation is a conversation (the maintainer's redesign)
His steers after using the app: it felt like an aggregator (top layer), the graph was messy (6 nodes for one
company), tool logs are unreadable, and he wants to *continue* an investigation. His design:
- **One chat per investigation.** The user sends messages; the investigator works and talks back through a
  `send_message` tool (as many messages as the work deserves); `finish` only ends the turn. No report artifact —
  the conversation is the report. "Clear history" = fresh LLM context (graph + notebook remain).
- **Rhythm:** collect → when happy, consolidate (rebuild, duplicates, groups) → assess what's missing/important →
  continue. Not hygiene-after-every-batch (the seed-A run spent a third of its budget on that).
- **Groups are the agent's call, no rules:** `group_entities` / `ungroup`; the graph draws a group as one node
  that explodes on tap and collapses via a chip.
- **Ask-the-graph** stays a sharp read-only analyst and is also a tool the investigator can call (`ask_graph`).
- **Activity feed** in words ("Reading pappers.fr", "Joining X and Y", "Grouping as …"), collapsible, instead of
  a tool log. Answers are short (answer line, ≤4 evidence bullets, one Unknown line, ids as tappable chips).
Built (`0f27a05`+): tables `sessions` / `messages` / `entity_groups` (0020); `runToolLoop` resumes a transcript;
`wg chat <inv> "message" [--fresh]`; server `/api/chat`, `/api/messages`, groups in `/api/graph`; app = Chat + Graph.
Observed on the first turn: the agent went straight to work instead of answering a "quick one" — prompt now says
answer first, in proportion, then work. Watch whether it sends enough messages mid-run.
Still open: B3 (the analyst layer proper: lead finding, timeline, contradictions); brand-vs-legal-name merge
(Acorn / Acorn Capital) is left to the agent via same_as; `wg agent` (one-shot) still exists alongside chat.
