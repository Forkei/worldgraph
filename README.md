# WorldGraph (working title)

A goal-directed investigation engine. Give it a seed (a name, an address, a domain, a company, a document)
and a goal; it builds — autonomously or hop by hop, within a budget — a typed, temporal, provenance-backed
relationship graph of what is publicly knowable and relevant to that goal, and lets you query, visualize,
and monitor it.

**Status:** design phase. No code yet.

| Document | What it is |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | The full and final product: surfaces, walkthrough, principles, ontology, every capability, decisions log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How each capability works and is implemented: topology, storage, algorithms, prompts, interfaces |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) | Milestones M0–M9 working backwards from the spec, with acceptance tests |
| [`docs/QUESTIONS.md`](docs/QUESTIONS.md) | Question rounds and their answers |

Process: small commits, one concern each; docs stay in sync with what is built; vision checked with the maintainer
at every milestone boundary.
