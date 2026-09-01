"""Subprocess scorer for the resolver (TriBERTa integration). Reads one JSON request on stdin, writes one JSON
response on stdout. The TS side (packages/plan/src/triage.ts) spawns this in batch during `wg triage`.

Request:  {"records": [{"id": "...", "record": "text"}], "min_cos": 0.86, "top_k": 8, "same_type_only": true}
Response: {"model": "...", "pairs": [{"a": "<id>", "b": "<id>", "cos": 0.93}]}  # high-similarity candidate pairs

Uses the fine-tuned ml/triberta-min if present, else falls back to base all-MiniLM-L6-v2. The model only
PROPOSES candidate pairs; the judge (TS) confirms — nothing merges on this score alone."""
import sys, json, os
from pathlib import Path

def main():
    req = json.loads(sys.stdin.read() or "{}")
    recs = req.get("records", [])
    min_cos = float(req.get("min_cos", 0.86))
    top_k = int(req.get("top_k", 8))
    if len(recs) < 2:
        print(json.dumps({"model": "none", "pairs": []})); return
    from sentence_transformers import SentenceTransformer
    import numpy as np
    tuned = Path(__file__).parent / "triberta-min"
    name = str(tuned) if tuned.exists() else "all-MiniLM-L6-v2"
    model = SentenceTransformer(name)
    ids = [r["id"] for r in recs]
    types = [r.get("type", "") for r in recs]
    emb = model.encode([r["record"] for r in recs], normalize_embeddings=True, batch_size=64, show_progress_bar=False)
    sims = emb @ emb.T
    mode = req.get("mode", "pairs")
    if mode == "peers":
        peers = {}
        for i in range(len(recs)):
            order = [j for j in np.argsort(-sims[i]) if j != i and (types[i] == types[j])][:top_k]
            peers[ids[i]] = [{"id": ids[j], "cos": round(float(sims[i][j]), 4)} for j in order]
        print(json.dumps({"model": os.path.basename(name), "peers": peers})); return
    pairs = []
    n = len(recs)
    for i in range(n):
        # top-k neighbours of i above threshold (excluding self), same type if asked
        order = np.argsort(-sims[i])
        taken = 0
        for j in order:
            if j == i or taken >= top_k:
                continue
            if req.get("same_type_only", True) and types[i] != types[j]:
                continue
            c = float(sims[i][j])
            if c < min_cos:
                break
            if i < j:  # dedupe unordered pair
                pairs.append({"a": ids[i], "b": ids[j], "cos": round(c, 4)})
            taken += 1
    # unique by (a,b)
    seen = set(); uniq = []
    for p in sorted(pairs, key=lambda x: -x["cos"]):
        k = (p["a"], p["b"])
        if k in seen: continue
        seen.add(k); uniq.append(p)
    print(json.dumps({"model": os.path.basename(name), "pairs": uniq}))

if __name__ == "__main__":
    main()
