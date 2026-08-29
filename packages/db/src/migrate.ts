// Minimal forward-only SQL migrator: applies migrations/NNNN_*.sql in order, once each.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTx, query } from "./client.ts";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function migrate(log: (s: string) => void = console.log): Promise<string[]> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query<{ name: string }>(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    await withTx(async (c) => {
      await c.query(sql);
      await c.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
    });
    applied.push(f);
    log(`applied ${f}`);
  }
  if (!applied.length) log("schema up to date");
  return applied;
}
