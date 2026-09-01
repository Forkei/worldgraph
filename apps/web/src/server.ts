// wg serve — a local web app for WorldGraph. Reads the graph straight from Postgres for viewing, and DRIVES
// the system by spawning the real `wg` CLI (create / run / search / triage) and streaming its output to the
// browser over SSE. No API keys or DB ever leave the machine.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, listInvestigations, getInvestigation, investigationStats, deleteInvestigation } from "@worldgraph/db";
import { why } from "@worldgraph/knowledge";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const APP = readFileSync(path.join(HERE, "app.html"), "utf8");

const json = (res: ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

async function graphOf(inv: string) {
  const entities = await query(`SELECT id, canonical_name name, type, kind, claim_count claims, identity_keys keys FROM entities WHERE investigation_id=$1`, [inv]);
  const links = await query(`SELECT l.id, l.src_id s, l.predicate p, l.predicate_specific ps, l.dst_id o, l.qualifiers q, l.grade, l.reliability rel, l.credibility cred, l.independent_origins origins, l.evidence_count ec, l.contested, l.derived, to_char(l.valid_from_lo,'YYYY-MM-DD') vf, to_char(l.valid_to_hi,'YYYY-MM-DD') vt, to_char(l.date_lo,'YYYY-MM-DD') dl FROM links l WHERE l.investigation_id=$1`, [inv]);
  const attrs = await query(`SELECT a.id, a.entity_id e, a.key, a.value, a.grade, a.reliability rel, a.credibility cred, a.independent_origins origins, a.contested FROM attributes a WHERE a.investigation_id=$1`, [inv]);
  return { entities, links, attrs };
}

/** Run a `wg` subcommand and stream its stdout/stderr to the client as SSE. */
function stream(res: ServerResponse, args: string[]) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (ev: string, data: string) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const isWin = process.platform === "win32";
  const child = spawn(isWin ? "pnpm.cmd" : "pnpm", ["-s", "wg", ...args], { cwd: REPO, env: process.env });
  const onData = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach((l) => send("log", l));
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => { send("done", String(code ?? 0)); res.end(); });
  child.on("error", (e) => { send("log", "spawn error: " + e.message); send("done", "1"); res.end(); });
  res.on("close", () => child.kill());
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  try {
    if (p === "/" || p === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(APP); }

    if (p === "/api/investigations") {
      const rows = await listInvestigations();
      const out = [];
      for (const i of rows) { const st = await investigationStats(i.id).catch(() => null); out.push({ id: i.id, title: i.title, seed: i.seed, goal: i.goal_text, status: i.status, created_at: i.created_at, stats: st }); }
      return json(res, out);
    }
    const g = p.match(/^\/api\/graph\/([0-9a-f-]+)$/);
    if (g) return json(res, await graphOf(g[1]!));
    const st = p.match(/^\/api\/stats\/([0-9a-f-]+)$/);
    if (st) return json(res, await investigationStats(st[1]!));
    const w = p.match(/^\/api\/why\/([0-9a-f-]+)\/(link|attribute|entity)\/([0-9a-f-]+)$/);
    if (w) return json(res, await why(w[1]!, w[2] as "link" | "attribute" | "entity", w[3]!));

    if (p === "/api/create" && req.method === "POST") {
      const b = await readBody(req);
      const args = ["investigate", "--seed", String(b.seed ?? ""), "--kind", String(b.kind ?? "person"), "--goal", String(b.goal ?? "")];
      if (b.url) args.push("--url", String(b.url));
      else if (b.urls) args.push("--urls", String(b.urls));
      return stream(res, args);
    }
    const run = p.match(/^\/api\/run\/([0-9a-f-]+)$/);
    if (run && req.method === "POST") { const b = await readBody(req); const a = ["run", run[1]!, "--max", String(b.max ?? 4), "--per", String(b.per ?? 3)]; if (b.loop) a.push("--loop", "--passes", String(b.passes ?? 3)); return stream(res, a); }
    const search = p.match(/^\/api\/search\/([0-9a-f-]+)$/);
    if (search && req.method === "POST") { const b = await readBody(req); return stream(res, ["search", search[1]!, "--q", String(b.q ?? ""), "--num", "10", ...(b.fetch ? ["--fetch", String(b.fetch)] : [])]); }
    const tri = p.match(/^\/api\/triage\/([0-9a-f-]+)$/);
    if (tri && req.method === "POST") return stream(res, ["triage", tri[1]!]);
    const del = p.match(/^\/api\/investigations\/([0-9a-f-]+)$/);
    if (del && req.method === "DELETE") { await deleteInvestigation(del[1]!); return json(res, { ok: true }); }

    res.writeHead(404); res.end("not found");
  } catch (e) { json(res, { error: String((e as Error).message) }, 500); }
});

const port = Number(process.env.WG_PORT ?? 5590);
server.listen(port, () => console.log(`WorldGraph UI → http://localhost:${port}`));
