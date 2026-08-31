# Research 14 — Graph learning for WorldGraph: GNNs, KG foundation models, and what's actually useful

*2026-08-31 · commissioned by the maintainer ("what's missing for the GNN; learn about the cool useful tech"). Grounded
in current papers (arXiv ids linked). The aim is not a lecture — it's: which of this tech earns a place in
WorldGraph, in what order, and what it costs to build.*

## 0. The one-paragraph answer
There is no download-and-go "understands any graph" model yet — **graph foundation models are real but early**
([Comprehensive Survey, 2505.15116](https://arxiv.org/abs/2505.15116)). But the *task-specific* learned models
we actually need — a pair-matcher that replaces our hand weights, a link-predictor that finds gaps, an
embedding that powers `similar` and blocking — are **mature, proven, and buildable now on data we're already
producing**. The right path is a staircase: learned pair-triage first (weeks, cheap), graph embeddings next,
a knowledge-graph foundation model for gap-finding last. Each step trains on our own casework and is judged by
the B³ eval we already have. The LLM stays the reader and the verifier; the graph model becomes the board's
instinct; the deterministic bookkeeping stays the truth between them.

## 1. Three families of graph ML, and where each fits us

**A. Knowledge-graph embeddings** (TransE → RotatE → [NodePiece 2106.12144](https://arxiv.org/abs/2106.12144)).
Give every node and relation a vector so that `head + relation ≈ tail`. Cheap, classic, good for **link
prediction** ("this structure implies an edge that isn't there" = a machine-generated slot) and for a fast
`similar`. Limitation: transductive — the vectors are tied to *this* graph's entities and relations; a new
graph needs retraining. NodePiece fixes the memory blow-up by representing a node from a few "anchor" nodes +
its relation types, which matters at our scale.

**B. Graph neural networks** (GCN → [R-GCN 1703.06103](https://arxiv.org/abs/1703.06103) → GraphSAGE → GAT).
A node's vector is computed from its neighbourhood, recursively. R-GCN is the one built for *relational* graphs
like ours (many edge types). This is what powers **collective entity resolution** (two subgraphs "look like
the same life"), **structural anomaly** ("this node's pattern is off"), and inductive `similar` (works on nodes
unseen at training time). This is the workhorse for WorldGraph.

**C. Graph foundation models (GFMs / KGFMs)** — the 2024-2026 frontier. Pre-train on many graphs, then
generalize to a *new* graph with a *different vocabulary*, zero-shot. For knowledge graphs specifically,
**KGFMs** ([SEMMA 2505.20422](https://arxiv.org/abs/2505.20422); expressivity study
[2502.13339](https://arxiv.org/abs/2502.13339)) can do link prediction on relations they've never seen — e.g.
train on `provides/researches`, predict `produces`. The ULTRA lineage does this by learning from how
*relations interact* (motifs) rather than from fixed entity/relation ids; [2502.13339] shows richer
motifs (triples of relations, not just pairs) make them more expressive. Newest work pushes past text-attributed
graphs: [GTAlign 2607.11374](https://arxiv.org/abs/2607.11374) aligns graph structure to tables for a text-free
GFM; [PLANET 2602.04116](https://arxiv.org/abs/2602.04116) handles multimodal graphs. **Honest read:** these are
research-grade, not a stable dependency; but they're exactly the shape of "an innate understanding of the whole
graph" the maintainer described, and worth tracking. A KGFM is the *endgame* for our gap-finder, not the starting move.

## 2. Entity resolution with learning — the staircase for OUR resolver

Our resolver today: hand-tuned additive weights → bands → hypotheses → LLM judge. The literature gives a clean
upgrade path, and every rung trains on labels we already generate (judge verdicts, owner decisions, gold files,
hard-key-confirmed pairs).

1. **Learned pair-matcher (do first).** Replace the hand weights with a model fit on labelled pairs. Two proven
   flavours: (a) a **feature-based classifier** (logistic regression / gradient boosting over our existing
   `score_parts`) — trivially hostable, interpretable, the honest Fellegi–Sunter successor; (b) an
   **embedding matcher** — [TriBERTa 2411.10629](https://arxiv.org/abs/2411.10629): SBERT sentence-embeddings of
   the entity record, fine-tuned with a **triplet loss** (pull same-entity records together, push different
   apart), beats TF-IDF and raw SBERT by 3–19% and is *robust across datasets*. This is directly what we want:
   it produces a similarity our proposer ranks by, and the embeddings double as **blocking** keys (ANN search
   finds candidate pairs without comparing everything — solves our O(n²) at 100k nodes). It replaces the
   proposer, never the merge authority (§5 of the model stands: propose → verify → decide).
2. **Collective / relational ER (next).** [R-GCN] and entity-alignment methods
   ([RREA 2008.07962](https://arxiv.org/abs/2008.07962)) resolve by *neighbourhood* — two nodes are the same if
   their neighbours align. Note [Similarity Flooding, 2306.02622](https://arxiv.org/abs/2306.02622) shows these
   are all a **fixpoint computation** — which is *exactly* the collective-resolution priority-queue already
   specified in `INVESTIGATION_MODEL §4`. So our design already anticipated this; the GNN is the learned
   version of the loop we hand-wrote.
3. **LLM-assisted matching (we already do this).** [LLM-Align 2412.04690](https://arxiv.org/abs/2412.04690) and
   [2401.03426](https://arxiv.org/abs/2401.03426) use an LLM to judge the hard pairs by selecting the important
   attributes/relations — precisely our door-3 judge. The lesson from these papers matches ours: the LLM is best
   as the *verifier of proposed pairs*, not the generator of all pairs (too expensive, and it hallucinates
   identity). Reserve it for the middle band; let the learned model triage.

**Benchmark caution** ([2205.05889](https://arxiv.org/abs/2205.05889)): standard ER benchmarks over-state
accuracy vs. messy reality — which is why our own **hand-reviewed gold set is the eval that matters**, not a
public F1. This is a direct argument for finishing the `gold/*/entities.yaml` review.

## 3. Beyond ER — the other jobs a graph model does for us
- **Gap-finding by link prediction.** A KG-embedding or KGFM scores missing edges: "a person with this
  neighbourhood almost always has a `spouse`/`employer`/`board_seat` we don't have" → a machine-generated slot,
  ranked by the model's confidence. This is the learned version of our rule-opened slots, and it *adapts to any
  scenario* without hand-written rules — the maintainer's "adapt to anything" concern.
- **Anomaly / attention.** "This node's structure is weird for its type" (degree outlier, missing reciprocal,
  a life-pattern that doesn't hold together) — an unsupervised GNN flags what deserves a human/agent look.
- **Contradiction & propagation.** Soft joint inference (PSL / probabilistic soft logic) resolves oscillating
  contradictions where our greedy passes wobble — a "later" note already in the model.

## 4. What's missing to build the GNN (concrete)
| Need | Status | Work |
|---|---|---|
| Labelled pairs | Hundreds (judge/owner decisions, gold) | Keep running investigations; harvest hard-key pairs as free positives; a few thousand is enough for rung 1 |
| Feature/embedding pipeline | `score_parts` exist as features | Add a record-serializer (entity → text for SBERT); export structural features |
| Training + runtime host | Stack is TypeScript; ML is Python | **Decision needed:** a small **Python sidecar** (FastAPI + PyTorch Geometric or DGL) the TS calls over HTTP, OR train in Python and run inference in TS via **ONNX** (no Python at serve time). Sidecar is simpler to start; ONNX is cleaner to ship. |
| Eval | B³ built (`wg gold eval`) | Just needs the reviewed gold files |
| Tooling | — | [PyTorch Geometric](https://pyg.org) (PyG) or [DGL](https://www.dgl.ai); SBERT via sentence-transformers; ANN via FAISS/hnswlib for blocking |

The MVP does **not** need the GNN — the LLM judge already resolves the middle band cheaply. The GNN is a
cost/scale/quality upgrade: it makes triage smarter (fewer judge calls), blocking scalable (100k+ nodes), and
gap-finding adaptive (no hand rules). Sequence it *after* the loop works, feeding on the loop's decisions.

## 5. Recommended order for WorldGraph
1. **Finish the loop (MVP).** Missions + agents + search/fetch. The LLM is reader + verifier; no graph model yet.
2. **Learned pair-triage** (rung 1): logistic/boosted over `score_parts`, then TriBERTa-style embeddings for
   blocking + similarity. Trains on accumulated decisions; replaces hand weights; keeps propose→verify→decide.
3. **GNN embeddings** (rung 2, R-GCN in a Python sidecar): collective ER, better `similar`, anomaly attention.
4. **KGFM for gap-finding** (rung 3, ULTRA/SEMMA lineage): adaptive, vocabulary-transferable slot generation —
   track the research, adopt when it stabilizes.

Cross-cutting: every hand-set number in the system (resolver weights, ladder rungs, score weights) is
**bootstrap with a removal date** — the learned models retire them one by one, trained on the board's own
casework. That flywheel (propose → LLM verify → decision → better model) is the architecture the maintainer drew:
LLMs read and argue, the graph model holds the graph, the bookkeeping stays deterministic between them.

## Sources
- Graph Foundation Models: [Comprehensive Survey 2505.15116](https://arxiv.org/abs/2505.15116) ·
  [Survey & Beyond 2310.11829](https://arxiv.org/abs/2310.11829) · [GraphFM benchmark 2406.08310](https://arxiv.org/abs/2406.08310) ·
  [OpenGraph 2403.01121](https://arxiv.org/abs/2403.01121) · [GTAlign 2607.11374](https://arxiv.org/abs/2607.11374) ·
  [PLANET 2602.04116](https://arxiv.org/abs/2602.04116)
- KG foundation models: [SEMMA 2505.20422](https://arxiv.org/abs/2505.20422) · [Expressivity/Motif 2502.13339](https://arxiv.org/abs/2502.13339)
- Entity resolution / alignment: [TriBERTa 2411.10629](https://arxiv.org/abs/2411.10629) ·
  [R-GCN 1703.06103](https://arxiv.org/abs/1703.06103) · [RREA 2008.07962](https://arxiv.org/abs/2008.07962) ·
  [LLM-Align 2412.04690](https://arxiv.org/abs/2412.04690) · [LLMs for ER 2401.03426](https://arxiv.org/abs/2401.03426) ·
  [Similarity Flooding 2306.02622](https://arxiv.org/abs/2306.02622) · [Benchmark reality 2205.05889](https://arxiv.org/abs/2205.05889) ·
  [NodePiece 2106.12144](https://arxiv.org/abs/2106.12144)
- Tooling: [PyTorch Geometric](https://pyg.org) · [DGL](https://www.dgl.ai)
