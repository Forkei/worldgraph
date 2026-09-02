# Handoff — capability build-out + the processing phase

*Written 2026-09-02 for the next session. Covers (1) where we are, (2) the vision and the steers behind it,
(3) all remaining capabilities to build, (4) the processing phase that makes it OP, (5) the decisions waiting on
the maintainer, and (6) how to run/verify. Companion docs: `research/16` (broad capability catalog), `research/17`
(live-verified capability specs), `ROADMAP.md` (§B is the depth work), `INVESTIGATION_MODEL.md` (the graph model).*

---

## 0. The one-paragraph state
WorldGraph is the maintainer's autonomous OSINT investigation engine (name/goal → agents search/read/curate →
provenance-graded typed entity graph). The loop, grading, resolution, and a local web UI already work. This
session added **Wave 1 of the capability arsenal** — 21 data-in "tools" (domain/infra, people/email, media/geo),
each a pure, tested, self-rate-limited runner emitting a uniform graded `CapabilityResult` with pivot-values.
They are built, tested (111/111 project tests green), and runnable by hand (`wg cap`), but **not yet committed**
and **not yet wired into the loop**. The next big arc is the **processing phase**: chain the pivots, write
capability facts into the graph, and make the loop *pursue* instead of *checklist*.

## 1. The vision (why we're doing this) — don't lose this
the maintainer's bar: the tool should be **"actually OP, basically magic,"** not "noob-level lookup." Today it behaves
like a diligent research assistant (reads the first ~10 Google results, writes a tidy sourced summary, stops when
a checklist about the seed subject is satisfied). Magic = a **relentless intelligence analyst**:
- **Relentless pursuit** — every discovered fact is a lead, not a checkbox; chase threads deep; run until the
  world saturates or budget stops it; massively parallel and cheap.
- **The pivot arsenal** — name→email→breach→reused-username→hidden-accounts→domains. The correlation superpower;
  finds what isn't on page 1. (Wave 1 is the start of this.)
- **Detective inference** — form hypotheses ("these shells share a registrant → one owner"; "gap + incorporation
  → failed startup") and hunt to confirm/refute.
- **Graph as insight** — comes back with analysis done: key connectors (centrality), clusters (community
  detection), the surprising N-hop link. Reads like a dossier, not a link pile.
The trustworthy substrate (grading, provenance, resolution) is what makes the magic *believable* — keep it.

**Standing steers from the maintainer (apply these):**
- **Data-in first, then processing.** Nail capabilities, then the pursuit/inference/graph brain.
- **Push into darker** — build the darker-than-grey *data-access* sources (breach-record aggregators, brokers,
  face search) behind a gate, on-by-default for his private use. **Hard line (mine, non-negotiable):** reading
  data only — never intrusion or fraud (no account login with stolen/guessed creds, phishing, malware,
  social-engineering, auth bypass). That's not where the magic is anyway.
- **Extract everything** — a real map of the world; over-extraction is fine, even wanted. (One nuance: aggregate
  *recurring-identical* facts — see §5.)
- No hardcoding; power in simplicity; git clean small commits; docs kept in sync; he checks vision at fork points
  and pushes back on results.

## 2. What's built (Wave 1) — the current tools
Code: `packages/acquire/src/capabilities/` — `types.ts` (uniform `CapabilityResult`, `GatedCapability`),
`http.ts` (rate-limited helpers), `domain.ts` / `people.ts` / `media.ts`, `index.ts`. Tests:
`packages/acquire/test/capabilities/*.test.ts` (46 parse tests, deterministic fixtures). Registry rows:
`packages/db/src/capabilities.ts` (`SEED`). CLI: `wg cap <id> <input> [--json]` and `wg caps` in
`apps/cli/src/main.ts`. Full specs + live-verified endpoints: `research/17`.

- **Cluster A — domain/infra (all keyless, ON):** `infra.rdap`, `infra.dns`, `infra.cert_transparency`
  (certSpotter, crt.sh fallback), `infra.wayback`, `infra.urlscan` (search), `infra.reverse_ip` (CDN-gated,
  weak), `infra.asn` (RIPEstat→IPinfo→BGPView), `infra.web_primitives`.
- **Cluster B — people/email:** `people.gravatar` ✅, `people.fec` ✅, `people.academic` ✅ (OpenAlex/ORCID),
  `people.username` ✅ (native WhatsMyName, 716 sites, bounded concurrency), `people.breach` (HIBP catalog
  keyless; account-check needs `HIBP_API_KEY`), `people.email_pattern` (**OFF** — needs `HUNTER_API_KEY`),
  `people.relatives` (WikiTree — shape assumed).
- **Cluster C — media/geo:** `media.exif` (ExifTool subprocess — needs the binary), `media.reverse_image`
  (SerpAPI Lens/Yandex/Bing, our key), `geo.geocode` (Nominatim), `geo.map` (Overpass), `geo.chronolocation`
  (inline SunCalc + Open-Meteo), `geo.aircraft` (OpenSky).
- **Declared-not-built (gated), in `GATED_PEOPLE`/`GATED_MEDIA`:** `people.broker`, `people.breach_records`,
  `people.enrichment`, `media.face_search`, `geo.ai_geolocation`, `geo.vessel`.

Every runner is a pure `parseX` (tested) + an `async` fetch fn. Uniform output: `entities`, `edges`,
`attributes`, `pivots` (typed new values), `provenance` (source, url, ISO time, grade A/B/C/low, tier, gated,
note). This is what maps onto `core`'s `ExtractionOutput` and thus the graph.

## 3. TRACK A — remaining capabilities to build
### 3a. Wave 2 — keyed (adapters mostly exist; need a key + a live test)
- `people.email_pattern` (Hunter, free 25/mo) · `people.breach` account-check (HIBP, $4.39/mo) · `infra.asn`
  IPinfo token (free, lifts limits) · certSpotter token (free, full history) · **VirusTotal passive-DNS** (free
  key — the *right* sibling-finder, replaces reverse-IP) · **SecurityTrails** (DNS history/subdomains/reverse-
  WHOIS) · Mapillary + Sentinel Hub (street/satellite, free keys).
### 3b. Wave 3 — gated / darker (the maintainer wants; needs the gate mechanism + keys, some paid)
- People-search brokers (Spokeo/BeenVerified/TLO) · breach-record aggregators (DeHashed/IntelX/Snusbase) ·
  enrichment (PeopleDataLabs/FullContact) · face search (PimEyes/FaceCheck) · AI-geo (GeoSpy/Picarta) · vessel
  (MarineTraffic). All reading-data-only, behind a per-run gate; face/AI-geo require human confirmation.
### 3c. The big MISSING cluster — Organizations (build this; it's a real gap)
Wave 1 has no org backbone. For company/entity investigations we need: **SEC EDGAR** (filings, keyless),
**OpenCorporates** (global company registry), **Companies House** (UK, free), **GLEIF** (LEI, keyless),
**OpenSanctions/OFAC** (PEP/sanctions, keyless), **OpenOwnership** (UBO), court records (CourtListener),
USAspending/FEC(done)/990s. Mostly free/official (grade A). This also unlocks org-shaped benchmarks.
### 3d. Other high-value from research/16 not yet built
- **Shodan/Censys favicon-hash pivot** — CDN-proof sibling detection (survives Cloudflare where reverse-IP
  fails). High value for the **Trump-scam-domains benchmark**. Keyed.
- Phone (Twilio Lookup / PhoneInfoga) · Holehe/EmailRep (email→accounts) · GitHub Search + TruffleHog (dev
  footprint/secrets) · GDELT/MediaCloud (news) · Etherscan/Arkham (crypto).
### 3e. Shared substrate still to wire (once, benefits all)
`source_cache` cache-first is present (`getCachedSearch`/`putCachedSearch`) but the `wg cap` command runs live
without it — the automated engine (Track B) must cache-first. Gate-flag enforcement, cost/tier/grade stamping
(done in the result), and per-source throttle (done via `rateLimit`) are in place.

## 4. TRACK B — the processing phase (makes it OP)
### B1. Pivot chaining + graph write (highest leverage; the immediate bridge)
- **Map `CapabilityResult` → `core` `ExtractionOutput`/claims → the existing build/rebuild path** so capability
  facts land in the graph with provenance + grade and get *resolved* exactly like page-extracted facts. This is
  the one integration that turns 21 tools from CLI toys into graph contributors. Watch: dedupe vs existing
  claims; capability `source` = API+input for origin-independence; predicate/entity-type vocabulary (see §5).
- **The pivot engine:** when a capability emits a typed pivot-value (`email`/`domain`/`hostname`/`ip`/`username`/
  `image`/`coordinates`), enqueue the enabled capabilities that *consume* that kind. Bounded concurrency, dedupe,
  cache-first, budget cap. This is the chain that produces name→email→username→accounts→domains automatically.
### B2. Relentless pursuit engine (kill the checklist ceiling)
- **Today's limiters (confirmed in code):** gaps are scored only about the *seed subject* (`computeGaps`); fixed
  ≤4 passes; **no neighbor expansion** — `dispatch.ts` deliberately punts it as a "sprawl risk," so discovered
  entities (her institutes, board orgs, spouse, co-founders) never become missions. That's why it feels like a
  lookup.
- **The fix (ROADMAP §B):** indicator/hypothesis-driven expansion — a discovered high-value entity earns its own
  mission *when it serves the Question* (controlled, ranked, not naive); **saturation-based stopping** (run until
  no new facts / budget), not a fixed pass count; **massive parallelism** (the cost work — caching, trimming, 10×
  cheaper — exists precisely to fund wide exploration). Add an evidence-gated `propose_mission`/`same_as` agent
  capability (the Facebook↔Meta rename problem: let the agent assert an alias/rename backed by a quote, judge
  confirms — no hardcoded rename table).
### B3. Inference + graph intelligence (the payoff)
- Abductive **hypotheses** (shared registrant/phone → same owner; timeline gaps → events to find), proposed then
  hunted to confirm/refute.
- **Graph analytics:** centrality (key connector), community detection (Louvain — clusters of associates),
  shortest-path (the surprising N-hop link between two people). kipi does betweenness/Louvain — borrow.
- Output reads like a **dossier**: corroboration/contradiction called out, timeline reconstructed, sources graded.

## 5. Decisions waiting on the maintainer (the forks)
1. **Commit Wave 1?** It's uncommitted on `main`. Suggested clean chunks: framework(types/http) · cluster A ·
   cluster B · cluster C · CLI+registry · docs.
2. **Keys to provision** (only he can): free — Hunter, api.data.gov (FEC), IPinfo, certSpotter, VirusTotal,
   SecurityTrails, Mapillary, Sentinel; paid — HIBP ($4.39/mo), and any Wave-3 darker sources he wants.
   Note: keyed adapters read from `process.env.<NAME>` directly today (not `core/config.ts`) — consider adding
   them to `core/config` for consistency.
3. **Graph vocabulary taste** — the predicates/types the tools emit (`registered_with`, `has_subdomain`,
   `resolves_to`, `donated_to`, `has_account_on`, `appears_on`; types `hostname`/`ip_address`) become graph
   edges once B1 lands. Align to the existing ontology or accept as-is (decide before wiring — cheap now).
4. **Recurring-fact aggregation** — the FEC tool emits ~50 near-identical biweekly-payroll `donated_to` edges;
   DNS emits many opaque verification tokens. Keep-everything (current, matches "extract everything") vs.
   aggregate recurring-identical into one edge with a count/total + dates as qualifiers. Recommendation:
   aggregate recurring-identical, keep singletons verbatim.
5. **Order of the next block** — recommended below.
6. **Darker reach** — which specific gated sources to actually build + fund.

## 6. Recommended path (my take, for discussion)
1. Commit Wave 1.
2. Build the **Organizations cluster** (§3c) — biggest coverage gap, mostly free/official, needed for real
   investigations and org benchmarks.
3. **B1 — pivot→graph wiring** — highest leverage; turns the 21 tools into a chaining engine and makes their
   output visible in the graph (and resolved/graded).
4. **B2 — pursuit engine** — the "stop feeling like a lookup" fix (saturation stopping + gated neighbor
   expansion + parallelism).
5. Wave 2 keys/adapters as they're provisioned; **B3** (inference + analytics) and the gated/darker set after.
6. Then the **Trump-scam-domains benchmark** (seed 2 domains, no goal → infra fan-out) — it exercises A + B1/B2
   + favicon-hash together and is the concrete "is it OP yet" test.

## 7. How to run / verify
```
pnpm wg caps                                   # list capabilities (on/off, needs-key)
pnpm wg cap infra.cert_transparency openai.com # run any tool; --json for raw CapabilityResult
pnpm wg cap people.fec "Casey Sample"
pnpm test        # vitest — 111 passing incl. 46 capability tests
pnpm typecheck   # tsc --noEmit, clean
```
Note: it's `pnpm wg …` (root script), not a global `wg`.

## 8. Honest caveats / TODOs carried forward
- BGPView DNS was unresolvable during the build → `infra.asn` uses RIPEstat primary (+IPinfo). Fixed, but a
  reminder that free infra sources are flaky — cache hard.
- `people.relatives` (WikiTree) response shape is **assumed** — verify against a live call before trusting.
- `geo.chronolocation` needs **UTC-qualified** datetimes (a naive local string reads in the host TZ).
- `media.exif` needs the **exiftool binary** on PATH (returns a graceful note otherwise).
- SunCalc is ~0.1–1° (fine for corroboration, not surveying).
- Keyed/gated adapters are **parse-tested only** — no live test without keys.
- Free-tier quotas are the real constraint (Hunter 25/mo, Nominatim 1/s, SerpAPI ~1000/mo, OpenSky credits) →
  cache-first is core to Track B, not optional.
- Leftover: a throwaway "Casey Sample" investigation may still be in the DB from the deep-dive run
  (`wg forget <id>` to remove); the deep-dive itself is summarized in the session history.
