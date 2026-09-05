"""Export the fine-tuned TriBERTa model (ml/triberta-min) to ONNX for in-process TS serving (research/14 rung 1).
Produces ml/triberta-onnx/{onnx/model.onnx, tokenizer.json, config.json, ...} — the layout transformers.js loads
in Node, so the resolver's learned proposer runs with NO Python at runtime (packages/plan/src/embed.ts).

Regenerate the whole chain:
    pnpm wg export-records ml/records.jsonl   # dump provisional records (labels = judge clustering)
    python ml/train.py                        # fine-tune SBERT on our casework
    python ml/export_onnx.py                  # -> ml/triberta-onnx (this script)

Requires: pip install "optimum[onnxruntime]" (plus sentence-transformers, torch)."""
import os, shutil
from sentence_transformers import SentenceTransformer

SRC, OUT = "ml/triberta-min", "ml/triberta-onnx"
if os.path.exists(OUT):
    shutil.rmtree(OUT)
# backend="onnx" traces the transformer to ONNX; save_pretrained persists it + tokenizer + config
m = SentenceTransformer(SRC, backend="onnx")
m.save_pretrained(OUT)
assert os.path.exists(os.path.join(OUT, "onnx", "model.onnx")), "ONNX export did not produce onnx/model.onnx"
print(f"exported {SRC} -> {OUT}/onnx/model.onnx")
