// Rebuild (INVESTIGATION_MODEL §1.4–1.7): claims + (later) decisions → entities, links, attributes, grades,
// justifications, slots. Deterministic and idempotent: ids are stable hashes, so slots survive rebuilds.
// M1.3 groups mentions by (type, normalized name); the real resolver (M1.5) replaces only that step.
import { query, withTx } from "@worldgraph/db";
import { uuidv7 } from "@worldgraph/core";
import { nameNorm, identityKeysFromHints, stableId } from "./normalize.ts";
import { grade, betterTier, type EvidenceProfile } from "./grade.ts";
import { intervalHoles } from "./gaps.ts";
import { loadRuleFiles, slotsFor, type Rule, type EntityView } from "./rules.ts";
import { tierForClaim, type SourceFacts } from "./reliability.ts";

interface ClaimRow {
  id: string; kind: "relation" | "attribute"; source_id: string; tier: string | null; origin: string | null; span_method: string | null;
  subject: Mention | null; object: Mention | null; entity: Mention | null;
  predicate: string | null; predicate_specific: string | null; qualifiers: Record<string, string> | null;
  key: string | null; key_specific: string | null; value: string | null; value_norm: string | null; datatype: string | null;
  temporal_kind: string | null; valid_from_lo: string | null; valid_from_hi: string | null; valid_to_lo: string | null; valid_to_hi: string | null; date_lo: string | null; date_hi: string | null; asserted_at: string | null;
}
interface Mention { surface: string; name: string; type: string; kind?: string | null; hints?: Record<string, string> }

const FUNCTIONAL_ATTRIBUTES = new Set(["date_of_birth", "date_of_death", "founded_on", "dissolved_on", "gender"]);
const today = () => new Date().toISOString().slice(0, 10);
const dstr = (v: string | Date | null) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const minD = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
const maxD = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

export interface RebuildStats { claims: number; entities: number; links: number; attributes: number; slots_open: number; slots_found: number; holes: number; by_grade: Record<string, number> }

export async function syncRules(rules: Rule[] = loadRuleFiles()): Promise<number> {
  await withTx(async (c) => {
    for (const r of rules) {
      await c.query(
        `INSERT INTO rules (id, kind, name, "when", "then", confidence, expectedness, source, enabled, note) VALUES ($1,$2,$3,$4,$5,$6,$7,'hand',$8,$9)
         ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, name=EXCLUDED.name, "when"=EXCLUDED."when", "then"=EXCLUDED."then", confidence=EXCLUDED.confidence, expectedness=EXCLUDED.expectedness, enabled=EXCLUDED.enabled, note=EXCLUDED.note`,
        [r.id, r.kind, r.name, JSON.stringify(r.when), JSON.stringify(r.then), r.confidence ?? 1, r.then.slot?.expectedness ?? null, r.enabled !== false, r.note ?? null],
      );
    }
  });
  return rules.length;
}

export async function rebuild(investigationId: string, opts: { rules?: Rule[]; currentPromptVersion?: string } = {}): Promise<RebuildStats> {
  const rules = opts.rules ?? loadRuleFiles();
  if (opts.currentPromptVersion) {
    // Supersede claims from older prompts where the same chunk was re-extracted under the current prompt.
    for (const t of ["relation_claims", "attribute_claims"]) {
      await query(
        `UPDATE ${t} c SET status='superseded' WHERE c.investigation_id=$1 AND c.status='raw' AND c.extractor->>'prompt_version' <> $2
           AND EXISTS (SELECT 1 FROM extractions x WHERE x.chunk_hash=c.chunk_hash AND x.prompt_version=$2 AND x.status='done')`,
        [investigationId, opts.currentPromptVersion],
      );
    }
  }
  const priors = Object.fromEntries((await query<{ doc_kind: string; tier: string }>(`SELECT doc_kind, tier FROM evidence_priors`)).map((r) => [r.doc_kind, r.tier]));
  const overrides = new Map((await query<{ pattern: string; tier: string }>(`SELECT pattern, tier FROM source_tiers`)).map((r) => [r.pattern, r.tier]));
  const srcFacts = new Map<string, SourceFacts & { domain: string | null; publisher_name: string | null }>();
  for (const srow of await query<{ id: string; domain: string | null; doc_kind: string | null; self_published: boolean | null; publisher_name: string | null; agree_count: number; contradict_count: number }>(`SELECT id, domain, doc_kind, self_published, publisher_name, agree_count, contradict_count FROM sources WHERE investigation_id=$1`, [investigationId])) {
    const ov = [...overrides.entries()].find(([p]) => srow.domain && (srow.domain === p || srow.domain.endsWith("." + p)))?.[1] ?? null;
    srcFacts.set(srow.id, { doc_kind: srow.doc_kind, self_published: srow.self_published, publisher_entity_id: null, agree_count: srow.agree_count, contradict_count: srow.contradict_count, override_tier: ov, domain: srow.domain, publisher_name: srow.publisher_name });
  }
  const rows = await query<ClaimRow>(
    `SELECT c.id, 'relation' AS kind, c.source_id, s.tier, c.origin_cluster_id AS origin, c.span_method, c.subject, c.object, NULL::jsonb AS entity,
            c.predicate, c.predicate_specific, c.qualifiers, NULL AS key, NULL AS key_specific, NULL AS value, NULL AS value_norm, NULL AS datatype,
            c.temporal_kind, c.valid_from_lo, c.valid_from_hi, c.valid_to_lo, c.valid_to_hi, c.date_lo, c.date_hi, c.asserted_at
       FROM relation_claims c JOIN sources s ON s.id=c.source_id WHERE c.investigation_id=$1 AND c.status='raw'
     UNION ALL
     SELECT c.id, 'attribute', c.source_id, s.tier, c.origin_cluster_id, c.span_method, NULL, NULL, c.entity,
            NULL, NULL, NULL, c.key, c.key_specific, c.value, c.value_norm, c.datatype,
            c.temporal_kind, c.valid_from_lo, c.valid_from_hi, c.valid_to_lo, c.valid_to_hi, c.date_lo, c.date_hi, c.asserted_at
       FROM attribute_claims c JOIN sources s ON s.id=c.source_id WHERE c.investigation_id=$1 AND c.status='raw'`,
    [investigationId],
  );

  // 1. entities: group mentions by (type, name_norm)
  interface Ent { id: string; type: string; kind: string | null; names: Map<string, number>; aliases: Set<string>; keys: Record<string, Set<string>>; claims: Set<string>; first: string | null; last: string | null }
  const ents = new Map<string, Ent>();
  const entityOf = (m: Mention, claimId: string, asserted: string | null): string => {
    const type = m.type || "artifact";
    const norm = nameNorm(m.name || m.surface, type) || nameNorm(m.surface, type) || "unnamed";
    const id = stableId(investigationId, type, norm);
    let e = ents.get(id);
    if (!e) { e = { id, type, kind: null, names: new Map(), aliases: new Set(), keys: {}, claims: new Set(), first: null, last: null }; ents.set(id, e); }
    const nm = (m.name || m.surface).trim();
    e.names.set(nm, (e.names.get(nm) ?? 0) + 1);
    e.aliases.add(nm); if (m.surface) e.aliases.add(m.surface.trim());
    if (m.kind && !e.kind) e.kind = m.kind;
    for (const [k, vs] of Object.entries(identityKeysFromHints(m.hints ?? {}))) for (const v of vs) (e.keys[k] ??= new Set()).add(v);
    e.claims.add(claimId);
    const d = dstr(asserted); e.first = minD(e.first, d); e.last = maxD(e.last, d);
    return id;
  };
  const claimEnts: { claim_id: string; claim_kind: string; role: string; entity_id: string }[] = [];
  const rel = rows.filter((r) => r.kind === "relation"), attr = rows.filter((r) => r.kind === "attribute");
  const relMap = new Map<string, { src: string; dst: string }>();
  for (const r of rel) {
    const src = entityOf(r.subject!, r.id, r.asserted_at), dst = entityOf(r.object!, r.id, r.asserted_at);
    relMap.set(r.id, { src, dst });
    claimEnts.push({ claim_id: r.id, claim_kind: "relation", role: "subject", entity_id: src }, { claim_id: r.id, claim_kind: "relation", role: "object", entity_id: dst });
  }
  const attrMap = new Map<string, string>();
  for (const a of attr) { const e = entityOf(a.entity!, a.id, a.asserted_at); attrMap.set(a.id, e); claimEnts.push({ claim_id: a.id, claim_kind: "attribute", role: "entity", entity_id: e }); }

  // 1b. per-claim reliability: doc-kind prior, self-published-about-itself bump, learned adjustment, owner override
  for (const f of srcFacts.values()) {
    if (!f.publisher_name) continue;
    const norm = nameNorm(f.publisher_name, "organization");
    const idOrg = stableId(investigationId, "organization", norm), idPerson = stableId(investigationId, "person", nameNorm(f.publisher_name, "person"));
    f.publisher_entity_id = ents.has(idOrg) ? idOrg : ents.has(idPerson) ? idPerson : null;
  }
  const memberOfPublisher = new Set<string>();   // entity ids that are members/officers of some publisher entity
  for (const r of rel) if (["member_of", "works_at", "board_member", "founded"].includes(r.predicate ?? "")) { const m = relMap.get(r.id)!; memberOfPublisher.add(`${m.src}|${m.dst}`); }
  const tierOf = (r: ClaimRow): string => {
    const f = srcFacts.get(r.source_id);
    if (!f) return r.tier ?? "F";
    const ents2 = r.kind === "relation" ? [relMap.get(r.id)!.src, relMap.get(r.id)!.dst] : [attrMap.get(r.id)!];
    const about = !!f.publisher_entity_id && (ents2.includes(f.publisher_entity_id) || ents2.some((e) => memberOfPublisher.has(`${e}|${f.publisher_entity_id}`)));
    return tierForClaim(f, priors, about);
  };
  for (const r of rows) r.tier = tierOf(r);

  // 2. links and attributes with evidence profiles
  interface Agg { ids: string[]; origins: Map<string, string>; tiers: string[]; fuzzy: number; rows: ClaimRow[] }
  const profile = (g: Agg, contested: boolean): EvidenceProfile & { tier_best: string } => {
    const originTier = new Map<string, string>();
    for (const [o, t] of g.origins) originTier.set(o, betterTier(originTier.get(o) ?? "F", t));
    const tier_best = [...originTier.values()].reduce((a, b) => betterTier(a, b), "F");
    return { evidence_count: g.ids.length, independent_origins: originTier.size, primary_origins: [...originTier.values()].filter((t) => t === "A").length, tier_best, contested, fuzzy_only: g.fuzzy === g.ids.length };
  };
  const timeAgg = (rs: ClaimRow[]) => rs.reduce((t, r) => ({
    temporal_kind: t.temporal_kind ?? r.temporal_kind, valid_from_lo: minD(t.valid_from_lo, dstr(r.valid_from_lo)), valid_from_hi: maxD(t.valid_from_hi, dstr(r.valid_from_hi)),
    valid_to_lo: minD(t.valid_to_lo, dstr(r.valid_to_lo)), valid_to_hi: maxD(t.valid_to_hi, dstr(r.valid_to_hi)), date_lo: minD(t.date_lo, dstr(r.date_lo)), date_hi: maxD(t.date_hi, dstr(r.date_hi)),
    first_asserted: minD(t.first_asserted, dstr(r.asserted_at)), last_asserted: maxD(t.last_asserted, dstr(r.asserted_at)),
  }), { temporal_kind: null as string | null, valid_from_lo: null as string | null, valid_from_hi: null as string | null, valid_to_lo: null as string | null, valid_to_hi: null as string | null, date_lo: null as string | null, date_hi: null as string | null, first_asserted: null as string | null, last_asserted: null as string | null });

  const linkAgg = new Map<string, Agg & { src: string; dst: string; predicate: string; specific: string | null }>();
  for (const r of rel) {
    const { src, dst } = relMap.get(r.id)!;
    const k = `${src}|${r.predicate}|${r.predicate_specific ?? ""}|${dst}`;
    let g = linkAgg.get(k);
    if (!g) { g = { ids: [], origins: new Map(), tiers: [], fuzzy: 0, rows: [], src, dst, predicate: r.predicate!, specific: r.predicate_specific }; linkAgg.set(k, g); }
    g.ids.push(r.id); g.origins.set(r.origin ?? r.id, r.tier ?? "F"); g.tiers.push(r.tier ?? "F"); if (r.span_method === "fuzzy") g.fuzzy++; g.rows.push(r);
  }
  const attrAgg = new Map<string, Agg & { entity: string; key: string; specific: string | null; value: string; value_norm: string; datatype: string }>();
  const perEntityKeyValues = new Map<string, Set<string>>();
  for (const a of attr) {
    const e = attrMap.get(a.id)!;
    const k = `${e}|${a.key}|${a.key_specific ?? ""}|${a.value_norm}`;
    let g = attrAgg.get(k);
    if (!g) { g = { ids: [], origins: new Map(), tiers: [], fuzzy: 0, rows: [], entity: e, key: a.key!, specific: a.key_specific, value: a.value!, value_norm: a.value_norm!, datatype: a.datatype! }; attrAgg.set(k, g); }
    g.ids.push(a.id); g.origins.set(a.origin ?? a.id, a.tier ?? "F"); g.tiers.push(a.tier ?? "F"); if (a.span_method === "fuzzy") g.fuzzy++; g.rows.push(a);
    const ek = `${e}|${a.key}`; (perEntityKeyValues.get(ek) ?? perEntityKeyValues.set(ek, new Set()).get(ek)!).add(a.value_norm!);
  }

  const byGrade: Record<string, number> = {};
  const entityPreds = new Map<string, Set<string>>(), entityAttrs = new Map<string, Set<string>>();
  const coverage = new Map<string, { lo: string | null; hi: string | null }[]>();   // entity|predicate → intervals

  await withTx(async (c) => {
    await c.query(`DELETE FROM justifications WHERE derived_kind IN ('entity','link','attribute') AND derived_id IN (SELECT id FROM entities WHERE investigation_id=$1 UNION SELECT id FROM links WHERE investigation_id=$1 UNION SELECT id FROM attributes WHERE investigation_id=$1)`, [investigationId]);
    await c.query(`DELETE FROM links WHERE investigation_id=$1`, [investigationId]);
    await c.query(`DELETE FROM attributes WHERE investigation_id=$1`, [investigationId]);
    await c.query(`DELETE FROM claim_entities WHERE entity_id IN (SELECT id FROM entities WHERE investigation_id=$1)`, [investigationId]);
    // entities: upsert by stable id; drop those no longer present (cascade removes their slots — acceptable: no claims → no entity)
    const keep = [...ents.keys()];
    await c.query(`DELETE FROM entities WHERE investigation_id=$1 AND NOT (id = ANY($2::uuid[]))`, [investigationId, keep]);
    for (const e of ents.values()) {
      const canonical = [...e.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0];
      await c.query(
        `INSERT INTO entities (id, investigation_id, type, kind, canonical_name, name_norm, aliases, identity_keys, claim_count, first_seen, last_seen, built_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, kind=EXCLUDED.kind, canonical_name=EXCLUDED.canonical_name, aliases=EXCLUDED.aliases, identity_keys=EXCLUDED.identity_keys, claim_count=EXCLUDED.claim_count, first_seen=EXCLUDED.first_seen, last_seen=EXCLUDED.last_seen, built_at=now()`,
        [e.id, investigationId, e.type, e.kind, canonical, nameNorm(canonical, e.type) || "unnamed", [...e.aliases], JSON.stringify(Object.fromEntries(Object.entries(e.keys).map(([k, v]) => [k, [...v]]))), e.claims.size, e.first, e.last],
      );
      await c.query(`INSERT INTO justifications (derived_kind, derived_id, supports) VALUES ('entity',$1,$2)`, [e.id, JSON.stringify([...e.claims].map((id) => ({ kind: "claim", id })))]);
    }
    for (const ce of claimEnts) await c.query(`INSERT INTO claim_entities (claim_id, claim_kind, role, entity_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ce.claim_id, ce.claim_kind, ce.role, ce.entity_id]);

    for (const g of linkAgg.values()) {
      const p = profile(g, false), gr = grade(p), t = timeAgg(g.rows);
      const quals: Record<string, string> = {}, conflicts: Record<string, { value: string; claim_ids: string[] }[]> = {};
      for (const r of g.rows) for (const [k, v] of Object.entries(r.qualifiers ?? {})) {
        if (!(k in quals)) quals[k] = v;
        else if (quals[k] !== v) { (conflicts[k] ??= [{ value: quals[k]!, claim_ids: [] }]); const ex = conflicts[k]!.find((x) => x.value === v); if (ex) ex.claim_ids.push(r.id); else conflicts[k]!.push({ value: v, claim_ids: [r.id] }); }
      }
      const id = stableId(investigationId, "link", g.src, g.predicate, g.specific ?? "", g.dst);
      await c.query(
        `INSERT INTO links (id, investigation_id, src_id, predicate, predicate_specific, dst_id, qualifiers, qualifier_conflicts, claim_ids, evidence_count, independent_origins, primary_origins, tier_best, contested, reliability, credibility, grade,
           temporal_kind, valid_from_lo, valid_from_hi, valid_to_lo, valid_to_hi, date_lo, date_hi, first_asserted, last_asserted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [id, investigationId, g.src, g.predicate, g.specific, g.dst, JSON.stringify(quals), JSON.stringify(conflicts), g.ids, p.evidence_count, p.independent_origins, p.primary_origins, p.tier_best, false, gr.reliability, gr.credibility, gr.grade,
          t.temporal_kind, t.valid_from_lo, t.valid_from_hi, t.valid_to_lo, t.valid_to_hi, t.date_lo, t.date_hi, t.first_asserted, t.last_asserted],
      );
      await c.query(`INSERT INTO justifications (derived_kind, derived_id, supports) VALUES ('link',$1,$2)`, [id, JSON.stringify([...g.ids.map((cid) => ({ kind: "claim", id: cid })), ...[...g.origins.keys()].map((o) => ({ kind: "origin", id: o }))])]);
      byGrade[gr.grade] = (byGrade[gr.grade] ?? 0) + 1;
      (entityPreds.get(g.src) ?? entityPreds.set(g.src, new Set()).get(g.src)!).add(g.predicate);
      if (g.predicate === "located_in" || g.predicate === "works_at" || g.predicate === "member_of" || g.predicate === "board_member") {
        const cov = coverage.get(`${g.src}|${g.predicate}`) ?? coverage.set(`${g.src}|${g.predicate}`, []).get(`${g.src}|${g.predicate}`)!;
        if (t.valid_from_lo) cov.push({ lo: t.valid_from_lo, hi: t.valid_to_hi });
      }
    }
    for (const g of attrAgg.values()) {
      const contested = FUNCTIONAL_ATTRIBUTES.has(g.key) && (perEntityKeyValues.get(`${g.entity}|${g.key}`)?.size ?? 0) > 1;
      const p = profile(g, contested), gr = grade(p), t = timeAgg(g.rows);
      const id = stableId(investigationId, "attribute", g.entity, g.key, g.specific ?? "", g.value_norm);
      await c.query(
        `INSERT INTO attributes (id, investigation_id, entity_id, key, key_specific, value, value_norm, datatype, claim_ids, evidence_count, independent_origins, primary_origins, tier_best, contested, reliability, credibility, grade,
           temporal_kind, valid_from_lo, valid_from_hi, valid_to_lo, valid_to_hi, date_lo, date_hi, first_asserted, last_asserted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [id, investigationId, g.entity, g.key, g.specific, g.value, g.value_norm, g.datatype, g.ids, p.evidence_count, p.independent_origins, p.primary_origins, p.tier_best, contested, gr.reliability, gr.credibility, gr.grade,
          t.temporal_kind, t.valid_from_lo, t.valid_from_hi, t.valid_to_lo, t.valid_to_hi, t.date_lo, t.date_hi, t.first_asserted, t.last_asserted],
      );
      await c.query(`INSERT INTO justifications (derived_kind, derived_id, supports) VALUES ('attribute',$1,$2)`, [id, JSON.stringify([...g.ids.map((cid) => ({ kind: "claim", id: cid })), ...[...g.origins.keys()].map((o) => ({ kind: "origin", id: o }))])]);
      byGrade[gr.grade] = (byGrade[gr.grade] ?? 0) + 1;
      (entityAttrs.get(g.entity) ?? entityAttrs.set(g.entity, new Set()).get(g.entity)!).add(g.key);
    }

    // 3. slots from rules (+ inverse predicates count as present), interval holes on covering predicates
    const inverseOf: Record<string, string> = { has_member: "member_of" };
    let slotsOpen = 0, slotsFound = 0, holes = 0;
    for (const e of ents.values()) {
      const preds = new Set(entityPreds.get(e.id) ?? []);
      for (const [k, g] of linkAgg) if (g.dst === e.id) { void k; preds.add(`inv:${g.predicate}`); }
      const view: EntityView = { id: e.id, type: e.type, kind: e.kind, predicates: preds, attributes: entityAttrs.get(e.id) ?? new Set() };
      for (const { rule, slot } of slotsFor(rules, view)) {
        const present = slot.kind === "predicate" ? (preds.has(slot.key) || (inverseOf[slot.key] ? preds.has(`inv:${inverseOf[slot.key]}`) : false)) : slot.kind === "attribute" ? view.attributes.has(slot.key) : false;
        await c.query(
          `INSERT INTO slots (id, investigation_id, entity_id, kind, key, status, expectedness, rule_id, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (entity_id, kind, key, coalesce(window_lo, '0001-01-01'), coalesce(window_hi, '9999-12-31')) WHERE entity_id IS NOT NULL
           DO UPDATE SET status = CASE WHEN slots.status IN ('searched_absent','not_obtainable','not_applicable','unknown') AND EXCLUDED.status='unset' THEN slots.status ELSE EXCLUDED.status END, updated_at=now()`,
          [uuidv7(), investigationId, e.id, slot.kind, slot.key, present ? "found" : "unset", slot.expectedness ?? null, rule.id, slot.note ?? null],
        );
        if (present) slotsFound++; else slotsOpen++;
        if (slot.covering && present) {
          for (const h of intervalHoles(coverage.get(`${e.id}|${slot.key}`) ?? [], today())) {
            await c.query(
              `INSERT INTO slots (id, investigation_id, entity_id, kind, key, window_lo, window_hi, status, expectedness, rule_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,'unset',$8,$9,'interval hole on a covering predicate')
               ON CONFLICT (entity_id, kind, key, coalesce(window_lo, '0001-01-01'), coalesce(window_hi, '9999-12-31')) WHERE entity_id IS NOT NULL DO NOTHING`,
              [uuidv7(), investigationId, e.id, slot.kind, slot.key, h.lo, h.hi, slot.expectedness ?? null, rule.id],
            );
            holes++;
          }
        }
      }
    }
    (rebuildStatsHolder as { v: Partial<RebuildStats> }).v = { slots_open: slotsOpen, slots_found: slotsFound, holes };
  });
  const extra = (rebuildStatsHolder as { v: Partial<RebuildStats> }).v;
  return { claims: rows.length, entities: ents.size, links: linkAgg.size, attributes: attrAgg.size, slots_open: extra.slots_open ?? 0, slots_found: extra.slots_found ?? 0, holes: extra.holes ?? 0, by_grade: byGrade };
}
const rebuildStatsHolder: { v: Partial<RebuildStats> } = { v: {} };
