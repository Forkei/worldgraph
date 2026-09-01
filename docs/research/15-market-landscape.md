# Research 15 — Market landscape: what already exists like WorldGraph

*2026-09-01. Actual web research (SerpAPI + Exa searches, then page fetches — the built-in search budget was
spent, so this used WorldGraph's own search integration + targeted fetches). Goal: who else builds
"name/goal → autonomous investigation → provenance-graded entity graph," where WorldGraph is differentiated,
and the honest competitive risks. Citations are the pages actually read.*

## 0. The one-paragraph read
The space splits into four established categories — enterprise OSINT platforms, people-search/correlation
lookups, web-scale knowledge graphs, and entity-resolution engines — plus a **fast-emerging fifth**: open-source
**autonomous AI-agent OSINT investigators** that decide their own steps and build a typed entity graph. That
fifth category is where WorldGraph sits, and it is real but very young (multiple 2025-26 projects with 3–70
GitHub stars). The concept is "in the air" — so WorldGraph is **not** first on the idea; the edge is execution:
the evidence-grading rigor, the honest provenance, and the learned resolution. The incumbents have the data
(breach dumps, social-platform access, face search, people-search DBs) that WorldGraph deliberately doesn't.

## 1. Enterprise OSINT investigation platforms (operator-driven, AI-assisted)
The big paid players. Transform/link-analysis based: an analyst runs "transforms" and gets a graph; they add
data sources and, increasingly, "AI-powered" assistance — but they are **not autonomous goal-directed agents**.
- **[Maltego](https://www.maltego.com/)** — the classic. Complex link analysis of large datasets; transforms;
  graph. Operator-driven; there's an OpenAI plugin bolt-on. Paid.
- **[Social Links](https://sociallinks.io/)** — 500+ sources (social, messengers, blockchain, dark web),
  **1,700+ extraction methods**, "AI-powered link analysis and automation," search by face/name/phone/email/alias
  (entity resolution), builds digital-identity graphs. Law enforcement in 80+ countries, S&P 500, PIs. Enterprise
  (demo-only pricing). Widely cited as the market leader / closest Maltego replacement.
- **[ShadowDragon (Horizon)](https://shadowdragon.io/resources/best-osint-tools/)** — 600+ sources incl. dark
  web + historical; link analysis, relationship viz, automated monitoring/alerts. Law enforcement, gov,
  corporate security. Enterprise.
- **[Skopenow](https://www.skopenow.com/)** — automated entity profiling for fraud/threat; Fortune 500 + gov.
  Competitors listed as Social Links, Ontic, Planck ([CB Insights](https://www.cbinsights.com/company/skopenow/alternatives-competitors)).
- **Recorded Future, DigitalStakeout, Fivecast, Babel Street, Lampyre, LexisNexis Accurint** — adjacent
  threat-intel / due-diligence / people-aggregation platforms with graphs and some ML.
- Others in the "AI OSINT" wave: **[OSINT Industries](https://www.osint.industries/)**, **[Intrace](https://www.intrace.ai/investigations)**
  (OSINT + case management, "pivot from any lead into search, graph, social").

**Read:** rich data access + browser automation + face search we don't have; operator-driven, not autonomous;
enterprise-priced; "a pile of links" ergonomics that even competitors criticize.

## 2. People-search / correlation lookups (no reasoning, no graph)
Aggregate identifiers into a profile. The "you don't have a privacy problem, you have a **correlation
problem**" category ([dev.to test of 7 AI OSINT agents](https://dev.to/numbpill3d/i-tested-7-ai-osint-agents-on-my-own-digital-footprint-heres-what-they-found-in-4-minutes-27fn)):
**OSINT Industries** (email/phone/name/username → unified profile, "$$$"), **Epieos**, **IntelX**, **Pipl**,
**Spokeo/BeenVerified/Whitepages**, **DeHashed** (breach data), **PimEyes / FaceCheck.ID** (reverse face). All
lookups, no autonomy, no provenance graph. The tested author's takeaway: the threat is *correlation of reused
identifiers*, which is exactly what a graph engine does well.

## 3. Web → knowledge graph (broad crawl)
- **[Diffbot Knowledge Graph](https://www.diffbot.com/products/knowledge-graph)** — the closest on the *tech*:
  a self-updating graph of **10B+ entities** crawled and structured from the whole public web, with **entity
  resolution by data fusion** (Apple = 560+ origins) and a **provenance `origins` field** per fact. But it's a
  **broad crawl, not goal-directed per-subject investigation**, aimed at M&A/sales/market monitoring. Same
  primitives as WorldGraph (typed entities, origins, resolution), opposite shape (whole-web index vs. one
  Question at a time).

## 4. Entity-resolution engines (the hard part, acknowledged)
- **[Senzing](https://senzing.com/knowledge-graph/)** — ER within *your own* data; frames ER as the linchpin:
  "when different nodes represent the same entity … it's not knowledge, it's disconnected data," and resolves
  even without shared identifiers. Financial crime, KYC, intelligence units. Also **Quantexa** (contextual
  decision intelligence + ER for finance) and **[Tilores](https://tilores.io/solutions/knowledge-graphs/)**.
- **Read:** the whole industry agrees ER is the make-or-break — which validates WorldGraph's heavy investment
  in the resolver + judge + learned triage. These vendors do ER *on the customer's data*, not autonomous web
  investigation.

## 5. The emerging category — autonomous AI-agent OSINT (where WorldGraph lives)
Open-source, 2025-26, very early, and **converging on WorldGraph's exact design**:
- **[kipi](https://github.com/assafkip/kipi)** — the closest analog seen. An autonomous investigator agent
  ("pulls WHOIS/DNS/certs/live pages, pivots, lands typed nodes"), **evidence grading (DNS = A; analyst reads =
  leads only)**, **full provenance (how each node entered: ingest/enrichment/agent/analyst)**, time-bounded
  edges that update on re-observation, per-case ontology with human approval, real graph analytics
  (betweenness, Louvain, shortest-path). Its own pitch: *"Most OSINT output reads like a pile of links. This
  reads like a case."* — nearly WorldGraph's thesis. **But:** ~68 stars / 4 commits (very early), and
  **infrastructure-OSINT focused** (domains/certs) rather than people/web-content.
- **[nexus-osint](https://github.com/sayan9168/nexus-osint)** — "LangGraph-powered agent that decides which
  transforms to run based on graph context," WebGL 3D graph (100k nodes), **semantic vector ER via Qdrant**,
  WebSocket live updates. "Modern open-source Maltego alternative with first-class AI." ~3 stars / 3 commits.
- **deepdive, spectre-graph, Osintgraph (Instagram-focused), OWASP SocialOSINTAgent, INVESTIGATOR (Devpost)** —
  more of the same wave: autonomous agents → entity graphs, mostly toy/early.

**Read:** the idea is proliferating fast. First-mover on the *concept* is gone. Nobody in this cluster is mature.
The differentiator is **execution quality**.

## 6. Where WorldGraph is differentiated
Against the emerging agents (the real peers), WorldGraph's distinctive, defensible combination:
- **Two-axis Admiralty evidence grading + the publisher ladder** (reliability derived from the publisher's
  relationship to the fact, not a hardcoded site list) — more principled than kipi's fixed "DNS=A" table.
- **Origin-independence by provenance** (same publisher/attribution = one origin) so corroboration is honest.
- **"Merge only on evidence"** resolution: hand-blocking → LLM judge → **learned TriBERTa triage** (proposes,
  judge decides), reversible decisions, no auto-merge on a score. Most peers do vector-similarity ER that can
  silently over-merge.
- **Answer-from-the-graph-first** autonomous loop; **no-hardcoding** discipline; **own the graph**.
- **Private-individual / personal use** — the enterprise players explicitly serve law enforcement/gov/finance;
  the personal "investigate on my own terms" niche is underserved.
Against the enterprise players: autonomous (not operator-driven), cheap, self-hosted, extensible capabilities —
at the cost of their data access.

## 7. Honest risks
- **Data moat.** Incumbents have breach data, social-platform access, face search, people-search DBs — gated
  legally/commercially. WorldGraph's grey-only, own-session approach caps reach; the richest signals (Instagram
  likes, face match, breach correlation) are exactly the gated ones.
- **Crowded idea.** Multiple 2025-26 autonomous-agent projects; the concept isn't novel, only the rigor is.
- **Legal/ethical.** Person investigation faces rising scrutiny (this is the parked governance work).
- **Enterprise ER incumbents** (Senzing/Quantexa) are far ahead on resolution at scale if they ever point at
  the web.

## 8. Implications for the roadmap
- **Lean into the rigor** — grading, provenance, reproducibility, honest resolution. That's the one thing the
  "pile of links" tools and the toy agents don't have, and even a competitor (kipi) sells on it.
- **The learned resolver is the moat** *if* the data flywheel runs (more investigations → labels → GNN). Keep it.
- **Cost/latency matters** for the personal-use niche (enterprise buyers don't care; individuals do) — worth
  optimizing now (in progress).
- **Depth + cross-links** (the current MVP gap) are table stakes vs. Social Links/Diffbot.
- Watch **kipi** and the LangGraph agents — nearest peers; borrow good ideas (graph-analytics: centrality,
  community detection), and out-execute on evidence honesty.

## Sources (read for this report)
Maltego · Social Links · ShadowDragon · Skopenow (+ CB Insights) · OSINT Industries · Intrace · Diffbot KG ·
Senzing · Tilores · dev.to "7 AI OSINT agents" · GitHub: kipi, nexus-osint · plus search-surfaced: deepdive,
spectre-graph, Osintgraph, OWASP SocialOSINTAgent, espectrosint & shadowdragon "best OSINT tools 2026" lists.
(Search via SerpAPI + Exa; detail via page fetches, 2026-09-01.)
