#!/usr/bin/env tsx
// wg — WorldGraph CLI (M0): db migrate · investigate · investigations · stats · claims · source · proposed · sql
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { registry, getPolicy, env } from "@worldgraph/core";
import {
  migrate, query, closePool, createInvestigation, getInvestigation, listInvestigations, setInvestigationStatus,
  findSourceByUrl, findSourceByHash, insertSource, updateSourceStatus, getSource, listSources, investigationStats, audit, getTierRows, setTier,
  type SourceRow,
} from "@worldgraph/db";
import { fetchUrl, FsBlobStore, blobKey, sha256 } from "@worldgraph/acquire";
import { extractSource, getModel, hasKeyFor, DEFAULT_MODEL, MODELS } from "@worldgraph/extract";
import { resolveTier, runOriginClustering } from "@worldgraph/knowledge";

const [cmd, sub, ...rest] = process.argv.slice(2);
const flags = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    seed: { type: "string" }, kind: { type: "string", default: "person" }, goal: { type: "string" }, title: { type: "string" },
    urls: { type: "string" }, url: { type: "string", multiple: true }, inv: { type: "string" }, model: { type: "string", default: DEFAULT_MODEL },
    policy: { type: "string", default: "unrestricted" }, limit: { type: "string", default: "30" }, random: { type: "boolean", default: false },
    rejected: { type: "boolean", default: false }, "no-firecrawl": { type: "boolean", default: false }, refetch: { type: "boolean", default: false },
  },
}).values as Record<string, string | boolean | string[] | undefined>;

const s = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
const b = (k: string) => flags[k] === true;
const fail = (msg: string): never => { console.error("error:", msg); process.exit(1); };
const short = (id: string) => id.slice(0, 8);

async function main() {
  switch (cmd) {
    case "db": return sub === "migrate" ? void (await migrate()) : fail("usage: wg db migrate");
    case "investigate": return investigate();
    case "investigations": return investigations();
    case "stats": return stats(sub ?? s("inv"));
    case "claims": return claims(sub ?? s("inv"));
    case "source": return source(sub);
    case "sources": return sources(sub ?? s("inv"));
    case "proposed": return proposed(sub ?? s("inv"));
    case "sql": return sql([sub, ...rest].filter(Boolean).join(" "));
    case "ontology": return ontology(sub);
    case "cluster": return cluster(sub ?? s("inv"));
    case "tiers": return tiers(sub, rest[0]);
    case "models": return console.log(Object.values(MODELS).map((m) => `${m.alias.padEnd(22)} ${m.label.padEnd(26)} $${m.price[0]}/$${m.price[1]} per 1M${hasKeyFor(m) ? "" : "   (no API key)"}`).join("\n"));
    default:
      console.log(`wg — WorldGraph CLI (M0)

  wg db migrate
  wg investigate --seed "Name" [--kind person] --goal "..." --urls urls.txt [--url U ...] [--model ${DEFAULT_MODEL}] [--inv <id>] [--title T] [--refetch]
  wg investigations
  wg stats <inv>
  wg claims <inv> [--limit 30] [--random] [--rejected]
  wg sources <inv>
  wg source <source-id>          text with claim spans marked
  wg proposed <inv>              "other" types/predicates by frequency
  wg models
  wg ontology [predicates|types|keys]   the registry as the extractor sees it
  wg cluster <inv>               recompute origin clusters (independent sources per fact)
  wg tiers [<pattern> <tier>]    list or set source reliability tiers
  wg sql "<select ...>"`);
  }
}

async function investigate() {
  const model = getModel(s("model") ?? DEFAULT_MODEL);
  if (!hasKeyFor(model)) fail(`no API key for ${model.label}`);
  const policy = getPolicy(s("policy") ?? "unrestricted");
  const reg = registry();
  const urlList = [...((flags.url as string[] | undefined) ?? [])];
  if (s("urls")) urlList.push(...readFileSync(s("urls")!, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  if (!urlList.length) fail("give --urls file and/or --url");

  let inv = s("inv") ? await getInvestigation(s("inv")!) : null;
  if (s("inv") && !inv) fail(`investigation ${s("inv")} not found`);
  if (!inv) {
    if (!s("seed") || !s("goal")) fail("--seed and --goal are required for a new investigation");
    inv = await createInvestigation({ title: s("title") ?? `${s("seed")} — ${s("goal")!.slice(0, 60)}`, seed: { kind: s("kind") ?? "person", name: s("seed")!, hints: {} }, goal_text: s("goal")!, policy: policy.name });
    await audit({ investigation_id: inv.id, actor: "cli", action: "investigation.create", detail: { seed: inv.seed, goal: inv.goal_text, policy: policy.name } });
    console.log(`investigation ${short(inv.id)} created: ${inv.title}`);
  } else {
    console.log(`investigation ${short(inv.id)}: ${inv.title}`);
  }
  await setInvestigationStatus(inv.id, "running");
  const blobs = new FsBlobStore();
  const tierRows = await getTierRows();
  const ctx = { investigation: { id: inv.id, seed: inv.seed, goal_text: inv.goal_text }, model, policy, registry: reg, log: (m: string) => console.log(m) };
  const totals = { sources: 0, fetched: 0, failed: 0, relations: 0, attributes: 0, rejected: 0, fuzzy: 0, other: 0, usd: 0, rejectReasons: {} as Record<string, number> };
  console.log(`model: ${model.label} · policy: ${policy.name} · ${urlList.length} urls\n`);

  for (const url of urlList) {
    totals.sources++;
    let src: SourceRow | null = b("refetch") ? null : await findSourceByUrl(inv.id, url);
    if (src && src.status === "failed") {
      totals.failed++;
      console.log(`[failed earlier — use --refetch to retry] ${url}`);
      continue;
    }
    if (src) {
      console.log(`[cached] ${url}`);
    } else {
      process.stdout.write(`[fetch]  ${url} … `);
      try {
        const r = await fetchUrl(url, { noFirecrawl: b("no-firecrawl") });
        const hash = sha256(r.text);
        const dup = await findSourceByHash(inv.id, hash);
        if (dup) { console.log(`same content as ${short(dup.id)} (skipped)`); src = dup; }
        else {
          const key = blobKey(inv.id, hash, r.raw_ext);
          blobs.put(key, r.raw);
          const snapKey = r.rendered ? blobKey(inv.id, hash, "snapshot.html") : null;
          if (snapKey && r.rendered) blobs.put(snapKey, r.rendered);
          const t = resolveTier(safeHost(r.final_url), tierRows);
          src = await insertSource({
            investigation_id: inv.id, url, final_url: r.final_url, domain: safeHost(r.final_url), kind: r.kind, fetch_method: r.method, http_status: r.http_status,
            content_hash: hash, blob_key: key, text: r.text, title: r.title, published_at: r.published_at ? safeDate(r.published_at) : null, lang: r.lang, status: "fetched", error: null,
            meta: { attempts: r.attempts, links: r.links.length }, family_id: t.family_id, tier: t.tier, tier_kind: t.kind, snapshot_key: snapKey, captured_at: new Date(),
          });
          totals.fetched++;
          console.log(`${r.method} · ${r.text.length.toLocaleString()} chars · tier ${t.tier}${t.family_id ? " (" + t.family_id + ")" : ""} · "${(r.title ?? "").slice(0, 60)}"`);
        }
      } catch (e) {
        totals.failed++;
        const msg = String((e as Error).message).slice(0, 300);
        console.log(`FAILED\n         ${msg}`);
        await insertSource({ investigation_id: inv.id, url, final_url: null, domain: safeHost(url), kind: "unknown", fetch_method: "http", http_status: null, content_hash: null, blob_key: null, text: null, title: null, published_at: null, lang: null, status: "failed", error: msg, meta: {}, family_id: null, tier: null, tier_kind: null, snapshot_key: null, captured_at: null });
        continue;
      }
    }
    if (!src?.text) continue;
    const sum = await extractSource(ctx, src);
    if (sum.chunks && sum.skipped === sum.chunks) console.log(`         (already extracted with ${model.label})`);
    await updateSourceStatus(src.id, "extracted");
    totals.relations += sum.relations; totals.attributes += sum.attributes; totals.rejected += sum.rejected; totals.fuzzy += sum.fuzzy; totals.other += sum.candidates; totals.usd += sum.usd;
    for (const [k, v] of Object.entries(sum.rejectReasons)) totals.rejectReasons[k] = (totals.rejectReasons[k] ?? 0) + v;
  }
  const oc = await runOriginClustering(inv.id);
  console.log(`\norigins: ${oc.claims} claims → ${oc.clusters} origin clusters over ${oc.facts} facts (${oc.multiOrigin} facts with ≥2 independent origins)`);
  await setInvestigationStatus(inv.id, "done");
  await audit({ investigation_id: inv.id, actor: "cli", action: "investigate.run", detail: { model: model.id, urls: urlList.length, ...totals } });
  const kept = totals.relations + totals.attributes;
  console.log(`\n== ${short(inv.id)} · ${model.label}`);
  console.log(`sources: ${totals.sources} (${totals.fetched} fetched, ${totals.failed} failed) · claims kept: ${kept} (${totals.relations} relations, ${totals.attributes} attributes) · rejected: ${totals.rejected} (${kept + totals.rejected ? ((100 * totals.rejected) / (kept + totals.rejected)).toFixed(1) : 0}%) · fuzzy: ${totals.fuzzy} · candidates: ${totals.other} · spent this run: $${totals.usd.toFixed(3)}`);
  if (Object.keys(totals.rejectReasons).length) console.log(`reject reasons: ${Object.entries(totals.rejectReasons).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const st = await investigationStats(inv.id);
  console.log(`investigation total: ${st.relations} relations, ${st.attributes} attributes, ${st.rejected} rejected, $${Number(st.usd).toFixed(3)}`);
}

async function ontology(which?: string) {
  const reg = registry();
  if (!which || which === "predicates") console.log(reg.promptGuide().split("\n\nATTRIBUTE KEYS")[0]);
  if (which === "types") for (const [k, s] of Object.entries(reg.nodeTypes)) console.log(`${k.padEnd(14)} ${s.kinds.join(", ")}`);
  if (which === "keys") for (const [k, s] of Object.entries(reg.attributeKeys)) console.log(`${k.padEnd(16)} ${s.datatype}/${s.temporal_kind}${s.attribute_class !== "public" ? "  " + s.attribute_class : ""}`);
  console.log(`
registry hash ${reg.hash} · ${reg.extractablePredicates.length} extractable predicates · ${reg.nodeTypeNames.length} node types · ${reg.attributeKeyNames.length} attribute keys`);
}

async function cluster(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg cluster <inv>");
  const oc = await runOriginClustering(inv.id);
  console.log(`${oc.claims} claims → ${oc.clusters} origin clusters over ${oc.facts} facts · ${oc.multiOrigin} facts with ≥2 independent origins`);
  const top = await query<{ fact: string; origins: string; claims: string }>(
    `SELECT (subject->>'name') || ' —' || predicate || '→ ' || (object->>'name') fact, count(distinct origin_cluster_id) origins, count(*) claims
       FROM relation_claims WHERE investigation_id=$1 AND status='raw' GROUP BY 1 HAVING count(*) > 1 ORDER BY origins DESC, claims DESC LIMIT 12`, [inv.id]);
  for (const t of top) console.log(`  ${String(t.origins).padStart(2)} origins / ${String(t.claims).padStart(2)} claims  ${t.fact}`);
}

async function tiers(pattern?: string, tier?: string) {
  if (pattern && tier) { await setTier(pattern, tier.toUpperCase(), null, null); console.log(`set ${pattern} → ${tier.toUpperCase()}`); }
  for (const r of await getTierRows()) console.log(`${r.tier}  ${r.pattern.padEnd(28)} ${(r.kind ?? "").padEnd(11)} ${r.family_id ?? ""}`);
}

async function investigations() {
  for (const i of await listInvestigations()) {
    const st = await investigationStats(i.id);
    console.log(`${short(i.id)}  ${i.status.padEnd(8)} ${i.created_at.toISOString().slice(0, 16)}  ${i.title}  · ${st.sources} src · ${st.relations}+${st.attributes} claims · $${Number(st.usd).toFixed(2)}`);
  }
}

async function stats(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg stats <inv>");
  const st = await investigationStats(inv.id);
  console.log(`${inv.title}\n  seed: ${inv.seed.name} (${inv.seed.kind})  goal: ${inv.goal_text}\n  policy: ${inv.policy}  status: ${inv.status}`);
  console.log(`  sources: ${st.sources} (${st.sources_failed} failed) · chunks: ${st.chunks}\n  claims: ${st.relations} relations + ${st.attributes} attributes · rejected ${st.rejected} · fuzzy ${st.fuzzy} · candidates ${st.candidates}\n  spend: $${Number(st.usd).toFixed(3)}`);
  const byModel = await query<{ model: string; n: string; usd: string; ms: string; rel: string; attr: string; rej: string }>(
    `SELECT model, count(*) n, sum(usd) usd, avg(ms) ms, sum(n_relations) rel, sum(n_attributes) attr, sum(n_rejected) rej FROM extractions WHERE investigation_id=$1 GROUP BY model`, [inv.id]);
  for (const r of byModel) console.log(`  ${r.model}: ${r.n} chunks · ${r.rel}+${r.attr} kept · ${r.rej} rejected · ${(Number(r.ms) / 1000).toFixed(1)}s avg · $${Number(r.usd).toFixed(3)}`);
  const preds = await query<{ predicate: string; n: string }>(`SELECT predicate, count(*) n FROM relation_claims WHERE investigation_id=$1 AND status='raw' GROUP BY predicate ORDER BY n DESC`, [inv.id]);
  console.log(`  predicates: ${preds.map((p) => `${p.predicate} ${p.n}`).join(", ")}`);
  const keys = await query<{ key: string; n: string }>(`SELECT key, count(*) n FROM attribute_claims WHERE investigation_id=$1 AND status='raw' GROUP BY key ORDER BY n DESC LIMIT 15`, [inv.id]);
  console.log(`  top attribute keys: ${keys.map((p) => `${p.key} ${p.n}`).join(", ")}`);
}

async function claims(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg claims <inv>");
  const limit = Number(s("limit") ?? 30);
  const status = b("rejected") ? "rejected" : "raw";
  const order = b("random") ? "random()" : "c.created_at";
  const rows = await query<Record<string, any>>(
    `SELECT * FROM (
       SELECT 'relation' kind, c.id, c.source_id, c.subject->>'name' a, c.predicate || coalesce(' ['||c.predicate_specific||']','') p, c.object->>'name' b2, c.qualifiers properties, c.quote, c.confidence, c.span_method, c.reject_reason, c.attribute_class, s.url, c.created_at
         FROM relation_claims c JOIN sources s ON s.id=c.source_id WHERE c.investigation_id=$1 AND c.status=$2
       UNION ALL
       SELECT 'attribute', c.id, c.source_id, c.entity->>'name', c.key || coalesce(' ['||c.key_specific||']',''), c.value, '{}'::jsonb properties, c.quote, c.confidence, c.span_method, c.reject_reason, c.attribute_class, s.url, c.created_at
         FROM attribute_claims c JOIN sources s ON s.id=c.source_id WHERE c.investigation_id=$1 AND c.status=$2
     ) c ORDER BY ${order} LIMIT $3`, [inv.id, status, limit]);
  for (const r of rows) {
    const props = Object.keys(r.properties ?? {}).length ? ` {${Object.entries(r.properties).map(([k, v]) => `${k}=${v}`).join(", ")}}` : "";
    const head = r.kind === "relation" ? `${r.a} —${r.p}→ ${r.b2}` : `${r.a} · ${r.p} = ${r.b2}`;
    console.log(`\n${r.kind === "relation" ? "REL " : "ATTR"} ${head}${props}  [${r.attribute_class}, conf ${Number(r.confidence).toFixed(2)}${r.span_method === "fuzzy" ? ", fuzzy" : ""}${r.reject_reason ? ", REJECTED: " + r.reject_reason : ""}]`);
    console.log(`     “${String(r.quote).replace(/\s+/g, " ").slice(0, 220)}”`);
    console.log(`     ${r.url}  (source ${short(r.source_id)})`);
  }
  console.log(`\n${rows.length} shown`);
}

async function sources(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg sources <inv>");
  for (const r of await listSources(inv.id)) {
    const n = await query<{ rel: string; attr: string; rej: string }>(
      `SELECT (SELECT count(*) FROM relation_claims WHERE source_id=$1 AND status='raw') rel, (SELECT count(*) FROM attribute_claims WHERE source_id=$1 AND status='raw') attr,
              (SELECT count(*) FROM relation_claims WHERE source_id=$1 AND status='rejected')+(SELECT count(*) FROM attribute_claims WHERE source_id=$1 AND status='rejected') rej`, [r.id]);
    console.log(`${short(r.id)}  ${r.status.padEnd(9)} ${r.fetch_method.padEnd(9)} ${(r.tier ?? "-").padEnd(2)}${(r.family_id ?? "").padEnd(18)} ${String((r as unknown as { text_len: number }).text_len ?? 0).padStart(7)} chars  ${n[0]!.rel}+${n[0]!.attr} claims (${n[0]!.rej} rej)  ${r.url}${r.error ? "  ! " + r.error.slice(0, 80) : ""}`);
  }
}

async function source(id?: string) {
  const src = id ? await getSource(id) : null;
  if (!src?.text) return fail("wg source <source-id>");
  const spans = await query<{ start: number; end: number }>(
    `SELECT span_start start, span_end "end" FROM relation_claims WHERE source_id=$1 AND status='raw' AND span_start IS NOT NULL
     UNION ALL SELECT span_start, span_end FROM attribute_claims WHERE source_id=$1 AND status='raw' AND span_start IS NOT NULL`, [src.id]);
  const marks = new Map<number, string>();
  for (const sp of spans) { marks.set(sp.start, (marks.get(sp.start) ?? "") + "⟦"); marks.set(sp.end, (marks.get(sp.end) ?? "") + "⟧"); }
  let out = "";
  for (let i = 0; i <= src.text.length; i++) { if (marks.has(i)) out += marks.get(i); if (i < src.text.length) out += src.text[i]; }
  console.log(`${src.url}\n${src.title ?? ""}\n${spans.length} claim spans marked with ⟦ ⟧\n\n${out}`);
}

async function proposed(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg proposed <inv>");
  const preds = await query<{ label: string; parent: string; n: string; ex: string }>(
    `SELECT predicate_specific label, predicate parent, count(*) n, min((subject->>'name') || ' → ' || (object->>'name')) ex
       FROM relation_claims WHERE investigation_id=$1 AND predicate_specific IS NOT NULL AND status='raw' GROUP BY 1,2 ORDER BY n DESC`, [inv.id]);
  console.log("proposed predicates (candidate → stored under parent):");
  for (const p of preds) console.log(`  ${String(p.n).padStart(4)}  ${p.label}  → ${p.parent}   e.g. ${p.ex}`);
  const keys = await query<{ label: string; parent: string; n: string; ex: string }>(
    `SELECT key_specific label, key parent, count(*) n, min((entity->>'name') || ': ' || value) ex
       FROM attribute_claims WHERE investigation_id=$1 AND key_specific IS NOT NULL AND status='raw' GROUP BY 1,2 ORDER BY n DESC`, [inv.id]);
  console.log("proposed attribute keys:");
  for (const k of keys) console.log(`  ${String(k.n).padStart(4)}  ${k.label}  → ${k.parent}   e.g. ${k.ex}`);
  const types = await query<{ label: string; n: string }>(
    `SELECT label, count(*) n FROM (
       SELECT subject->>'type_label' label FROM relation_claims WHERE investigation_id=$1 AND subject->>'type_label' IS NOT NULL
       UNION ALL SELECT object->>'type_label' FROM relation_claims WHERE investigation_id=$1 AND object->>'type_label' IS NOT NULL
       UNION ALL SELECT entity->>'type_label' FROM attribute_claims WHERE investigation_id=$1 AND entity->>'type_label' IS NOT NULL) t GROUP BY 1 ORDER BY n DESC`, [inv.id]);
  console.log("proposed node types:");
  for (const t of types) console.log(`  ${String(t.n).padStart(4)}  ${t.label}`);
}

async function sql(q: string) {
  if (!q) return fail('wg sql "select ..."');
  if (!/^\s*(select|with|explain)\b/i.test(q)) return fail("read-only: select/with/explain only");
  const rows = await query(q);
  console.log(JSON.stringify(rows, null, 2));
}

const safeHost = (u: string) => { try { return new URL(u).hostname; } catch { return null; } };
const safeDate = (d: string) => { const t = new Date(d); return isNaN(t.getTime()) ? null : t; };

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closePool());
