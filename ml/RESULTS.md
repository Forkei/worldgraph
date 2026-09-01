# TriBERTa — learned pair-triage for entity resolution (first look)

*2026-09-01. The first rung of research/14's learning staircase: an SBERT record embedding, fine-tuned on our
own casework, to replace hand-tuned resolver weights and power blocking. Environment: Python 3.12 (miniconda),
torch 2.6, sentence-transformers 4.1.*

## What we did
1. `build.ts` serializes each **provisional record** (a mention-cluster's own name + claims) and tags it with
   the canonical entity it resolved into — the judge's clustering is the label. Persisted to
   `provisional_records`; `wg export-records ml/records.jsonl` dumps them.
2. `ml/eval_baseline.py` — does an OFF-THE-SHELF SBERT already separate same-entity from different-entity
   records? `ml/train.py` — fine-tune with MultipleNegativesRankingLoss on an **entity-level train/test split**
   (no leakage) and measure held-out ROC-AUC before vs after.

## Data (3 gold seeds: Person A, Person E, Person C)
519 provisional records · 445 canonical entities · 30 entities with ≥2 members (the positive pairs).
Labels are our own casework (judge/owner decisions) — distant supervision, not independent gold yet.

## Results
- **Baseline (untrained SBERT), full set:** ROC-AUC **0.80**; same-entity cosine 0.74 vs different 0.57, and
  hard namesake negatives (shared name token, different entity) 0.57. Embeddings separate identity out of the box.
- **Fine-tuned, held-out entities:** ROC-AUC **0.98 → 1.00**; same-entity cosine 0.73 → 0.96; same−diff
  separation 0.43 → 0.66 after 6 epochs. The model learns our identity notion and generalizes to unseen entities.

## Honest caveats
- Small (111 train / 174 test positive pairs). AUC 1.0 reflects an easy-ish test split + our own labels; the
  real bar is human-reviewed gold and harder namesake cases.
- Labels = the judge's clustering, so the model distils the judge cheaply — good for triage, not an independent
  oracle. It PROPOSES; identity still merges only on id / judgment / owner (model §5).
- Ran on CPU; trivially fast at this size.

## Verdict & next
Strong go signal. Next integration steps (future): serve the fine-tuned model (sidecar or ONNX) so the
resolver uses embedding cosine as the proposer + ANN blocking, replacing hand weights; grow labels from every
run; then the GNN (structure-aware) and KGFM (link-prediction gaps) per research/14.

## Integration (2026-09-01): `wg triage`
The learned model is wired in as a **blocking/proposer**, not an auto-merger: `ml/score.py` runs as a
subprocess (TS ↔ Python via `packages/plan/src/triage.ts`), embeds the provisional records, and returns
high-cosine candidate pairs — including ones the resolver's name-blocking never compared. `wg triage <inv>`
feeds each candidate to the **judge**, which confirms or declines. Model proposes, judge decides (model §5).

Run: `WG_PYTHON=<python> wg triage <inv> [--min-cos 0.86] [--limit 30]`. Falls back to base all-MiniLM if
`ml/triberta-min` is absent (regenerate with `wg export-records ml/records.jsonl && python ml/train.py`); if
Python is unavailable it degrades to the hand-blocking resolver + judge with no error.

First run (seed A, min-cos 0.87): model surfaced 13 cross-entity candidates → judge merged **Birch Holdings
Inc ↔ Birch** (a real under-merge name-blocking missed) and correctly declined every Acorn fund vehicle
(Acorn II ≠ III; siblings; AMCD XVII part_of AMCD). 1 merge, 0 bad merges, $0.02.
