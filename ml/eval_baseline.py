"""Baseline: does an off-the-shelf SBERT embedding separate same-entity from different-entity provisional
records, before any fine-tuning? Reads ml/records.jsonl (name/type/record + canonical entity_id label),
builds positive pairs (same entity) and hard negatives (same type, different entity, similar name), and
reports cosine-similarity separation + ROC-AUC. This is the go/no-go check before training (research 14)."""
import json, sys, random, itertools
from pathlib import Path

random.seed(7)
recs = [json.loads(l) for l in Path("ml/records.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
print(f"{len(recs)} records · {len({r['entity_id'] for r in recs})} entities · {len({r['investigation_id'] for r in recs})} investigations")

# pairs are within one investigation (a graph); label = same canonical entity
by_inv = {}
for i, r in enumerate(recs):
    by_inv.setdefault(r["investigation_id"], []).append(i)

def norm_name(s): return "".join(c.lower() for c in s if c.isalnum() or c == " ").strip()

pos, neg_hard, neg_easy = [], [], []
for idxs in by_inv.values():
    for a, b in itertools.combinations(idxs, 2):
        ra, rb = recs[a], recs[b]
        if ra["entity_id"] == rb["entity_id"]:
            pos.append((a, b))
        elif ra["type"] == rb["type"]:
            na, nb = norm_name(ra["name"]), norm_name(rb["name"])
            # hard negative: shared name token (namesake-ish) but different entity
            if set(na.split()) & set(nb.split()):
                neg_hard.append((a, b))
            else:
                neg_easy.append((a, b))
random.shuffle(neg_hard); random.shuffle(neg_easy)
# balance: as many negatives as positives, favouring hard ones
k = len(pos)
neg = (neg_hard + neg_easy)[: max(k, min(len(neg_hard) + len(neg_easy), 3 * k))]
print(f"positive pairs: {len(pos)} · hard negatives: {len(neg_hard)} · easy negatives: {len(neg_easy)} · using {len(neg)} negatives")
if not pos:
    print("no positive pairs — need entities with >=2 provisional members"); sys.exit(0)

from sentence_transformers import SentenceTransformer
import numpy as np
model = SentenceTransformer("all-MiniLM-L6-v2")
print(f"device: {model.device}")
emb = model.encode([r["record"] for r in recs], normalize_embeddings=True, batch_size=64, show_progress_bar=False)

def cos(a, b): return float(np.dot(emb[a], emb[b]))
pos_s = [cos(a, b) for a, b in pos]
neg_s = [cos(a, b) for a, b in neg]
nh = [cos(a, b) for a, b in neg_hard[:len(pos)]]

def mean(x): return sum(x) / len(x) if x else 0.0
print(f"\ncosine similarity:")
print(f"  same entity   : mean {mean(pos_s):.3f}  (min {min(pos_s):.3f})")
print(f"  diff entity   : mean {mean(neg_s):.3f}")
if nh: print(f"  diff, same name token (HARD): mean {mean(nh):.3f}")

# ROC-AUC (probability a random positive scores above a random negative)
labels = [1] * len(pos_s) + [0] * len(neg_s)
scores = pos_s + neg_s
pairs = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j])
wins = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j] and scores[i] > scores[j])
ties = sum(1 for i in range(len(scores)) for j in range(len(scores)) if labels[i] > labels[j] and scores[i] == scores[j])
auc = (wins + 0.5 * ties) / pairs if pairs else 0.0
print(f"\nROC-AUC (same vs different): {auc:.3f}   (0.5 = useless, 1.0 = perfect)")
# a simple threshold accuracy
best_t, best_acc = 0, 0
for t in [x / 100 for x in range(0, 100)]:
    acc = (sum(1 for s in pos_s if s >= t) + sum(1 for s in neg_s if s < t)) / (len(pos_s) + len(neg_s))
    if acc > best_acc: best_acc, best_t = acc, t
print(f"best single-threshold accuracy: {best_acc:.3f} at cosine >= {best_t}")
