#!/usr/bin/env tsx
// wg — WorldGraph CLI (M0): db migrate · investigate · investigations · stats · claims · source · proposed · sql
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { registry, getPolicy, env, uuidv7 } from "@worldgraph/core";
import {
  migrate, query, closePool, createInvestigation, getInvestigation, listInvestigations, setInvestigationStatus,
  findSourceByUrl, findSourceByHash, insertSource, updateSourceStatus, getSource, listSources, investigationStats, audit, getTierRows, setTier, setSourceClassification, getEvidencePriors,
  type SourceRow,
} from "@worldgraph/db";
import { fetchUrl, FsBlobStore, blobKey, sha256 } from "@worldgraph/acquire";
import { extractSource, getModel, hasKeyFor, DEFAULT_MODEL, MODELS, promptVersion, classifySource, judgePair, prepareText, locateQuote, type Side } from "@worldgraph/extract";
import { resolveTier, runOriginClustering, rebuild, syncRules, loadRuleFiles, loadGraph, ego, paths, intersect, fold, timeline, at, contested, similar, why, recordDecision, listDecisions, bcubed, goldToMap, loadGoldFile, type Graph, type GLink, type Subgraph } from "@worldgraph/knowledge";

const [cmd, sub, ...rest] = process.argv.slice(2);
const flags = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    seed: { type: "string" }, kind: { type: "string", default: "person" }, goal: { type: "string" }, title: { type: "string" },
    urls: { type: "string" }, url: { type: "string", multiple: true }, inv: { type: "string" }, model: { type: "string", default: DEFAULT_MODEL },
    policy: { type: "string", default: "unrestricted" }, limit: { type: "string", default: "30" }, random: { type: "boolean", default: false },
    rejected: { type: "boolean", default: false }, "no-firecrawl": { type: "boolean", default: false }, refetch: { type: "boolean", default: false }, type: { type: "string" }, note: { type: "string" },
    pred: { type: "string" }, at: { type: "string" }, "min-grade": { type: "string" }, on: { type: "string" }, hops: { type: "string" }, from: { type: "string" },
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
    case "rebuild": return rebuildCmd(sub ?? s("inv"));
    case "classify": return classify(sub ?? s("inv"));
    case "candidates": return candidates(sub ?? s("inv"));
    case "decide": return decide(sub ?? s("inv"), rest[0], rest[1], rest[2]);
    case "unmerge": return unmerge(sub ?? s("inv"), rest[0]);
    case "merges": return merges(sub ?? s("inv"));
    case "judge": return judge(sub ?? s("inv"));
    case "ego": case "neighbors": return egoCmd(sub ?? s("inv"), rest[0], rest[1]);
    case "paths": return pathsCmd(sub ?? s("inv"), rest[0], rest[1], rest[2]);
    case "intersect": return intersectCmd(sub ?? s("inv"), rest[0], rest[1]);
    case "fold": return foldCmd(sub ?? s("inv"), rest[0]);
    case "timeline": return timelineCmd(sub ?? s("inv"), rest[0]);
    case "at": return atCmd(sub ?? s("inv"), rest[0], rest[1]);
    case "contested": return contestedCmd(sub ?? s("inv"), rest[0]);
    case "similar": return similarCmd(sub ?? s("inv"), rest[0]);
    case "why": return whyCmd(sub ?? s("inv"), rest[0]);
    case "decisions": return decisionsCmd(sub ?? s("inv"));
    case "retract": return retract(sub ?? s("inv"), rest[0]);
    case "reinstate": return retract(sub ?? s("inv"), rest[0], true);
    case "gold": return goldCmd(sub ?? s("inv"), rest[0], rest[1]);
    case "regate": return regate(sub ?? s("inv"));
    case "entities": return entities(sub ?? s("inv"));
    case "dossier": return dossier(sub ?? s("inv"), rest[0]);
    case "gaps": return gaps(sub ?? s("inv"));
    case "rules": return rulesCmd(sub);
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
  wg rebuild <inv>               claims → entities, links, attributes (graded), slots
  wg classify <inv>              classify unclassified sources (doc kind, publisher, self-published)
  wg merges <inv>                entities assembled from several names; related-not-merged pairs
  wg candidates <inv>            open identity hypotheses (the uncertain band)
  wg decide <inv> <a> <b> same|not_same|related:<kind>
  wg judge <inv> [--limit 20]    LLM door 3: judge open identity hypotheses from both sides' evidence
  wg unmerge <inv> "<name|id>"   split an entity back into its members (records not_same decisions)
  wg entities <inv> [--type person] [--limit 40]
  wg dossier <inv> "<name|id>"   one entity: keys, attributes, links (graded), slots
  wg gaps <inv>                  open slots (what is missing)
  wg ego <inv> "<ref>" [hops]    neighbourhood, best-graded edges first [--pred a,b] [--at date] [--min-grade g] [--limit n]
  wg paths <inv> "<a>" "<b>" [max]   shortest routes between two entities, weakest grade shown
  wg intersect <inv> "<a>" "<b>" [--on type] [--hops 1]   what two neighbourhoods share
  wg fold <inv> person-works_at-organization-works_at-person [--from ref]   meta-path pairs
  wg timeline <inv> "<ref>"      dated edges in order; wg at <inv> "<ref>" <date>   the world as of one day
  wg contested <inv> [ref]       competing facts and qualifier disagreements
  wg similar <inv> "<ref>"       entities sharing a neighbourhood
  wg why <inv> <link-id|"ref">   the justification chain down to quotes and pages
  wg decisions <inv>             the decisions log
  wg retract <inv> <source|domain> [--note]   withdraw a source: its claims leave, dependents re-derive; wg reinstate undoes
  wg gold <inv> export|eval <file.yaml>       write the current clustering for review / score B³ against the reviewed file
  wg regate <inv>                re-run the quote gate on rejected claims (after a gate improvement)
  wg rules [sync]                list rules / load YAML rules into the table
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
    await recordDecision(inv.id, { actor: "human", kind: "scope", subject: { seed: inv.seed, policy: policy.name }, rationale: `seed "${s("seed")}" (${s("kind") ?? "person"}) · goal: ${inv.goal_text} · ${urlList.length} starting URLs · policy ${policy.name}` });
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
          try { const { c } = await classifySource({ url: r.final_url, title: r.title, text: r.text }); await setSourceClassification(src.id, c); console.log(`${r.method} · ${r.text.length.toLocaleString()} chars · ${c.doc_kind}${c.self_published ? " (self-published)" : ""} by ${c.publisher_name || "?"} · "${(r.title ?? "").slice(0, 50)}"`); }
          catch (e) { console.log(`${r.method} · ${r.text.length.toLocaleString()} chars · (classification failed: ${String((e as Error).message).slice(0, 60)})`); }
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
  if (pattern && tier) { await setTier(pattern, tier.toUpperCase(), null, null); console.log(`override: ${pattern} → ${tier.toUpperCase()}`); }
  console.log("evidence priors (by document kind; learned counts adjust them):");
  for (const [k, t] of Object.entries(await getEvidencePriors())) console.log(`  ${t}  ${k}`);
  const ov = await getTierRows();
  console.log(ov.length ? "owner overrides:" : "owner overrides: none");
  for (const r of ov) console.log(`  ${r.tier}  ${r.pattern}`);
}

async function rebuildCmd(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg rebuild <inv>");
  await syncRules();
  const t0 = Date.now();
  const st = await rebuild(inv.id, { currentPromptVersion: promptVersion(registry()) });
  console.log(`rebuilt ${short(inv.id)} in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${st.claims} claims → ${st.provisional} names → ${st.entities} entities (${st.merges} auto-merges, ${st.hypotheses} open identity hypotheses, ${st.related} related, ${st.guarded} blocked by hard-key conflict) · ${st.links} links · ${st.attributes} attributes`);
  console.log(`grades: ${Object.entries(st.by_grade).map(([g, n]) => `${g} ${n}`).join(" · ")}`);
  console.log(`slots: ${st.slots_found} found · ${st.slots_open} open · ${st.holes} interval holes`);
}

async function entities(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg entities <inv>");
  const type = s("type");
  const rows = await query<{ id: string; type: string; kind: string | null; canonical_name: string; aliases: string[]; claim_count: string; keys: string; links: string }>(
    `SELECT e.id, e.type, e.kind, e.canonical_name, e.aliases, e.claim_count, e.identity_keys::text keys,
            (SELECT count(*) FROM links l WHERE l.src_id=e.id OR l.dst_id=e.id) links
       FROM entities e WHERE e.investigation_id=$1 ${type ? "AND e.type=$2" : ""} ORDER BY e.claim_count DESC LIMIT $${type ? 3 : 2}`,
    type ? [inv.id, type, Number(s("limit") ?? 40)] : [inv.id, Number(s("limit") ?? 40)]);
  for (const r of rows) {
    const al = r.aliases.filter((a) => a !== r.canonical_name).slice(0, 4).join(" | ");
    console.log(`${short(r.id)}  ${r.type.padEnd(12)} ${(r.kind ?? "").padEnd(10)} ${r.canonical_name.padEnd(36)} ${String(r.claim_count).padStart(4)} claims ${String(r.links).padStart(3)} links${al ? "   aka " + al : ""}${r.keys !== "{}" ? "   keys " + r.keys : ""}`);
  }
}

async function findEntity(invId: string, ref: string) {
  const byId = await query<{ id: string }>(`SELECT id FROM entities WHERE investigation_id=$1 AND id::text LIKE $2`, [invId, `${ref}%`]);
  if (byId.length === 1) return byId[0]!.id;
  const byName = await query<{ id: string; canonical_name: string; claim_count: string }>(
    `SELECT id, canonical_name, claim_count FROM entities WHERE investigation_id=$1 AND (lower(canonical_name) = lower($2) OR $2 = ANY(aliases) OR name_norm LIKE lower($2) || '%') ORDER BY claim_count DESC LIMIT 5`, [invId, ref]);
  if (!byName.length) return fail(`no entity matching "${ref}"`);
  if (byName.length > 1 && byName[0]!.canonical_name.toLowerCase() !== ref.toLowerCase()) console.log(`(matched "${byName[0]!.canonical_name}"; others: ${byName.slice(1).map((b) => b.canonical_name).join(", ")})`);
  return byName[0]!.id;
}

async function dossier(id?: string, ref?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !ref) return fail('wg dossier <inv> "<name or id>"');
  const eid = await findEntity(inv.id, ref);
  const [e] = await query<{ id: string; type: string; kind: string | null; canonical_name: string; aliases: string[]; identity_keys: Record<string, string[]>; claim_count: string; first_seen: string | null; last_seen: string | null }>(`SELECT * FROM entities WHERE id=$1`, [eid]);
  if (!e) return fail("entity vanished");
  const d = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "?");
  console.log(`\n${e.canonical_name}  [${e.type}${e.kind ? "/" + e.kind : ""}]  ${e.claim_count} claims  seen ${d(e.first_seen)} → ${d(e.last_seen)}`);
  if (e.aliases.length > 1) console.log(`aliases: ${e.aliases.join(" | ")}`);
  if (Object.keys(e.identity_keys).length) console.log(`identity keys: ${Object.entries(e.identity_keys).map(([k, v]) => `${k}=${v.join(",")}`).join("  ")}`);
  const attrs = await query<Record<string, any>>(`SELECT * FROM attributes WHERE entity_id=$1 ORDER BY key, grade`, [eid]);
  if (attrs.length) { console.log("\nattributes:"); for (const a of attrs) console.log(`  ${a.key}${a.key_specific ? " [" + a.key_specific + "]" : ""} = ${a.value}   ${gradeStr(a)}${a.contested ? "  ⚠ contested" : ""}`); }
  const out = await query<Record<string, any>>(`SELECT l.*, d.canonical_name other FROM links l JOIN entities d ON d.id=l.dst_id WHERE l.src_id=$1 ORDER BY l.predicate, l.grade, l.evidence_count DESC`, [eid]);
  const inn = await query<Record<string, any>>(`SELECT l.*, d.canonical_name other FROM links l JOIN entities d ON d.id=l.src_id WHERE l.dst_id=$1 ORDER BY l.predicate, l.grade, l.evidence_count DESC`, [eid]);
  const reg = registry();
  let last = "";
  console.log("\nlinks:");
  for (const l of out) { if (l.predicate !== last) { console.log(`  ${l.predicate}${l.predicate_specific ? "" : ""} →`); last = l.predicate; } console.log(`      ${l.other}${l.predicate_specific ? " [" + l.predicate_specific + "]" : ""}${qualStr(l.qualifiers)}${timeStr(l)}   ${gradeStr(l)}`); }
  last = "";
  for (const l of inn) { const label = "← " + reg.inverse(l.predicate); if (label !== last) { console.log(`  ${label}`); last = label; } console.log(`      ${l.other}${qualStr(l.qualifiers)}${timeStr(l)}   ${gradeStr(l)}`); }
  const slots = await query<Record<string, any>>(`SELECT kind, key, status, expectedness, window_lo, window_hi, reason FROM slots WHERE entity_id=$1 ORDER BY status, kind, key`, [eid]);
  if (slots.length) { console.log("\nslots:"); for (const sl of slots) console.log(`  ${sl.status.padEnd(16)} ${sl.kind}:${sl.key}${sl.window_lo ? ` [${sl.window_lo} → ${sl.window_hi}]` : ""}${sl.expectedness ? "  (" + sl.expectedness + ")" : ""}${sl.reason ? "  — " + sl.reason : ""}`); }
}

const gradeStr = (r: Record<string, any>) => `${r.grade} ${r.reliability}${r.credibility} · ${r.independent_origins} origin${r.independent_origins === 1 ? "" : "s"}/${r.evidence_count} claim${r.evidence_count === 1 ? "" : "s"}`;
const qualStr = (q: Record<string, string> | null) => q && Object.keys(q).length ? " {" + Object.entries(q).map(([k, v]) => `${k}: ${v}`).join(", ") + "}" : "";
const timeStr = (l: Record<string, any>) => { const f = l.valid_from_lo ? String(l.valid_from_lo).slice(0, 10) : null, t = l.valid_to_hi ? String(l.valid_to_hi).slice(0, 10) : null, d = l.date_lo ? String(l.date_lo).slice(0, 10) : null; return f || t ? `  ${f ?? "?"} → ${t ?? "…"}` : d ? `  @${d}` : ""; };

async function gaps(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg gaps <inv>");
  const rows = await query<{ name: string; type: string; kind: string; key: string; status: string; expectedness: string | null; window_lo: string | null; window_hi: string | null; n: string }>(
    `SELECT e.canonical_name name, e.type, s.kind, s.key, s.status, s.expectedness, s.window_lo, s.window_hi, e.claim_count n
       FROM slots s JOIN entities e ON e.id=s.entity_id WHERE s.investigation_id=$1 AND s.status <> 'found'
       ORDER BY (s.expectedness='mandatory') DESC, e.claim_count DESC, s.key LIMIT $2`, [inv.id, Number(s("limit") ?? 40)]);
  const summary = await query<{ status: string; n: string }>(`SELECT status, count(*) n FROM slots WHERE investigation_id=$1 GROUP BY 1 ORDER BY 1`, [inv.id]);
  console.log(`slots: ${summary.map((r) => `${r.status} ${r.n}`).join(" · ")}\n`);
  for (const r of rows) console.log(`${r.status.padEnd(16)} ${(r.expectedness ?? "").padEnd(9)} ${r.name.padEnd(34)} ${r.kind}:${r.key}${r.window_lo ? ` [${String(r.window_lo).slice(0, 10)} → ${String(r.window_hi).slice(0, 10)}]` : ""}`);
}

async function rulesCmd(sub?: string) {
  if (sub === "sync") { const n = await syncRules(); console.log(`synced ${n} rules`); return; }
  for (const r of loadRuleFiles()) console.log(`${r.kind.padEnd(16)} ${r.id.padEnd(40)} ${r.name}`);
}

async function classify(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg classify <inv>");
  const rows = await query<{ id: string; url: string; title: string | null; text: string }>(`SELECT id, coalesce(final_url, url) url, title, text FROM sources WHERE investigation_id=$1 AND text IS NOT NULL AND classified_at IS NULL`, [inv.id]);
  let usd = 0;
  for (const r of rows) {
    const { c, usd: u } = await classifySource({ url: r.url, title: r.title, text: r.text });
    usd += u;
    await setSourceClassification(r.id, c);
    console.log(`${short(r.id)}  ${c.doc_kind.padEnd(11)} ${(c.self_published ? "self" : "").padEnd(5)} pub=${c.publisher_name.slice(0, 28).padEnd(28)} about=${c.about.slice(0, 24).padEnd(24)} ${r.url.slice(0, 60)}`);
  }
  console.log(`classified ${rows.length} sources · $${usd.toFixed(4)}`);
}

async function candidates(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg candidates <inv>");
  const rows = await query<{ id: string; pattern: any; score: number; evidence: any; status: string }>(`SELECT id, pattern, score, evidence, status FROM hypotheses WHERE investigation_id=$1 AND kind='identity' AND status='open' ORDER BY score DESC LIMIT $2`, [inv.id, Number(s("limit") ?? 40)]);
  console.log(`${rows.length} open identity hypotheses (decide with: wg decide <inv> <a> <b> same|not_same|related:<kind>)\n`);
  for (const r of rows) {
    const f = r.evidence?.[0]?.features ?? {};
    console.log(`${(r.score * 100).toFixed(0).padStart(3)}%  ${r.pattern.type.padEnd(12)} ${short(r.pattern.a_id)} ${String(r.pattern.a_name).padEnd(34)} ↔ ${short(r.pattern.b_id)} ${String(r.pattern.b_name).padEnd(34)}  jw=${f.jw} tok=${f.token_overlap} ctx=${f.context_jaccard}${f.hard_key && f.hard_key !== "none" ? " key=" + f.hard_key : ""}${f.org_structure && f.org_structure !== "none" ? " org=" + f.org_structure : ""}`);
  }
}

async function decide(id?: string, a?: string, b?: string, verdictRaw?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !a || !b || !verdictRaw) return fail("wg decide <inv> <a> <b> same|not_same|related:<kind> [--note]");
  const resolveProv = async (ref: string) => {
    const rows = await query<{ provisional_id: string; name: string }>(`SELECT provisional_id, name FROM entity_members m JOIN entities e ON e.id=m.entity_id WHERE e.investigation_id=$1 AND (m.provisional_id::text LIKE $2 OR lower(m.name)=lower($3))`, [inv.id, `${ref}%`, ref]);
    if (rows.length !== 1) return fail(`"${ref}" matched ${rows.length} provisional entities (use the id prefix from wg candidates)`);
    return rows[0]!.provisional_id;
  };
  let pa = await resolveProv(a), pb = await resolveProv(b);
  if (pa > pb) [pa, pb] = [pb, pa];
  const [verdict, kind] = verdictRaw.split(":") as [string, string | undefined];
  if (!["same", "not_same", "related"].includes(verdict)) return fail("verdict must be same | not_same | related:<kind>");
  const newId = uuidv7();
  await query(`UPDATE resolution_decisions SET superseded_by=$1 WHERE investigation_id=$2 AND a_id=$3 AND b_id=$4 AND superseded_by IS NULL`, [newId, inv.id, pa, pb]);
  await query(`INSERT INTO resolution_decisions (id, investigation_id, a_id, b_id, verdict, related_kind, method, note) VALUES ($1,$2,$3,$4,$5,$6,'human',$7)`, [newId, inv.id, pa, pb, verdict, kind ?? null, s("note") ?? null]);
  await audit({ investigation_id: inv.id, actor: "human", action: "resolution.decide", detail: { a: pa, b: pb, verdict, kind } });
  await recordDecision(inv.id, { actor: "human", kind: verdict === "same" ? "merge" : "split", subject: { a: pa, b: pb, verdict, kind }, rationale: `${a} ${verdict}${kind ? ":" + kind : ""} ${b}${s("note") ? " — " + s("note") : ""}`, inputs: [{ kind: "decision", id: newId }], reversible_by: "wg decide / wg unmerge" });
  console.log(`decision recorded: ${short(pa)} ${verdict}${kind ? ":" + kind : ""} ${short(pb)} — rebuilding`);
  await rebuildCmd(inv.id);
}

async function unmerge(id?: string, ref?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !ref) return fail('wg unmerge <inv> "<name|id>"');
  const eid = await findEntity(inv.id, ref);
  const members = await query<{ provisional_id: string; name: string }>(`SELECT provisional_id, name FROM entity_members WHERE entity_id=$1 ORDER BY claim_count DESC`, [eid]);
  if (members.length < 2) return fail("entity has a single member; nothing to un-merge");
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    let pa = members[i]!.provisional_id, pb = members[j]!.provisional_id; if (pa > pb) [pa, pb] = [pb, pa];
    const newId = uuidv7();
    await query(`UPDATE resolution_decisions SET superseded_by=$1 WHERE investigation_id=$2 AND a_id=$3 AND b_id=$4 AND superseded_by IS NULL`, [newId, inv.id, pa, pb]);
    await query(`INSERT INTO resolution_decisions (id, investigation_id, a_id, b_id, verdict, method, note) VALUES ($1,$2,$3,$4,'not_same','human','unmerge')`, [newId, inv.id, pa, pb]);
  }
  await audit({ investigation_id: inv.id, actor: "human", action: "resolution.unmerge", detail: { entity: eid, members: members.map((m) => m.name) } });
  await recordDecision(inv.id, { actor: "human", kind: "split", subject: { entity: eid, members: members.map((m) => m.provisional_id) }, rationale: `un-merged ${members.map((m) => m.name).join(" | ")}`, reversible_by: "wg decide <a> <b> same" });
  console.log(`un-merged ${members.map((m) => m.name).join(" | ")} — rebuilding`);
  await rebuildCmd(inv.id);
}

async function merges(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg merges <inv>");
  const rows = await query<{ name: string; type: string; members: string[]; n: string }>(`SELECT e.canonical_name name, e.type, array_agg(m.name ORDER BY m.claim_count DESC) members, count(*) n FROM entities e JOIN entity_members m ON m.entity_id=e.id WHERE e.investigation_id=$1 GROUP BY e.id HAVING count(*) > 1 ORDER BY count(*) DESC, e.claim_count DESC LIMIT $2`, [inv.id, Number(s("limit") ?? 40)]);
  for (const r of rows) console.log(`${r.type.padEnd(12)} ${r.name.padEnd(34)} = ${r.members.join(" | ")}`);
  const rel = await query<{ a: string; b: string; predicate: string; derivation: string }>(`SELECT s.canonical_name a, d.canonical_name b, l.predicate || coalesce(' ' || l.predicate_specific, '') predicate, l.derivation FROM links l JOIN entities s ON s.id=l.src_id JOIN entities d ON d.id=l.dst_id WHERE l.investigation_id=$1 AND l.derived ORDER BY l.predicate, a LIMIT $2`, [inv.id, Number(s("limit") ?? 40)]);
  if (rel.length) { console.log("\nrelated, not merged (derived links):"); for (const r of rel) console.log(`  ${r.a} —${r.predicate}→ ${r.b}`); }
}

async function sideFor(invId: string, provisionalId: string): Promise<Side> {
  const [m] = await query<{ entity_id: string; name: string }>(`SELECT entity_id, name FROM entity_members WHERE provisional_id=$1`, [provisionalId]);
  if (!m) return { name: "?", type: "?", kind: null, aliases: [], keys: {}, facts: [], quotes: [] };
  // describe only the claims that belong to THIS provisional member (its own pages), not the whole merged entity
  const claimIds = await query<{ claim_id: string; claim_kind: string; role: string }>(`SELECT ce.claim_id, ce.claim_kind, ce.role FROM claim_entities ce WHERE ce.entity_id=$1`, [m.entity_id]);
  const rel = await query<Record<string, any>>(
    `SELECT c.predicate, c.qualifiers, c.subject->>'name' s, c.object->>'name' o, c.subject->>'type' st, c.object->>'type' ot, c.subject->>'hints' sh, c.object->>'hints' oh, c.quote, c.valid_from_edtf vf, c.valid_to_edtf vt, src.domain
       FROM relation_claims c JOIN sources src ON src.id=c.source_id WHERE c.id = ANY($1::uuid[]) AND c.status='raw'`, [claimIds.filter((c) => c.claim_kind === "relation").map((c) => c.claim_id)]);
  const attr = await query<Record<string, any>>(`SELECT c.key, c.value, c.entity->>'name' n, c.quote, src.domain FROM attribute_claims c JOIN sources src ON src.id=c.source_id WHERE c.id = ANY($1::uuid[]) AND c.status='raw'`, [claimIds.filter((c) => c.claim_kind === "attribute").map((c) => c.claim_id)]);
  const [e] = await query<{ type: string; kind: string | null; aliases: string[]; identity_keys: Record<string, string[]> }>(`SELECT type, kind, aliases, identity_keys FROM entities WHERE id=$1`, [m.entity_id]);
  const facts: string[] = [], quotes: string[] = [];
  const q = (x: Record<string, any>) => x.qualifiers && Object.keys(x.qualifiers).length ? " {" + Object.entries(x.qualifiers).map(([k, v]) => `${k}: ${v}`).join(", ") + "}" : "";
  for (const r of rel) { facts.push(`${r.s} —${r.predicate}→ ${r.o}${q(r)}${r.vf || r.vt ? ` ${r.vf ?? "?"}→${r.vt ?? "…"}` : ""} (${r.domain})`); if (quotes.length < 3) quotes.push(`${String(r.quote).replace(/\s+/g, " ").slice(0, 160)} — ${r.domain}`); }
  for (const a of attr) facts.push(`${a.n} · ${a.key} = ${a.value} (${a.domain})`);
  return { name: m.name, type: e?.type ?? "?", kind: e?.kind ?? null, aliases: (e?.aliases ?? []).filter((x) => x !== m.name).slice(0, 5), keys: e?.identity_keys ?? {}, facts, quotes };
}

async function judge(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg judge <inv> [--limit 20]");
  const rows = await query<{ id: string; pattern: any; score: number }>(`SELECT id, pattern, score FROM hypotheses WHERE investigation_id=$1 AND kind='identity' AND status='open' ORDER BY score DESC LIMIT $2`, [inv.id, Number(s("limit") ?? 20)]);
  let usd = 0, decided = 0;
  for (const h of rows) {
    const a = await sideFor(inv.id, h.pattern.a_id), b = await sideFor(inv.id, h.pattern.b_id);
    const { v, usd: u } = await judgePair(a, b);
    usd += u;
    const tag = v.verdict === "same" ? "SAME     " : v.verdict === "different" ? "DIFFERENT" : v.verdict === "related" ? `RELATED:${v.related_kind}` : "unsure   ";
    console.log(`${tag}  ${a.name}  ↔  ${b.name}\n           ${v.reason}${v.decisive_evidence ? "  [" + v.decisive_evidence.slice(0, 120) + "]" : ""}`);
    // evidence on the hypothesis, never a decision: the resolver shifts the pair's score by it (±4); humans decide
    await query(`UPDATE hypotheses SET evidence = evidence || $2::jsonb, updated_at=now() WHERE id=$1`, [h.id, JSON.stringify([{ kind: "llm", verdict: v.verdict, related_kind: v.related_kind || null, reason: v.reason, decisive: v.decisive_evidence || null, at: new Date().toISOString() }])]);
    if (v.verdict !== "unsure") decided++;
  }
  if (rows.length) await recordDecision(inv.id, { actor: "llm", kind: "refer", subject: { hypotheses: rows.map((h) => h.id) }, rationale: `judged ${rows.length} identity pairs: ${decided} verdicts recorded as evidence (${usd.toFixed(4)} USD)`, reversible_by: "wg decide" });
  console.log(`
judged ${rows.length} pairs · ${decided} with a verdict (recorded as evidence, weight ±4) · $${usd.toFixed(4)}`);
  if (decided) await rebuildCmd(inv.id);
}

// ---- the toolkit (model §4.4) ----
const gradeTag = (l: { grade: string; reliability: string; credibility: number; independent_origins: number; evidence_count: number; derived?: boolean }) =>
  l.derived ? "derived" : `${l.grade} ${l.reliability}${l.credibility} · ${l.independent_origins}o/${l.evidence_count}c`;
const linkLine = (g: Graph, l: GLink, from?: string) => {
  const a = g.entities.get(l.src)?.name ?? short(l.src), bn = g.entities.get(l.dst)?.name ?? short(l.dst);
  const arrow = from && l.dst === from ? `${bn} ←${l.predicate}— ${a}` : `${a} —${l.predicate}${l.predicate_specific ? "[" + l.predicate_specific + "]" : ""}→ ${bn}`;
  return `${arrow}${qualStr(l.qualifiers)}${timeStr(l)}   ${gradeTag(l)}   ${short(l.id)}`;
};
const printSub = (g: Graph, sub: Subgraph, from?: string) => {
  for (const l of sub.links) console.log("  " + linkLine(g, l, from));
  console.log(`  — ${sub.entities.length} entities · ${sub.links.length} links${sub.truncated ? " · TRUNCATED (raise --limit)" : ""}`);
};
const gradeOrder = ["established", "corroborated", "single_source", "unverified", "disputed"];
async function loaded(id?: string, ref?: string, usage = "", needRef = usage.includes('"<ref>"')) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || (needRef && !ref)) return fail(usage || "wg <cmd> <inv>");
  const t0 = Date.now();
  const g = await loadGraph(inv.id);
  const eid = ref ? await findEntity(inv.id, ref) : undefined;
  return { inv, g, eid: eid!, ms: Date.now() - t0 };
}
const preds = () => (s("pred") ? s("pred")!.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

async function egoCmd(id?: string, ref?: string, hopsRaw?: string) {
  const { g, eid, ms } = await loaded(id, ref, 'wg ego <inv> "<ref>" [hops] [--pred works_at,board_member] [--at 2019-01-01] [--min-grade corroborated] [--limit 200]');
  const hops = Number(hopsRaw ?? 1);
  const t0 = Date.now();
  const sub = ego(g, eid, hops, { predicates: preds(), asOf: s("at"), minGrade: s("min-grade"), limit: Number(s("limit") ?? 200) });
  console.log(`ego(${g.entities.get(eid)?.name}, ${hops} hop${hops === 1 ? "" : "s"})  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  printSub(g, sub, eid);
}

async function pathsCmd(id?: string, a?: string, bRef?: string, maxRaw?: string) {
  const { g, eid, inv, ms } = await loaded(id, a, 'wg paths <inv> "<ref>" "<ref>" [max=3] [--pred ...] [--limit 20]');
  if (!bRef) return fail("need two entity refs");
  const bid = await findEntity(inv.id, bRef);
  const t0 = Date.now();
  const r = paths(g, eid, bid, Number(maxRaw ?? 3), { predicates: preds(), limit: Number(s("limit") ?? 20) });
  console.log(`paths(${g.entities.get(eid)?.name} → ${g.entities.get(bid)?.name}, ≤${maxRaw ?? 3})  ${r.paths.length} found  [load ${ms} ms · op ${Date.now() - t0} ms]${r.sub.truncated ? "  TRUNCATED" : ""}`);
  for (const p of r.paths) {
    const parts = [g.entities.get(p.nodes[0]!)?.name];
    p.links.forEach((l, i) => { const from = p.nodes[i]!; parts.push(l.src === from ? ` —${l.predicate}→ ` : ` ←${l.predicate}— `, g.entities.get(p.nodes[i + 1]!)?.name); });
    const worst = p.links.reduce((w, l) => Math.max(w, gradeOrder.indexOf(l.grade)), 0);
    console.log(`  ${parts.join("")}   [weakest: ${gradeOrder[worst]}]`);
  }
}

async function intersectCmd(id?: string, a?: string, bRef?: string) {
  const { g, eid, inv, ms } = await loaded(id, a, 'wg intersect <inv> "<ref>" "<ref>" [--on organization] [--hops 1]');
  if (!bRef) return fail("need two entity refs");
  const bid = await findEntity(inv.id, bRef);
  const hops = Number(s("hops") ?? 1);
  const t0 = Date.now();
  const sub = intersect(ego(g, eid, hops), ego(g, bid, hops), s("on"));
  console.log(`intersect(ego ${g.entities.get(eid)?.name}, ego ${g.entities.get(bid)?.name}${s("on") ? ", on " + s("on") : ""})  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  for (const e of sub.entities.filter((e) => !s("on") || e.type === s("on"))) if (e.id !== eid && e.id !== bid) console.log(`  ${e.type.padEnd(13)} ${e.name}`);
  printSub(g, sub);
}

async function foldCmd(id?: string, meta?: string) {
  const { g, ms, inv } = await loaded(id, undefined, "wg fold <inv> person-works_at-organization-works_at-person [--from <ref>] [--limit 200]", false);
  if (!meta) return fail("give a meta-path: type-predicate-type[-predicate-type…]  (* = any)");
  const from = s("from") ? await findEntity(inv.id, s("from")!) : undefined;
  const t0 = Date.now();
  const r = fold(g, meta.split("-"), { limit: Number(s("limit") ?? 200), from });
  console.log(`fold(${meta})  ${r.folds.length} pairs  [load ${ms} ms · op ${Date.now() - t0} ms]${r.sub.truncated ? "  TRUNCATED" : ""}`);
  for (const f of r.folds) {
    const worst = f.links.reduce((w, l) => Math.max(w, gradeOrder.indexOf(l.grade)), 0);
    console.log(`  ${g.entities.get(f.a)?.name}  ~  ${g.entities.get(f.b)?.name}   via ${f.via.map((v) => g.entities.get(v)?.name).join(" / ")}   [weakest: ${gradeOrder[worst]}]`);
  }
}

async function timelineCmd(id?: string, ref?: string) {
  const { g, eid, ms } = await loaded(id, ref, 'wg timeline <inv> "<ref>"');
  const t0 = Date.now();
  const rows = timeline(g, eid);
  console.log(`timeline(${g.entities.get(eid)?.name})  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  for (const r of rows) console.log(`  ${(r.at ?? "undated").padEnd(10)} ${(r.until ? "→ " + r.until : r.link.date_lo ? "" : r.at ? "→ …" : "").padEnd(14)} ${r.fuzzy ? "~" : " "} ${linkLine(g, r.link, eid)}`);
}

async function atCmd(id?: string, ref?: string, t?: string) {
  const { g, eid, ms } = await loaded(id, ref, 'wg at <inv> "<ref>" <YYYY-MM-DD>');
  if (!t) return fail("give a date");
  const t0 = Date.now();
  const r = at(g, eid, t);
  console.log(`at(${g.entities.get(eid)?.name}, ${t})  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  if (r.attributes.length) console.log(`  attributes: ${r.attributes.map((a) => `${a.key}=${a.value}`).join(" · ")}`);
  console.log(`  holds (${r.holds.length}):`); for (const l of r.holds) console.log("    " + linkLine(g, l, eid));
  console.log(`  not then (${r.ended.length}):`); for (const l of r.ended) console.log("    " + linkLine(g, l, eid));
  console.log(`  undated (${r.undated.length}):`); for (const l of r.undated) console.log("    " + linkLine(g, l, eid));
}

async function contestedCmd(id?: string, ref?: string) {
  const { g, eid, ms } = await loaded(id, ref, "wg contested <inv> [ref] [--pred p]", false);
  const t0 = Date.now();
  const r = contested(g, eid, s("pred"));
  console.log(`contested(${eid ? g.entities.get(eid)?.name : "all"})  ${r.links.length} links · ${r.attributes.length} attributes  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  for (const l of r.links) {
    console.log("  " + linkLine(g, l, eid));
    for (const [k, vs] of Object.entries(l.qualifier_conflicts ?? {})) console.log(`      ${k}: ${(vs as { value: string; claim_ids: string[] }[]).map((v) => `"${v.value}" ×${v.claim_ids.length}`).join("  vs  ")}`);
  }
  for (const a of r.attributes) console.log(`  ${g.entities.get(a.entity)?.name} · ${a.key} = ${a.value}   ${gradeTag(a)}`);
}

async function similarCmd(id?: string, ref?: string) {
  const { g, eid, ms } = await loaded(id, ref, 'wg similar <inv> "<ref>" [--limit 10]');
  const t0 = Date.now();
  const r = similar(g, eid, Number(s("limit") ?? 10));
  console.log(`similar(${g.entities.get(eid)?.name})  [load ${ms} ms · op ${Date.now() - t0} ms]`);
  for (const x of r) console.log(`  ${String(x.score).padEnd(6)} ${(g.entities.get(x.id)?.name ?? "").padEnd(34)} shares ${x.shared.map((v) => g.entities.get(v)?.name).join(", ")}`);
}

async function whyCmd(id?: string, ref?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !ref) return fail('wg why <inv> <link-id | attribute-id | "entity ref">');
  // a link or attribute id prefix, else an entity
  const [l] = await query<{ id: string }>(`SELECT id FROM links WHERE investigation_id=$1 AND id::text LIKE $2`, [inv.id, `${ref}%`]);
  const [a] = l ? [] : await query<{ id: string }>(`SELECT id FROM attributes WHERE investigation_id=$1 AND id::text LIKE $2`, [inv.id, `${ref}%`]);
  const kind = l ? "link" : a ? "attribute" : "entity";
  const target = l?.id ?? a?.id ?? (await findEntity(inv.id, ref));
  const w = await why(inv.id, kind, target);
  console.log(`why ${kind} ${w.label}`);
  if (w.rule) console.log(`  rule: ${w.rule.name} (${w.rule.id})`);
  if (w.members?.length) { console.log(`  assembled from ${w.members.length} name${w.members.length === 1 ? "" : "s"}:`); for (const m of w.members) console.log(`    ${short(m.provisional_id)}  ${m.name}  (${m.claim_count} claims)`); }
  if (w.decisions.length) { console.log("  decisions:"); for (const d of w.decisions) console.log(`    ${d.at}  ${d.method.padEnd(6)} ${d.verdict.padEnd(9)} ${short(d.a)} ↔ ${short(d.b)}${d.note ? "  — " + d.note.slice(0, 100) : ""}`); }
  if (w.judge?.length) { console.log("  judge:"); for (const j of w.judge) console.log(`    ${j.verdict.padEnd(9)} ${j.reason.slice(0, 140)}`); }
  if (w.claims.length) {
    console.log(`  ${w.claims.length} claim${w.claims.length === 1 ? "" : "s"} · ${w.origins} independent origin${w.origins === 1 ? "" : "s"}:`);
    let lastOrigin = "";
    for (const c of w.claims) {
      if (c.origin && c.origin !== lastOrigin) { console.log(`    origin ${short(c.origin)}`); lastOrigin = c.origin; }
      console.log(`      [${c.tier}] ${c.domain}${c.doc_kind ? " (" + c.doc_kind + ")" : ""}${c.asserted_at ? " " + c.asserted_at : ""}  ${c.text}`);
      console.log(`          “${c.quote.replace(/\s+/g, " ").slice(0, 200)}”`);
      console.log(`          ${c.url}`);
    }
  }
}

async function decisionsCmd(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg decisions <inv> [--limit 50]");
  const rows = await listDecisions(inv.id, Number(s("limit") ?? 50));
  if (!rows.length) return console.log("no decisions logged yet");
  for (const r of rows) console.log(`${String(r.seq).padStart(4)}  ${r.at.slice(0, 16).replace("T", " ")}  ${r.actor.padEnd(6)} ${r.kind.padEnd(10)} ${r.rationale}${r.reversible_by ? `   (reverse: ${r.reversible_by})` : ""}`);
}

// ---- retraction: delete-and-rederive ----
async function linkSnapshot(invId: string) {
  const rows = await query<{ id: string; grade: string; evidence_count: number }>(`SELECT id, grade, evidence_count FROM links WHERE investigation_id=$1`, [invId]);
  return new Map(rows.map((r) => [r.id, r]));
}
async function retract(id?: string, ref?: string, reinstate = false) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !ref) return fail(`wg ${reinstate ? "reinstate" : "retract"} <inv> <source-id|domain> [--note reason]`);
  const srcs = await query<{ id: string; url: string; status: string }>(`SELECT id, coalesce(final_url,url) url, status FROM sources WHERE investigation_id=$1 AND (id::text LIKE $2 OR domain = $3)`, [inv.id, `${ref}%`, ref]);
  if (!srcs.length) return fail(`no source matching "${ref}"`);
  const before = await linkSnapshot(inv.id);
  const ids = srcs.map((x) => x.id);
  let n = 0;
  if (reinstate) {
    await query(`UPDATE sources SET status='extracted', retracted_at=NULL, retracted_reason=NULL WHERE id = ANY($1::uuid[])`, [ids]);
    for (const t of ["relation_claims", "attribute_claims"]) n += (await query(`UPDATE ${t} SET status='raw' WHERE source_id = ANY($1::uuid[]) AND status='retracted' RETURNING id`, [ids])).length;
  } else {
    await query(`UPDATE sources SET status='retracted', retracted_at=now(), retracted_reason=$2 WHERE id = ANY($1::uuid[])`, [ids, s("note") ?? null]);
    for (const t of ["relation_claims", "attribute_claims"]) n += (await query(`UPDATE ${t} SET status='retracted' WHERE source_id = ANY($1::uuid[]) AND status='raw' RETURNING id`, [ids])).length;
  }
  await recordDecision(inv.id, { actor: "human", kind: "policy", subject: { sources: ids }, rationale: `${reinstate ? "reinstated" : "retracted"} ${srcs.map((x) => x.url).join(", ")} (${n} claims)${s("note") ? " — " + s("note") : ""}`, reversible_by: reinstate ? "wg retract" : "wg reinstate" });
  console.log(`${reinstate ? "reinstated" : "retracted"} ${srcs.length} source${srcs.length === 1 ? "" : "s"} · ${n} claims — rebuilding`);
  await rebuildCmd(inv.id);
  const after = await linkSnapshot(inv.id);
  let dropped = 0, added = 0, regraded = 0, unchanged = 0;
  for (const [lid, b] of before) { const a = after.get(lid); if (!a) dropped++; else if (a.grade !== b.grade || a.evidence_count !== b.evidence_count) regraded++; else unchanged++; }
  for (const lid of after.keys()) if (!before.has(lid)) added++;
  console.log(`links: ${dropped} dropped · ${regraded} regraded · ${added} added · ${unchanged} untouched`);
}

// ---- gold clustering + B³ ----
async function goldCmd(id?: string, sub2?: string, file?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv || !file || !["export", "eval"].includes(sub2 ?? "")) return fail("wg gold <inv> export|eval <file.yaml>");
  const members = await query<{ entity_id: string; provisional_id: string; name: string; type: string; canonical_name: string; claim_count: string }>(
    `SELECT m.entity_id, m.provisional_id, m.name, e.type, e.canonical_name, e.claim_count FROM entity_members m JOIN entities e ON e.id=m.entity_id WHERE e.investigation_id=$1 ORDER BY e.claim_count DESC, e.canonical_name, m.name`, [inv.id]);
  if (sub2 === "export") {
    const byEntity = new Map<string, typeof members>();
    for (const m of members) (byEntity.get(m.entity_id) ?? byEntity.set(m.entity_id, []).get(m.entity_id)!).push(m);
    const lines = [`# Gold clustering for ${inv.title}`, `# One entry per real-world entity; members are provisional ids (stable per source × name).`, `# Move ids between entries to correct the system; set reviewed: true when checked by a human.`,
      `investigation: ${inv.id}`, `reviewed: false`, `exported_at: ${new Date().toISOString()}`, `entities:`];
    for (const [, ms] of byEntity) {
      const e = ms[0]!;
      lines.push(`  - name: ${JSON.stringify(e.canonical_name)}`, `    type: ${e.type}`, `    members:`);
      for (const m of ms) lines.push(`      - ${m.provisional_id}   # ${m.name}`);
    }
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.join("\n") + "\n");
    console.log(`wrote ${byEntity.size} entities · ${members.length} members → ${file}`);
    return;
  }
  const gold = loadGoldFile(file);
  const system = new Map(members.map((m) => [m.provisional_id, m.entity_id]));
  const r = bcubed(system, goldToMap(gold));
  const names = new Map(members.map((m) => [m.provisional_id, m.name]));
  console.log(`B³ vs ${file}${gold.reviewed ? "" : " (NOT yet human-reviewed)"}: precision ${r.precision} · recall ${r.recall} · F1 ${r.f1}   (${r.mentions} mentions · ${r.gold_clusters} gold · ${r.system_clusters} system clusters)`);
  for (const c of r.over_merged) console.log(`  over-merged:  ${c.map((x) => `${short(x)} ${names.get(x)}`).join(" | ")}`);
  for (const c of r.under_merged) console.log(`  under-merged: ${c.map((x) => `${short(x)} ${names.get(x)}`).join(" | ")}`);
}

// ---- re-run the quote gate on rejected claims (after a gate improvement) ----
async function regate(id?: string) {
  const inv = id ? await getInvestigation(id) : null;
  if (!inv) return fail("wg regate <inv>");
  const srcs = await query<{ id: string; text: string }>(`SELECT id, text FROM sources WHERE investigation_id=$1 AND text IS NOT NULL`, [inv.id]);
  let checked = 0, restored = 0;
  for (const src of srcs) {
    const prepared = prepareText(src.text);
    for (const t of ["relation_claims", "attribute_claims"]) {
      const rows = await query<{ id: string; quote: string }>(`SELECT id, quote FROM ${t} WHERE source_id=$1 AND status='rejected' AND reject_reason='quote_not_found'`, [src.id]);
      for (const r of rows) {
        checked++;
        const loc = locateQuote(r.quote, prepared);
        if (!loc) continue;
        const passage = src.text.slice(Math.max(0, loc.start - 150), Math.min(src.text.length, loc.end + 150)).replace(/\s+/g, " ").trim();
        await query(`UPDATE ${t} SET status='raw', reject_reason=NULL, span_start=$2, span_end=$3, span_method=$4, passage=$5 WHERE id=$1`, [r.id, loc.start, loc.end, loc.method, passage]);
        restored++;
      }
    }
  }
  console.log(`re-gated ${checked} rejected claims · ${restored} now locate and are back in`);
  if (restored) { await runOriginClustering(inv.id); await rebuildCmd(inv.id); }
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
