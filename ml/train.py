"""TriBERTa (research 14): fine-tune SBERT with a contrastive/triplet objective so provisional records of the
SAME entity embed close and DIFFERENT entities embed apart — a learned pair-triage/blocking model to replace
hand-tuned resolver weights. Honest eval: split ENTITIES into train/test (no leakage), fine-tune on train
pairs, report ROC-AUC on held-out pairs before vs after. Labels come from our own casework (the judge's
clustering); the model distils that cheaply."""
import json, random, itertools, sys
from pathlib import Path
random.seed(13)

recs = [json.loads(l) for l in Path("ml/records.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
by_inv = {}
for i, r in enumerate(recs):
    by_inv.setdefault(r["investigation_id"], []).append(i)
def toks(s): return set("".join(c.lower() if c.isalnum() or c == " " else " " for c in s).split())

# entity-level split so test pairs are between entities never seen paired in training
ents = sorted({r["entity_id"] for r in recs})
random.shuffle(ents)
cut = int(len(ents) * 0.8)
train_e, test_e = set(ents[:cut]), set(ents[cut:])

def pairs_for(entset):
    pos, neg = [], []
    for idxs in by_inv.values():
        ii = [i for i in idxs if recs[i]["entity_id"] in entset]
        for a, b in itertools.combinations(ii, 2):
            (pos if recs[a]["entity_id"] == recs[b]["entity_id"] else neg).append((a, b))
    return pos, neg

tr_pos, tr_neg = pairs_for(train_e)
te_pos, te_neg = pairs_for(test_e)
random.shuffle(tr_neg); random.shuffle(te_neg)
te_neg = te_neg[: max(len(te_pos), min(len(te_neg), 4 * len(te_pos)))]
print(f"train: {len(tr_pos)} pos / {len(tr_neg)} neg pairs over {len(train_e)} entities")
print(f"test : {len(te_pos)} pos / {len(te_neg)} neg pairs over {len(test_e)} entities")
if not te_pos or not tr_pos:
    print("not enough paired entities to train/eval; gather more casework first"); sys.exit(0)

import numpy as np, torch
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = SentenceTransformer("all-MiniLM-L6-v2", device=dev)
print("device:", dev)

def auc(m):
    emb = m.encode([r["record"] for r in recs], normalize_embeddings=True, batch_size=64, show_progress_bar=False)
    ps = [float(np.dot(emb[a], emb[b])) for a, b in te_pos]
    ns = [float(np.dot(emb[a], emb[b])) for a, b in te_neg]
    labels = [1] * len(ps) + [0] * len(ns); scores = ps + ns
    P = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j])
    W = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j] and scores[i] > scores[j])
    T = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j] and scores[i] == scores[j])
    return (W + 0.5 * T) / P if P else 0.0, sum(ps) / len(ps), sum(ns) / len(ns)

a0, p0, n0 = auc(model)
print(f"\nBEFORE fine-tune  held-out AUC {a0:.3f}  (same {p0:.3f} / diff {n0:.3f})")

# MultipleNegativesRankingLoss: each positive pair, other positives in the batch act as negatives (in-batch)
examples = [InputExample(texts=[recs[a]["record"], recs[b]["record"]]) for a, b in tr_pos]
random.shuffle(examples)
loader = DataLoader(examples, shuffle=True, batch_size=16, drop_last=True)
loss = losses.MultipleNegativesRankingLoss(model)
model.fit(train_objectives=[(loader, loss)], epochs=6, warmup_steps=10, show_progress_bar=False)

a1, p1, n1 = auc(model)
print(f"AFTER  fine-tune  held-out AUC {a1:.3f}  (same {p1:.3f} / diff {n1:.3f})")
print(f"\ndelta AUC: {a1 - a0:+.3f}   separation (same-diff): {p0-n0:.3f} -> {p1-n1:.3f}")
out = "ml/triberta-min"
model.save(out)
print(f"saved fine-tuned model -> {out}")
