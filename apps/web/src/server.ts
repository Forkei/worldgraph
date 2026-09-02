// wg serve — the local WorldGraph app. Reads graphs straight from Postgres for viewing, and DRIVES the system by
// spawning the real `wg` CLI (investigate / agent / ask / search) as JOBS that outlive the browser: a job keeps its
// output in memory, the phone can leave, reload, come back and replay it, and nothing is killed by a closed tab.
// No API keys or DB ever leave the machine. Mobile-first UI in app.html.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { query, listInvestigations, investigationStats, deleteInvestigation } from "@worldgraph/db";
import { why } from "@worldgraph/knowledge";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const APP = readFileSync(path.join(HERE, "app.html"), "utf8");

const json = (res: ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

// ---------------------------------------------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------------------------------------------
interface Job { id: string; inv: string | null; kind: "agent" | "ask" | "create" | "search"; label: string; args: string[]; status: "running" | "done" | "failed" | "stopped"; lines: string[]; startedAt: number; endedAt: number | null; code: number | null; child: ChildProcess | null; listeners: Set<(line: string | null) => void> }
const jobs = new Map<string, Job>();
const MAX_LINES = 6000;

function startJob(kind: Job["kind"], inv: string | null, label: string, args: string[]): Job {
  const job: Job = { id: randomUUID().slice(0, 8), inv, kind, label, args, status: "running", lines: [], startedAt: Date.now(), endedAt: null, code: null, child: null, listeners: new Set() };
  jobs.set(job.id, job);
  const push = (line: string) => { if (job.lines.length >= MAX_LINES) job.lines.splice(0, 1000); job.lines.push(line); for (const l of job.listeners) l(line); };
  // spawn node + tsx directly: on Node ≥ 20 spawning `pnpm.cmd` without a shell throws EINVAL on Windows
  const tsx = path.join(REPO, "node_modules/tsx/dist/cli.mjs");
  try {
    const child = spawn(process.execPath, [tsx, path.join(REPO, "apps/cli/src/main.ts"), ...args], { cwd: REPO, env: process.env });
    job.child = child;
    const onData = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(push);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => { job.code = code ?? 0; job.endedAt = Date.now(); if (job.status === "running") job.status = code === 0 ? "done" : "failed"; job.child = null; for (const l of job.listeners) l(null); });
    child.on("error", (e) => { push("spawn error: " + e.message); job.status = "failed"; job.endedAt = Date.now(); for (const l of job.listeners) l(null); });
  } catch (e) { push("spawn error: " + String((e as Error).message)); job.status = "failed"; job.endedAt = Date.now(); }
  return job;
}
const jobView = (j: Job) => ({ id: j.id, inv: j.inv, kind: j.kind, label: j.label, status: j.status, lines: j.lines.length, startedAt: j.startedAt, endedAt: j.endedAt, code: j.code });

/** SSE: replay lines from `from`, then follow live until the job ends. Closing the tab never touches the job. */
function streamJob(res: ServerResponse, job: Job, from: number) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (ev: string, data: string) => { if (res.writableEnded || res.destroyed) return; try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client went away */ } };
  for (const l of job.lines.slice(Math.max(0, from))) send("log", l);
  if (job.status !== "running") { send("done", job.status); res.end(); return; }
  const listener = (line: string | null) => { if (line === null) { send("done", job.status); job.listeners.delete(listener); res.end(); } else send("log", line); };
  job.listeners.add(listener);
  res.on("close", () => job.listeners.delete(listener));
}

// ---------------------------------------------------------------------------------------------------------------
// graph reads
// ---------------------------------------------------------------------------------------------------------------
async function graphOf(inv: string) {
  const entities = await query(`SELECT id, canonical_name name, type, kind, claim_count claims, identity_keys keys, aliases FROM entities WHERE investigation_id=$1`, [inv]);
  const links = await query(`SELECT l.id, l.src_id s, l.predicate p, l.predicate_specific ps, l.dst_id o, l.qualifiers q, l.grade, l.reliability rel, l.credibility cred, l.independent_origins origins, l.evidence_count ec, l.contested, l.derived, to_char(l.valid_from_lo,'YYYY-MM-DD') vf, to_char(l.valid_to_hi,'YYYY-MM-DD') vt, to_char(l.date_lo,'YYYY-MM-DD') dl FROM links l WHERE l.investigation_id=$1`, [inv]);
  const attrs = await query(`SELECT a.id, a.entity_id e, a.key, a.key_specific ks, a.value, a.grade, a.reliability rel, a.credibility cred, a.independent_origins origins, a.contested FROM attributes a WHERE a.investigation_id=$1`, [inv]);
  const [src] = await query<{ n: string }>(`SELECT count(*) n FROM sources WHERE investigation_id=$1 AND status='extracted'`, [inv]);
  const q = await query<{ subject_entity_id: string | null }>(`SELECT subject_entity_id FROM questions WHERE investigation_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`, [inv]);
  return { entities, links, attrs, sources: Number(src?.n ?? 0), subject: q[0]?.subject_entity_id ?? null };
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
        const live = [...jobs.values()].some((j) => j.inv === i.id && j.status === "running");
        out.push({ id: i.id, title: i.title, seed: i.seed, goal: i.goal_text, status: i.status, created_at: i.created_at, stats: st, entities: Number(e?.n ?? 0), reports: Number(r?.n ?? 0), live });
      }
      return json(res, out);
    }
    const g = p.match(/^\/api\/graph\/([0-9a-f-]+)$/);
    if (g) return json(res, await graphOf(g[1]!));
    const w = p.match(/^\/api\/why\/([0-9a-f-]+)\/(link|attribute|entity)\/([0-9a-f-]+)$/);
    if (w) return json(res, await why(w[1]!, w[2] as "link" | "attribute" | "entity", w[3]!));
    const notes = p.match(/^\/api\/notes\/([0-9a-f-]+)$/);
    if (notes) return json(res, await query(`SELECT kind, title, body, created_at FROM notes WHERE investigation_id=$1 AND kind IN ('report','note','plan','lead') ORDER BY created_at DESC LIMIT 80`, [notes[1]!]));

    // jobs
    if (p === "/api/jobs") { const inv = url.searchParams.get("inv"); return json(res, [...jobs.values()].filter((j) => !inv || j.inv === inv).sort((a, b) => b.startedAt - a.startedAt).map(jobView)); }
    const jm = p.match(/^\/api\/job\/([0-9a-f-]+)(?:\/(stream|stop))?$/);
    if (jm) {
      const job = jobs.get(jm[1]!); if (!job) return json(res, { error: "no such job" }, 404);
      if (jm[2] === "stream") return streamJob(res, job, Number(url.searchParams.get("from") ?? 0));
      if (jm[2] === "stop" && req.method === "POST") { if (job.child) { job.status = "stopped"; job.child.kill(); } return json(res, jobView(job)); }
      return json(res, { ...jobView(job), tail: job.lines.slice(-200) });
    }
    if (p === "/api/create" && req.method === "POST") {
      const b = await readBody(req);
      const args = ["investigate", "--seed", String(b.seed ?? ""), "--kind", String(b.kind ?? "person")];
      if (b.goal) args.push("--goal", String(b.goal));
      if (b.url) args.push("--url", String(b.url));
      return json(res, jobView(startJob("create", null, `create ${String(b.seed ?? "")}`, args)));
    }
    const agent = p.match(/^\/api\/agent\/([0-9a-f-]+)$/);
    if (agent && req.method === "POST") {
      const b = await readBody(req); const a = ["agent", agent[1]!]; if (b.ceiling) a.push("--ceiling", String(b.ceiling)); if (b.model) a.push("--agent-model", String(b.model));
      if ([...jobs.values()].some((j) => j.inv === agent[1] && j.kind === "agent" && j.status === "running")) return json(res, { error: "an investigator is already running on this case" }, 409);
      return json(res, jobView(startJob("agent", agent[1]!, "investigator", a)));
    }
    const ask = p.match(/^\/api\/ask\/([0-9a-f-]+)$/);
    if (ask && req.method === "POST") { const b = await readBody(req); return json(res, jobView(startJob("ask", ask[1]!, String(b.q ?? "").slice(0, 120), ["ask", ask[1]!, String(b.q ?? "")]))); }
    const del = p.match(/^\/api\/investigations\/([0-9a-f-]+)$/);
    if (del && req.method === "DELETE") { await deleteInvestigation(del[1]!); return json(res, { ok: true }); }

    res.writeHead(404); res.end("not found");
  } catch (e) { if (!res.headersSent) json(res, { error: String((e as Error).message) }, 500); else { try { res.end(); } catch { /* already closed */ } } }
});
process.on("uncaughtException", (e) => console.error("[serve] uncaught:", e.message));

const port = Number(process.env.WG_PORT ?? 5590);
const host = process.env.WG_HOST ?? "0.0.0.0";   // reachable from the phone on the LAN / Tailscale
server.listen(port, host, () => console.log(`WorldGraph → http://localhost:${port}  (LAN: http://<this-machine>:${port})`));
