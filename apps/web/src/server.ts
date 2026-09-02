// wg serve — the local WorldGraph app. Reads graphs straight from Postgres for viewing, and DRIVES the system by
// spawning the real `wg` CLI (investigate / agent / ask / search) and streaming its output to the browser over
// SSE. No API keys or DB ever leave the machine. Mobile-first UI in app.html.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, listInvestigations, investigationStats, deleteInvestigation } from "@worldgraph/db";
import { why } from "@worldgraph/knowledge";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const APP = readFileSync(path.join(HERE, "app.html"), "utf8");

const json = (res: ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

async function graphOf(inv: string) {
  const entities = await query(`SELECT id, canonical_name name, type, kind, claim_count claims, identity_keys keys, aliases FROM entities WHERE investigation_id=$1`, [inv]);
  const links = await query(`SELECT l.id, l.src_id s, l.predicate p, l.predicate_specific ps, l.dst_id o, l.qualifiers q, l.grade, l.reliability rel, l.credibility cred, l.independent_origins origins, l.evidence_count ec, l.contested, l.derived, to_char(l.valid_from_lo,'YYYY-MM-DD') vf, to_char(l.valid_to_hi,'YYYY-MM-DD') vt, to_char(l.date_lo,'YYYY-MM-DD') dl FROM links l WHERE l.investigation_id=$1`, [inv]);
  const attrs = await query(`SELECT a.id, a.entity_id e, a.key, a.key_specific ks, a.value, a.grade, a.reliability rel, a.credibility cred, a.independent_origins origins, a.contested FROM attributes a WHERE a.investigation_id=$1`, [inv]);
  const [src] = await query<{ n: string }>(`SELECT count(*) n FROM sources WHERE investigation_id=$1 AND status='extracted'`, [inv]);
  const q = await query<{ subject_entity_id: string | null }>(`SELECT subject_entity_id FROM questions WHERE investigation_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`, [inv]);
  return { entities, links, attrs, sources: Number(src?.n ?? 0), subject: q[0]?.subject_entity_id ?? null };
}

/** Run a `wg` subcommand and stream its stdout/stderr to the client as SSE. */
function stream(res: ServerResponse, args: string[]) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (ev: string, data: string) => { if (res.writableEnded || res.destroyed) return; try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client went away */ } };
  // spawn node + tsx directly: on Node ≥ 20 spawning `pnpm.cmd` without a shell throws EINVAL on Windows
  const tsx = path.join(REPO, "node_modules/tsx/dist/cli.mjs");
  const child = spawn(process.execPath, [tsx, path.join(REPO, "apps/cli/src/main.ts"), ...args], { cwd: REPO, env: process.env });
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
      for (const i of rows) {
        const st = await investigationStats(i.id).catch(() => null);
        const [e] = await query<{ n: string }>(`SELECT count(*) n FROM entities WHERE investigation_id=$1`, [i.id]);
        const [r] = await query<{ n: string }>(`SELECT count(*) n FROM notes WHERE investigation_id=$1 AND kind='report'`, [i.id]);
        out.push({ id: i.id, title: i.title, seed: i.seed, goal: i.goal_text, status: i.status, created_at: i.created_at, stats: st, entities: Number(e?.n ?? 0), reports: Number(r?.n ?? 0) });
      }
      return json(res, out);
    }
    const g = p.match(/^\/api\/graph\/([0-9a-f-]+)$/);
    if (g) return json(res, await graphOf(g[1]!));
    const w = p.match(/^\/api\/why\/([0-9a-f-]+)\/(link|attribute|entity)\/([0-9a-f-]+)$/);
    if (w) return json(res, await why(w[1]!, w[2] as "link" | "attribute" | "entity", w[3]!));
    const notes = p.match(/^\/api\/notes\/([0-9a-f-]+)$/);
    if (notes) return json(res, await query(`SELECT kind, title, body, created_at FROM notes WHERE investigation_id=$1 AND kind IN ('report','note','plan','lead') ORDER BY created_at DESC LIMIT 60`, [notes[1]!]));
    const hyp = p.match(/^\/api\/hypotheses\/([0-9a-f-]+)$/);
    if (hyp) return json(res, await query(`SELECT id, status, pattern, evidence, updated_at FROM hypotheses WHERE investigation_id=$1 AND kind='free' ORDER BY created_at`, [hyp[1]!]));

    if (p === "/api/create" && req.method === "POST") {
      const b = await readBody(req);
      const args = ["investigate", "--seed", String(b.seed ?? ""), "--kind", String(b.kind ?? "person"), "--goal", String(b.goal ?? "")];
      if (b.url) args.push("--url", String(b.url));
      return stream(res, args);
    }
    const agent = p.match(/^\/api\/agent\/([0-9a-f-]+)$/);
    if (agent && req.method === "POST") { const b = await readBody(req); const a = ["agent", agent[1]!]; if (b.ceiling) a.push("--ceiling", String(b.ceiling)); if (b.model) a.push("--agent-model", String(b.model)); return stream(res, a); }
    const ask = p.match(/^\/api\/ask\/([0-9a-f-]+)$/);
    if (ask && req.method === "POST") { const b = await readBody(req); return stream(res, ["ask", ask[1]!, String(b.q ?? "")]); }
    const search = p.match(/^\/api\/search\/([0-9a-f-]+)$/);
    if (search && req.method === "POST") { const b = await readBody(req); return stream(res, ["search", search[1]!, "--q", String(b.q ?? ""), "--num", "10", ...(b.fetch ? ["--fetch", String(b.fetch)] : [])]); }
    const del = p.match(/^\/api\/investigations\/([0-9a-f-]+)$/);
    if (del && req.method === "DELETE") { await deleteInvestigation(del[1]!); return json(res, { ok: true }); }

    res.writeHead(404); res.end("not found");
  } catch (e) { if (!res.headersSent) json(res, { error: String((e as Error).message) }, 500); else { try { res.end(); } catch { /* already closed */ } } }
});
process.on("uncaughtException", (e) => console.error("[serve] uncaught:", e.message));

const port = Number(process.env.WG_PORT ?? 5590);
const host = process.env.WG_HOST ?? "0.0.0.0";   // reachable from the phone on the LAN / Tailscale
server.listen(port, host, () => console.log(`WorldGraph → http://localhost:${port}  (LAN: http://<this-machine>:${port})`));
