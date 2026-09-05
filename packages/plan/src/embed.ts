// TriBERTa embedder — the learned entity-resolution model, served in-process (research/14 rung 1). Replaces the
// Python subprocess (ml/score.py) with an ONNX-exported SBERT run natively in Node via transformers.js, so the
// model needs NO Python at runtime and ships with the TS stack. The model only PRODUCES EMBEDDINGS; the merge
// triage (cosine → candidate pairs) and the judge decision stay in TS (model §5 — nothing merges on a score).
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// the ONNX export lives here (train.py + optimum export write it); falls back cleanly if absent
const MODEL_DIR = process.env.WG_EMBED_MODEL || path.join(REPO, "ml", "triberta-onnx");

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist: () => number[][] }>;
let loading: Promise<{ extractor: Extractor; name: string } | null> | null = null;

/** Load the feature-extraction pipeline once. Returns null (never throws) if the model or the runtime is
 *  missing — callers degrade to the hand-blocking resolver, exactly as the old Python path did. */
async function getExtractor(): Promise<{ extractor: Extractor; name: string } | null> {
  if (loading) return loading;
  loading = (async () => {
    if (!existsSync(path.join(MODEL_DIR, "onnx", "model.onnx")) && !existsSync(path.join(MODEL_DIR, "model.onnx"))) return null;
    try {
      const tf = await import("@huggingface/transformers");
      tf.env.allowRemoteModels = false; // never phone home — local model only
      tf.env.localModelPath = path.dirname(MODEL_DIR);
      const extractor = (await tf.pipeline("feature-extraction", path.basename(MODEL_DIR), { local_files_only: true })) as unknown as Extractor;
      return { extractor, name: `triberta-onnx (transformers.js)` };
    } catch (e) { void e; return null; }
  })();
  return loading;
}

export const embedAvailable = async (): Promise<boolean> => (await getExtractor()) !== null;

/** Embed records to L2-normalized vectors (mean pooling + normalize — matches the SBERT training config). */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const e = await getExtractor();
  if (!e || !texts.length) return e ? [] : null;
  const out = await e.extractor(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

/** cosine of two L2-normalized vectors = dot product. */
export function cosine(a: number[], b: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
