# WorldGraph — roadmap (v2)

*2026-09-01. Replaces the stale `BUILD_PLAN.md` (which was written before the loop existed). Reflects where we
actually are after the MVP, the market research (`research/15`), and the maintainer's steer: right now **optimize, fix,
and harden — no big new features** until the foundation is thorough and cheap. GNN/KGFM wait for more data.*

## Where we are (done)
A working, end-to-end **MVP proof-of-concept**:
- **Substrate:** pages → quote-backed claims → resolved, two-axis-graded, provenance-justified graph;
  publisher-ladder reliability; origin-independence; delete-and-rederive; the toolkit.
- **The loop:** goal → Question (door 1b) → dispatcher (gaps → scored missions) → **mission agents** that search,
  choose URLs, read, and curate → rebuild → judge → repeat → stop. Cold-starts from just a name.
- **Resolution:** hand-blocking → LLM judge (merge only on evidence) → **learned TriBERTa triage** (proposes
  cross-name merges, judge confirms). Auto-merge on score deliberately rejected (Acorn II ≠ Acorn III at 0.94 cos).
- **UI:** `wg serve` local web app — graph, dossier, why-drilldown, and drive the loop from the browser.
- **Measured:** extraction precision ~85% (`wg audit`); rebuild deterministic; ~$1–3.5 per investigation
  (2 passes, ~15 pages) ≈ $0.10–0.20 per page read.

## Now — optimize, fix, harden (current phase)

### A. Cost & latency (the maintainer: "already expensive for what it is")
- ✅ **Agent-loop prompt caching** — cache the rolling conversation prefix + tools (was re-sending the whole
  history at full price each step, ~O(n²)); cache reads now priced correctly.
- **Per-page extraction is the dominant cost** — every `read_url` runs a full Gemini extraction on the whole
  page. Levers: cap page size fed to extraction; consider folding extraction into the agent's (cached) context
  instead of a separate call; Gemini context-caching of the registry prompt; Flash-Lite where quality allows.
- Latency: reads are sequential (fetch + extract + reason). Parallelize fetches within a mission; bound steps.
- Add a per-run **cost/coverage summary** so every investigation reports $ and what it covered.

### B. Depth & thoroughness (the MVP's shallowness)
- **Real stopping** — run until indicators saturate / no new facts, not a fixed pass count; raise budgets.
- **Controlled depth** — reinstate neighbour expansion, but *driven* by indicators/hypotheses (a key
  employer/associate earns its own mission only when it serves the Question); make agents actually
  `propose_mission` on important entities.
- **Cross-entity links** — have the reader extract relationships among *all* entities on a page, not just the
  subject; develop the graph, not a star.

### C. Fixes & quality
- Extraction: attribute-value variants, mention-hint accuracy, recall (needs labelled pages).
- Same-name thin-context under-merges (mitigated by triage; the learned model is the durable fix).
- Test coverage on the DB-bound core (build.ts, agent, repo) via an integration harness.
- Re-run seeds E/C onto current extraction; review the gold files so B³ is a real number.

## Next — the vision features (after the foundation is thorough)
- **Media as a seed** — photos → `depicts`, local reference matching (the original wedding/photo example).
- **Browser recipes** — Instagram/X/Facebook likes, comments, stories via the owner's own sessions (this is
  where private-individual reach comes from; also the incumbents' data moat — `research/15`).
- **Capability acquisition** — propose → test → human-enable new sources/pivots.

## Later — the learned-graph lane (needs the data flywheel)
More investigations → more labels → these become worth training:
- **GNN** — structure-aware collective resolution + anomaly attention.
- **KGFM** — zero-shot link-prediction for adaptive gap-finding (the `wg peers` peer-analogy is the seed).
- Calibrated auto-merge only if/when it's provably safe (currently unsafe — see Acorn funds).

## Cross-cutting / eventual
- Measurement everywhere (B³ on reviewed gold, extraction precision tracking, cost dashboards).
- **Watch** — scheduled re-runs on open slots/hypotheses; diffs; alerts.
- **Governance/legal** — the parked GDPR/erasure/policy work, before widening scope.
- UI polish; saved questions; compare/report views; the "Iron-Man" canvas.

## Market context (research/15, real web research)
Four established categories (enterprise OSINT: Maltego/Social Links/ShadowDragon/Skopenow; people-search
lookups; web-scale KGs: Diffbot; entity-resolution engines: Senzing/Quantexa) **plus an emerging fifth** —
open-source **autonomous AI-agent OSINT investigators** (kipi, nexus-osint, deepdive…), very early, converging
on WorldGraph's design (kipi even has evidence grading + provenance). Implications: the *idea* isn't novel, so
the edge is **execution rigor** (grading, provenance, honest resolution — the one thing the "pile of links"
tools and toy agents lack); the **learned resolver is the moat** if the data flywheel runs; **cost matters** for
the underserved personal-use niche the enterprise players ignore; **depth/cross-links** are table stakes.
