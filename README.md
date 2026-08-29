# WorldGraph (working title)

A goal-directed investigation engine. Give it a seed (a name, an address, a domain, a company, a document)
and a goal; it builds — autonomously or hop by hop, within a budget — a typed, temporal, provenance-backed
relationship graph of what is publicly knowable and relevant to that goal, and lets you query, visualize,
and monitor it.

**Status:** M0 (claim pipeline) built; see `docs/BUILD_PLAN.md` for what each milestone proves.

## Run it (M0)

```bash
pnpm install
cp .env.example .env            # fill ANTHROPIC_API_KEY / GEMINI_API_KEY / FIRECRAWL_API_KEY
pnpm db:up                       # Postgres via Docker  — or, without Docker/WSL2:
#   download EDB "postgresql-16.x-windows-x64-binaries.zip" → unzip to tools/pgsql, then:
#   tools/pgsql/bin/initdb -D data/pg -U worldgraph --pwfile=<file with "worldgraph"> -A scram-sha-256
#   pnpm pg:start && tools/pgsql/bin/psql -h localhost -p 5433 -U worldgraph -d postgres -c "create database worldgraph"
pnpm db:migrate
pnpm wg investigate --seed "Name" --goal "…" --urls gold/person-a/urls.txt --model gemini-3.7-flash
pnpm wg stats <inv> · pnpm wg claims <inv> --random · pnpm wg source <src> · pnpm wg proposed <inv> · pnpm wg models
pnpm test · pnpm typecheck
```

| Document | What it is |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | The full and final product: surfaces, walkthrough, principles, ontology, every capability, decisions log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How each capability works and is implemented: topology, storage, algorithms, prompts, interfaces |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) | Milestones M0–M9 working backwards from the spec, with acceptance tests |
| [`docs/QUESTIONS.md`](docs/QUESTIONS.md) | Question rounds and their answers |

Process: small commits, one concern each; docs stay in sync with what is built; vision checked with the maintainer
at every milestone boundary.
