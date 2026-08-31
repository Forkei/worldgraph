// Loading the graph for the toolkit, the `why` chain (justifications → claims → sources), and the decisions log.
import { query } from "@worldgraph/db";
import { makeGraph, type Graph, type GEntity, type GLink, type GAttribute } from "./toolkit.ts";

const d = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

/** One investigation's materialized graph. Seed A (≈200 entities, ≈200 links) loads in a few ms. */
export async function loadGraph(investigationId: string): Promise<Graph> {
  const ents = await query<Record<string, any>>(`SELECT id, type, kind, canonical_name, aliases, identity_keys, claim_count, first_seen, last_seen FROM entities WHERE investigation_id=$1`, [investigationId]);
  const links = await query<Record<string, any>>(`SELECT * FROM links WHERE investigation_id=$1`, [investigationId]);
  const attrs = await query<Record<string, any>>(`SELECT * FROM attributes WHERE investigation_id=$1`, [investigationId]);
  const E: GEntity[] = ents.map((e) => ({ id: e.id, type: e.type, kind: e.kind, name: e.canonical_name, aliases: e.aliases ?? [], keys: e.identity_keys ?? {}, claim_count: Number(e.claim_count), first_seen: d(e.first_seen), last_seen: d(e.last_seen) }));
  const L: GLink[] = links.map((l) => ({
    id: l.id, src: l.src_id, predicate: l.predicate, predicate_specific: l.predicate_specific, dst: l.dst_id,
    qualifiers: l.qualifiers ?? {}, qualifier_conflicts: l.qualifier_conflicts ?? {},
    grade: l.grade, reliability: l.reliability, credibility: Number(l.credibility), evidence_count: Number(l.evidence_count), independent_origins: Number(l.independent_origins), contested: !!l.contested, derived: !!l.derived,
    temporal_kind: l.temporal_kind, valid_from_lo: d(l.valid_from_lo), valid_from_hi: d(l.valid_from_hi), valid_to_lo: d(l.valid_to_lo), valid_to_hi: d(l.valid_to_hi), date_lo: d(l.date_lo), date_hi: d(l.date_hi),
  }));
  const A: GAttribute[] = attrs.map((a) => ({
    id: a.id, entity: a.entity_id, key: a.key, key_specific: a.key_specific, value: a.value, datatype: a.datatype,
    grade: a.grade, reliability: a.reliability, credibility: Number(a.credibility), evidence_count: Number(a.evidence_count), independent_origins: Number(a.independent_origins), contested: !!a.contested,
    valid_from_lo: d(a.valid_from_lo), valid_to_hi: d(a.valid_to_hi), date_lo: d(a.date_lo),
  }));
  return makeGraph(E, L, A);
}

export interface WhyClaim { id: string; kind: "relation" | "attribute"; text: string; quote: string; url: string; domain: string; publisher: string | null; publisher_kind: string | null; asserted_at: string | null; origin: string | null }
export interface Why {
  kind: string; id: string; label: string;
  supports: { kind: string; id: string; label?: string }[];
  claims: WhyClaim[];
  origins: number;
  rule?: { id: string; name: string } | null;
  decisions: { id: string; verdict: string; method: string; note: string | null; a: string; b: string; at: string }[];
  members?: { provisional_id: string; name: string; claim_count: number }[];
  judge?: { verdict: string; reason: string; at?: string }[];
}

/** The justification chain of a link, attribute, entity or slot — down to the quotes and the pages they came from. */
export async function why(investigationId: string, kind: "link" | "attribute" | "entity" | "slot", id: string): Promise<Why> {
  const [j] = await query<{ supports: { kind: string; id: string }[] }>(`SELECT supports FROM justifications WHERE derived_kind=$1 AND derived_id=$2`, [kind, id]);
  const supports = j?.supports ?? [];
  const out: Why = { kind, id, label: "", supports: [], claims: [], origins: 0, decisions: [] };
  const claimIds = supports.filter((s) => s.kind === "claim").map((s) => s.id);
  out.origins = new Set(supports.filter((s) => s.kind === "origin").map((s) => s.id)).size;
  if (kind === "link") {
    const [l] = await query<Record<string, any>>(`SELECT l.predicate, l.predicate_specific, l.derived, l.derivation, a.canonical_name an, b.canonical_name bn FROM links l JOIN entities a ON a.id=l.src_id JOIN entities b ON b.id=l.dst_id WHERE l.id=$1`, [id]);
    if (l) out.label = `${l.an} —${l.predicate}${l.predicate_specific ? "[" + l.predicate_specific + "]" : ""}→ ${l.bn}${l.derived ? "  (derived: " + l.derivation + ")" : ""}`;
  } else if (kind === "attribute") {
    const [a] = await query<Record<string, any>>(`SELECT a.key, a.value, e.canonical_name en FROM attributes a JOIN entities e ON e.id=a.entity_id WHERE a.id=$1`, [id]);
    if (a) out.label = `${a.en} · ${a.key} = ${a.value}`;
  } else if (kind === "entity") {
    const [e] = await query<Record<string, any>>(`SELECT canonical_name, type FROM entities WHERE id=$1`, [id]);
    if (e) out.label = `${e.canonical_name} [${e.type}]`;
    out.members = (await query<Record<string, any>>(`SELECT provisional_id, name, claim_count FROM entity_members WHERE entity_id=$1 ORDER BY claim_count DESC`, [id])).map((m) => ({ provisional_id: m.provisional_id, name: m.name, claim_count: Number(m.claim_count) }));
    const provIds = out.members.map((m) => m.provisional_id);
    out.decisions = (await query<Record<string, any>>(`SELECT id, verdict, method, note, a_id, b_id, created_at FROM resolution_decisions WHERE investigation_id=$1 AND superseded_by IS NULL AND (a_id = ANY($2::uuid[]) OR b_id = ANY($2::uuid[])) ORDER BY created_at`, [investigationId, provIds]))
      .map((r) => ({ id: r.id, verdict: r.verdict, method: r.method, note: r.note, a: r.a_id, b: r.b_id, at: String(r.created_at).slice(0, 10) }));
    const hyp = await query<{ evidence: any[] }>(`SELECT evidence FROM hypotheses WHERE investigation_id=$1 AND kind='identity' AND (pattern->>'a_id' = ANY($2::text[]) AND pattern->>'b_id' = ANY($2::text[]))`, [investigationId, provIds]);
    out.judge = hyp.flatMap((h) => (h.evidence ?? []).filter((e: any) => e.kind === "llm").map((e: any) => ({ verdict: e.verdict, reason: e.reason, at: e.at })));
  } else if (kind === "slot") {
    const [s] = await query<Record<string, any>>(`SELECT s.kind k, s.key, s.status, s.rule_id, e.canonical_name en FROM slots s LEFT JOIN entities e ON e.id=s.entity_id WHERE s.id=$1`, [id]);
    if (s) { out.label = `${s.en ?? "?"} · ${s.k}:${s.key} (${s.status})`; if (s.rule_id) supports.push({ kind: "rule", id: s.rule_id }); }
  }
  const ruleId = supports.find((s) => s.kind === "rule")?.id;
  if (ruleId) { const [r] = await query<{ id: string; name: string }>(`SELECT id, name FROM rules WHERE id=$1`, [ruleId]); out.rule = r ?? { id: ruleId, name: ruleId }; }
  if (claimIds.length) {
    const rel = await query<Record<string, any>>(
      `SELECT c.id, c.subject->>'name' s, c.predicate, c.object->>'name' o, c.qualifiers, c.quote, c.asserted_at, c.origin_cluster_id, src.url, src.domain, src.publisher_name, src.publisher_kind
         FROM relation_claims c JOIN sources src ON src.id=c.source_id WHERE c.id = ANY($1::uuid[])`, [claimIds]);
    const attr = await query<Record<string, any>>(
      `SELECT c.id, c.entity->>'name' s, c.key, c.value, c.quote, c.asserted_at, c.origin_cluster_id, src.url, src.domain, src.publisher_name, src.publisher_kind
         FROM attribute_claims c JOIN sources src ON src.id=c.source_id WHERE c.id = ANY($1::uuid[])`, [claimIds]);
    const q = (x: Record<string, string> | null) => x && Object.keys(x).length ? " {" + Object.entries(x).map(([k, v]) => `${k}: ${v}`).join(", ") + "}" : "";
    for (const r of rel) out.claims.push({ id: r.id, kind: "relation", text: `${r.s} —${r.predicate}→ ${r.o}${q(r.qualifiers)}`, quote: r.quote, url: r.url, domain: r.domain, publisher: r.publisher_name, publisher_kind: r.publisher_kind, asserted_at: d(r.asserted_at), origin: r.origin_cluster_id });
    for (const a of attr) out.claims.push({ id: a.id, kind: "attribute", text: `${a.s} · ${a.key} = ${a.value}`, quote: a.quote, url: a.url, domain: a.domain, publisher: a.publisher_name, publisher_kind: a.publisher_kind, asserted_at: d(a.asserted_at), origin: a.origin_cluster_id });
    out.claims.sort((x, y) => (x.origin ?? "").localeCompare(y.origin ?? "") || x.domain.localeCompare(y.domain));
  }
  out.supports = supports;
  return out;
}

// ---- decisions log (model §1.10): every choice that shaped the investigation, in order, with its rationale ----
export type DecisionKind = "scope" | "merge" | "split" | "refer" | "pend" | "policy" | "stop" | "kill" | "capability";
export interface DecisionRow { seq: number; at: string; actor: string; kind: DecisionKind; subject_ref: unknown; rationale: string; inputs: unknown[]; reversible_by: string | null }

export async function recordDecision(investigationId: string, d: { actor: "system" | "human" | "llm"; kind: DecisionKind; subject: unknown; rationale: string; inputs?: unknown[]; reversible_by?: string | null }): Promise<number> {
  const [r] = await query<{ seq: string }>(
    `INSERT INTO decisions (investigation_id, actor, kind, subject_ref, rationale, inputs, reversible_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq`,
    [investigationId, d.actor, d.kind, JSON.stringify(d.subject ?? {}), d.rationale, JSON.stringify(d.inputs ?? []), d.reversible_by ?? null]);
  return Number(r!.seq);
}

export async function listDecisions(investigationId: string, limit = 50): Promise<DecisionRow[]> {
  const rows = await query<Record<string, any>>(`SELECT seq, at, actor, kind, subject_ref, rationale, inputs, reversible_by FROM decisions WHERE investigation_id=$1 ORDER BY seq DESC LIMIT $2`, [investigationId, limit]);
  return rows.reverse().map((r) => ({ seq: Number(r.seq), at: String(r.at), actor: r.actor, kind: r.kind, subject_ref: r.subject_ref, rationale: r.rationale, inputs: r.inputs ?? [], reversible_by: r.reversible_by }));
}
