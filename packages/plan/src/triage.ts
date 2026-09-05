// TriBERTa integration (research 14): the learned model proposes merge candidates the resolver's name-blocking
// missed (variants, nicknames, same-org-different-name). It now runs IN-PROCESS via an ONNX-exported SBERT
// (embed.ts / transformers.js) — no Python at runtime. The model only PROPOSES; the judge confirms (model §5 —
// nothing merges on a score alone). Both functions degrade to empty (→ hand-blocking resolver) if the model
// or ONNX runtime is unavailable, exactly as the old Python path did.
import { embed, cosine, embedAvailable } from "./embed.ts";

const MODEL = "triberta-onnx";

export interface ModelPair { a: string; b: string; cos: number }
export interface ScoreRequest { records: { id: string; record: string; type: string }[]; min_cos?: number; top_k?: number; same_type_only?: boolean }

/** High-similarity candidate merge pairs (each above min_cos, top-k per record, deduped, best-first). */
export async function modelCandidatePairs(req: ScoreRequest): Promise<{ model: string; pairs: ModelPair[] }> {
  const recs = req.records ?? [];
  if (recs.length < 2) return { model: "none", pairs: [] };
  if (!(await embedAvailable())) return { model: "unavailable", pairs: [] };
  const vecs = await embed(recs.map((r) => r.record));
  if (!vecs) return { model: "unavailable", pairs: [] };
  const minCos = req.min_cos ?? 0.86, topK = req.top_k ?? 8, sameType = req.same_type_only ?? true;
  const ids = recs.map((r) => r.id), types = recs.map((r) => r.type ?? "");
  const n = recs.length;
  const pairs: ModelPair[] = [];
  for (let i = 0; i < n; i++) {
    // neighbours of i by cosine desc, take top-k above threshold (same type if asked), keep i<j to dedupe
    const order = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => cosine(vecs[i]!, vecs[b]!) - cosine(vecs[i]!, vecs[a]!));
    let taken = 0;
    for (const j of order) {
      if (taken >= topK) break;
      if (sameType && types[i] !== types[j]) continue;
      const c = cosine(vecs[i]!, vecs[j]!);
      if (c < minCos) break;
      if (i < j) pairs.push({ a: ids[i]!, b: ids[j]!, cos: Math.round(c * 1e4) / 1e4 });
      taken++;
    }
  }
  const seen = new Set<string>(), uniq: ModelPair[] = [];
  for (const p of pairs.sort((x, y) => y.cos - x.cos)) { const k = p.a + "|" + p.b; if (seen.has(k)) continue; seen.add(k); uniq.push(p); }
  return { model: MODEL, pairs: uniq };
}

export interface Peer { id: string; cos: number }
/** Per-record nearest same-type neighbours by embedding — the substrate for peer-analogy gap finding. */
export async function modelPeers(records: { id: string; record: string; type: string }[], topK = 8): Promise<{ model: string; peers: Record<string, Peer[]> }> {
  if (records.length < 2) return { model: "none", peers: {} };
  if (!(await embedAvailable())) return { model: "unavailable", peers: {} };
  const vecs = await embed(records.map((r) => r.record));
  if (!vecs) return { model: "unavailable", peers: {} };
  const ids = records.map((r) => r.id), types = records.map((r) => r.type ?? "");
  const peers: Record<string, Peer[]> = {};
  const n = records.length;
  for (let i = 0; i < n; i++) {
    const order = [...Array(n).keys()].filter((j) => j !== i && types[j] === types[i]).sort((a, b) => cosine(vecs[i]!, vecs[b]!) - cosine(vecs[i]!, vecs[a]!)).slice(0, topK);
    peers[ids[i]!] = order.map((j) => ({ id: ids[j]!, cos: Math.round(cosine(vecs[i]!, vecs[j]!) * 1e4) / 1e4 }));
  }
  return { model: MODEL, peers };
}
