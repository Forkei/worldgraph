// Environment/config. Loads the repo-root .env once. Never logs values.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
loadDotenv({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://worldgraph:worldgraph@localhost:5433/worldgraph",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  firecrawlKey: process.env.FIRECRAWL_API_KEY ?? "",
  serpApiKey: process.env.SERPAPI_KEY ?? "",
  exaKey: process.env.EXA_API_KEY ?? "",
  blobDir: process.env.WG_BLOB_DIR ?? path.join(REPO_ROOT, "data", "blobs"),
};

export function requireEnv(name: keyof typeof env): string {
  const v = env[name];
  if (!v) throw new Error(`missing configuration: ${name} (set it in .env)`);
  return v;
}
