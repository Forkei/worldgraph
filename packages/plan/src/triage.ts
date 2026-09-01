// TriBERTa integration (research 14): the learned model proposes merge candidates the resolver's name-blocking
// missed (variants, nicknames, same-org-different-name). It runs as a subprocess (ml/score.py) so the graph
// engine stays pure TS and the model stays out of the deterministic rebuild. The model only PROPOSES; the
// judge confirms (model §5 — nothing merges on a score alone).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PYTHON = process.env.WG_PYTHON || "python";

export interface ModelPair { a: string; b: string; cos: number }
export interface ScoreRequest { records: { id: string; record: string; type: string }[]; min_cos?: number; top_k?: number; same_type_only?: boolean }

/** Ask ml/score.py for high-similarity candidate pairs. Resolves to [] if Python/model is unavailable (the
 *  system degrades to the hand-blocking resolver + judge). */
export function modelCandidatePairs(req: ScoreRequest): Promise<{ model: string; pairs: ModelPair[] }> {
  return new Promise((resolve) => {
    let out = "", err = "";
    const py = spawn(PYTHON, [path.join(REPO, "ml", "score.py")], { cwd: REPO });
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", (e) => resolve({ model: "unavailable:" + e.message.slice(0, 60), pairs: [] }));
    py.on("close", (code) => {
      if (code !== 0) return resolve({ model: "error:" + err.trim().split("\n").pop()!.slice(0, 80), pairs: [] });
      try { resolve(JSON.parse(out)); } catch { resolve({ model: "bad-output", pairs: [] }); }
    });
    py.stdin.write(JSON.stringify(req));
    py.stdin.end();
  });
}
