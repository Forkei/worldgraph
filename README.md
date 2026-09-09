# WorldGraph

**An open-source-intelligence engine where every fact is sourced, every edit is reversible, and one agent is in control.**

Give it a subject — a person, a company, a domain, a URL — and an investigator agent works the way a professional does: searches across engines with real operators, reads pages, runs a toolbox of public-record and infrastructure connectors, looks at photos, and builds a typed evidence graph as it goes. Every claim in that graph carries a verbatim quote and its source. Same-name entities are kept apart until evidence joins them. Every merge, split and retraction is recorded and can be undone. You can talk to the investigator mid-run, or ask the finished graph questions in plain language and get cited answers.

It is a personal research tool for **public entities and open sources**: read-only, no logins, no leaked credentials, nothing intrusive.

---

## What it does

- **Investigates.** One agent, ~35 tools, full control: web search (Google via Serper, with SerpAPI/Exa fallbacks, pagination and operators), page reading, `look_at` for photos (a vision model reads text, place and time cues — never identity), and ~30 connectors — DNS/RDAP/certificate-transparency/passive-DNS, Wayback, GitHub, FEC, SEC EDGAR, GLEIF, Wikidata, court records, company registries, Instagram profiles/posts, breach *linkage* (never credentials), and more. It plans, forms hypotheses, keeps a notebook, and decides when it's done.
- **Builds a graph you can trust.** Extraction → claims → deterministic rebuild → resolution → grading. A claim needs a quote and a source. Grades come from *who published* (a publisher ladder) and *how many independent origins* agree — corroborated, established, single-source, unverified, disputed.
- **Refuses to guess identity.** A name is never identity. People and organizations stay separate until an identifier, a judgment with evidence, or an owner decision joins them. Organizations resolve per registrable domain, so two sites with the same brand name don't fuse. A learned pair-matcher (a fine-tuned sentence embedding, served in-process via ONNX — no Python at runtime) proposes merges the rules miss; an LLM judge confirms; nothing merges on a score alone.
- **Is reversible and auditable.** Merges, splits and retractions are decisions with rationale. Sources are archived. `why` explains any fact back to its quotes.
- **Talks.** A mobile-first web app with a live chat to the investigator and an Obsidian-style force graph (tap a node → its evidence). Ask the graph anything; answers are short and cited.
- **Tells you when something's broken.** `wg status` probes every provider's live budget and quota, the database, and which connectors are enabled — and records tool failures, so a dead API key is never a silent failure mid-run.

## How it works

```
acquire   fetch cascade (Firecrawl → HTTP+Readability → Wayback), search engines, ~30 capability connectors
extract   chunk → LLM extraction (Gemini/Anthropic, pluggable) → claims with quotes; vision; the pair judge
knowledge claims → rebuild → resolver (identifiers · judgment · owner) → grades → graph toolkit (ego, paths, timeline, why)
plan      the investigator agent + its tool loop, playbooks, health, triage (learned proposer)
apps/cli  `wg …`        apps/web  the app (chat + graph)
```

Postgres holds everything; a local blob store archives raw pages. Rebuilds are deterministic: the graph is a pure function of claims + decisions, so it can always be regenerated and audited.

## Quickstart

Requires Node 22+, pnpm, Postgres (a bundled local instance is supported), and API keys for at least one LLM and one search provider.

```bash
pnpm install
cp .env.example .env            # add keys: ANTHROPIC_API_KEY or GEMINI_API_KEY, SERPER_API_KEY (or SERPAPI_KEY), …
pnpm pg:start && pnpm db:migrate
pnpm wg status                  # pre-check: providers, budgets, what's enabled

pnpm wg investigate --seed "Some Public Company" --kind org
pnpm wg chat <investigation-id> "Learn everything about it, source every fact."
pnpm wg ask  <investigation-id> "Who controls it, and how do we know?"
pnpm wg serve                   # the app at http://localhost:5590
```

Useful commands: `wg cap <connector> <value>` (run one connector), `wg capabilities` (what's enabled), `wg status` (health), `wg triage <id>` (learned merge proposals → judge), `wg export-html <id>` (a standalone case file), `wg eval` (compare models on gold cases).

## The learned resolver

The resolver's hand-tuned weights are being retired by models trained on the system's own casework (the judge's verdicts and confirmed identifiers are free labels). Today: a sentence-embedding pair-matcher fine-tuned on those labels, exported to ONNX and run inside the TypeScript process, proposing candidate merges for the judge. See `ml/` and `docs/research/14-graph-learning.md` for the staircase (learned triage → graph embeddings → knowledge-graph models) and the honest evals.

## Scope and ethics

Public entities, open sources, personal research. Read-only by construction: it never logs in, never uses leaked credentials, never touches systems. Biometric face search exists as a gated capability and is **off** unless explicitly enabled with a key. Breach data is used for *linkage* between identifiers only — credentials are fingerprinted and never stored. Every write to the graph is recorded and reversible.

## Research

The design is grounded in a set of research notes under `docs/research/` — truth discovery and grading, entity resolution, ontology and time, graph techniques, OSINT pivots, how expert investigators think, capability specs, model evaluation, graph learning. `docs/HANDOFF.md` is the running state of the project; `docs/playbooks/` are the investigator's own methods (search operators, person/org/domain cases, verification, stopping).

## Status

Early and single-user. The investigator, graph, app, health checks and learned resolver are working end to end; a shared cross-investigation "world graph" with standing watches is in progress on a separate branch. Expect rough edges.

## License

MIT — see [LICENSE](LICENSE).
