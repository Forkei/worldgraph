# 20 — The alive system: from "a tool you use" to "a thing that's there"

*2026-09-07. The shift the maintainer named (Batman's Batcomputer, the Tony Stark "already connected" graph): WorldGraph
today is a brilliant investigator you hire per case; the goal is a **presence** — one persistent world that
ingests continuously and comes to you. This is assembly + four primitives on top of what's built, not a rewrite.
The science (claims, deterministic rebuild, resolution, provenance, learned embeddings, ask-the-graph) exists.
What's missing is the SHAPE: a shared graph, an index, a watch, a daemon, a digest — and the discipline to keep
the surfacing few and the scope public.*

Status: DESIGN. Nothing built. Build on a branch; the demo system stays on `main`.

---

## 0. The three MVP pillars (what "alive" minimally means)
1. **One world, not islands** — investigations pour into and read from a shared graph; a case becomes a *lens*.
2. **It never stops** — a `watches` primitive + a scheduler daemon that re-runs watches and ingests nightly.
3. **It comes to you** — a "what's new and relevant since yesterday" digest, surfaced as a few cards.

The GNN novelty ranker (research/14 rung 2) makes the cards *smart*; it is the refinement, not the gate.

## 1. One world — the additive migration (safe by construction)
Today everything is scoped by `investigation_id`. `workspaces` already sits above investigations — so the world
graph is **a designated workspace-level graph**, built additively; nothing about per-investigation runs changes.

- **Investigations stay isolated during a run** (good: a messy live run can't corrupt the world mid-build).
- After a rebuild, a **promotion job** resolves the case's canonical entities against the world graph and links
  them by a `world_id` (a cross-investigation identity). The world graph is the union, deduped.
- Reads: the world graph is queryable across everything; an investigation is a saved subgraph / set of seeds
  over it. `ask-the-graph` gains a world scope.

New/changed schema (additive — no destructive drops):
- `world_entities(world_id, workspace_id, type, canonical_name, identity_keys, member_count, first_seen, last_seen)`
- `world_membership(world_id, investigation_id, entity_id)` — which case-entities map to which world node.
- Global `resolution_decisions` already exist as a table; reuse the same propose→verify→decide, cross-case.

**The linchpin + the hard part: global resolution at scale.** You cannot compare each new entity to a million.
The just-built embeddings (research/14 rung 1, ONNX in-process) are exactly the fix:
- Build an **ANN index** (hnswlib) over world-entity vectors. A new entity → ~20 nearest neighbours → the judge
  confirms. This is the blocking that makes the world tractable. **We have the vectors; we're missing the index.**
- **Precision becomes existential:** a bad merge in a silo hurts one case; in the world it corrupts the map
  permanently and propagates. So resolution precision, provenance, and one-tap reversibility matter MORE here.
  The world graph must be as easy to *correct* as to grow (retract/split already exist — extend to world scope).

## 2. It never stops — `watches` + a scheduler
Two primitives:
- **`watches(id, workspace_id, kind, target, cadence, last_run, created_by, note)`** — a standing instruction:
  watch this entity / domain / handle / query. (the client's intern has this DNA; WorldGraph doesn't yet.)
- **A scheduler daemon** (`wg watchd`, or a durable loop) that wakes on cadence, runs due watches through the
  existing capabilities + search, folds results into the world graph via the normal claim pipeline, and records
  what changed. Small — a loop around machinery that already runs. Must be **durable** (this session's Postgres
  fragility is a warning): run it as a real service, not a killable task.

Cost discipline lives here: watch only what matters; respect `source_cache`; a **decay** notion (down-weight
stale, un-refreshed claims) so the world doesn't collapse under its own weight or API bills.

## 3. It knows what changed — snapshot + diff
To say "the client system just did X," the system must know X is *new*. We already stamp `first_seen`/`last_seen`.
- A lightweight **`world_snapshots`** stamp per ingest cycle; "what's new since T" = claims with `first_seen > T`.
- Change events: new entity, new edge, a watched entity moved/posted/filed, a merge. This feeds the digest.

## 4. It comes to you — the digest ranker + cards
The three cards. The analyst layer, running continuously on the whole world, ranked by **relevance-to-you ×
novelty**, shown as *few* cards (restraint is the product).

- **A "you" in the graph:** a self node + interests, so "relevant" = close to the maintainer or to what he watches,
  not generic importance. New: `interests` / a designated self-entity per workspace.
- **Novelty/surprise:** cheap first (a new edge on a watched or 1-hop entity; a co-occurrence across two
  threads; a passive-DNS sibling lighting up). Smart later (research/14 rung 2 GNN: link-prediction says "this
  edge is surprising given the structure"; anomaly flags the weird node). **This is where the real GNN earns
  its place.**
- **Surface:** a `digest(workspace_id, day, cards[])` + a cards UI in the app (a column beside the graph).
  Each card cites its sources and links into the world graph. Signal-to-noise is the hardest *product* problem:
  three good cards beat thirty; a system that cries wolf is ignored in a week.

## 5. Scope & ethics — a design constraint, not a footnote
A persistent, always-watching graph of real people is the exact place the "public, sourced, read-only,
personal-use" line becomes the whole design. The alive system watches **your interests and public entities** —
companies, domains, public figures, your own footprint — **not** continuous monitoring of private individuals.
Hold this in the architecture: watches are scoped, gated capabilities stay off, and the digest is about *your*
world, not surveillance of a person. This constraint is what keeps the Batcomputer *feeling* without its reach.

## 6. Build order (branch: `alive`)
| phase | deliverable | depends on |
|---|---|---|
| P1 | ANN index over rung-1 embeddings + cross-investigation resolution (world_entities/world_membership/promotion job) | rung-1 ONNX (done) |
| P2 | `watches` + durable scheduler daemon; fold results into the world graph | P1 |
| P3 | snapshot/diff + change events | P1 |
| P4 | digest ranker (cheap novelty × relevance) + cards UI; self/interests | P2, P3 |
| P5 | (refinement) rung-2 GNN novelty/anomaly feeding the ranker | P4 + research/14 |

MVP = P1–P4. P1 is the linchpin and the riskiest (global identity); everything else is a loop or a surface.

## 7. What we're missing, in one list
- the ANN index (have the vectors) + a world/global resolution loop
- a `watches` primitive + a **durable** scheduler (not a killable task)
- snapshot/diff for "what changed"
- a relevance-to-you model (self + interests)
- a novelty score (cheap now, GNN later)
- the digest/cards surface
- decay/forgetting (cost control)
- **precision + reversibility at world scale** (the existential one) and **scope discipline** (the ethical one)

Not missing the science. Missing the shape — and the restraint.
