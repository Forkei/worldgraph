// Repository functions for M0 tables. Plain SQL, no ORM.
import type pg from "pg";
import { uuidv7, type RelationClaim, type AttributeClaim } from "@worldgraph/core";
import { query, getPool, withTx } from "./client.ts";

export const DEFAULT_WORKSPACE = "00000000-0000-7000-8000-000000000001";

export interface InvestigationRow {
  id: string; workspace_id: string; title: string; seed: { kind: string; name: string; hints: Record<string, string> };
  goal_text: string; policy: string; budget: Record<string, unknown>; status: string; created_at: Date;
}

export async function createInvestigation(input: { title: string; seed: InvestigationRow["seed"]; goal_text: string; policy?: string; budget?: Record<string, unknown> }): Promise<InvestigationRow> {
  const id = uuidv7();
  const rows = await query<InvestigationRow>(
    `INSERT INTO investigations (id, workspace_id, title, seed, goal_text, policy, budget)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, DEFAULT_WORKSPACE, input.title, JSON.stringify(input.seed), input.goal_text, input.policy ?? "unrestricted", JSON.stringify(input.budget ?? {})],
  );
  return rows[0]!;
}

export async function getInvestigation(idOrPrefix: string): Promise<InvestigationRow | null> {
  const rows = await query<InvestigationRow>(`SELECT * FROM investigations WHERE id::text LIKE $1 ORDER BY created_at DESC LIMIT 2`, [`${idOrPrefix}%`]);
  if (rows.length > 1) throw new Error(`ambiguous investigation prefix ${idOrPrefix}`);
  return rows[0] ?? null;
}

export async function listInvestigations(): Promise<InvestigationRow[]> {
  return query<InvestigationRow>(`SELECT * FROM investigations ORDER BY created_at DESC`);
}

export async function deleteInvestigation(id: string): Promise<void> {
  await withTx(async (c) => {
    await c.query(`DELETE FROM justifications j WHERE j.derived_id IN (SELECT id FROM entities WHERE investigation_id=$1) OR j.derived_id IN (SELECT id FROM links WHERE investigation_id=$1) OR j.derived_id IN (SELECT id FROM attributes WHERE investigation_id=$1) OR j.derived_id IN (SELECT id FROM slots WHERE investigation_id=$1)`, [id]);
    await c.query(`DELETE FROM entity_members WHERE entity_id IN (SELECT id FROM entities WHERE investigation_id=$1)`, [id]);
    await c.query(`DELETE FROM claim_entities WHERE entity_id IN (SELECT id FROM entities WHERE investigation_id=$1)`, [id]);
    for (const t of ["provisional_records", "slots", "attributes", "links", "hypotheses", "resolution_decisions", "missions", "actions", "questions", "decisions", "entities", "relation_claims", "attribute_claims", "extractions", "cost_ledger", "audit_log", "sources"]) {
      await c.query(`DELETE FROM ${t} WHERE investigation_id=$1`, [id]).catch(() => {});
    }
    await c.query(`DELETE FROM investigations WHERE id=$1`, [id]);
  });
}

export async function setInvestigationStatus(id: string, status: string): Promise<void> {
  await query(`UPDATE investigations SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
}

export interface SourceRow {
  id: string; investigation_id: string; url: string; final_url: string | null; domain: string | null; kind: string;
  fetch_method: string; http_status: number | null; fetched_at: Date; content_hash: string | null; blob_key: string | null;
  text: string | null; link_table?: unknown; title: string | null; published_at: Date | null; lang: string | null; status: string; error: string | null; meta: Record<string, unknown>;
  tier: string | null; tier_kind: string | null; snapshot_key: string | null; captured_at: Date | null;
  publisher_name?: string | null; publisher_kind?: string | null;
}

export async function findSourceByUrl(investigationId: string, url: string): Promise<SourceRow | null> {
  const rows = await query<SourceRow>(`SELECT * FROM sources WHERE investigation_id=$1 AND (url=$2 OR final_url=$2) ORDER BY fetched_at DESC LIMIT 1`, [investigationId, url]);
  return rows[0] ?? null;
}

export async function findSourceByHash(investigationId: string, hash: string): Promise<SourceRow | null> {
  const rows = await query<SourceRow>(`SELECT * FROM sources WHERE investigation_id=$1 AND content_hash=$2 LIMIT 1`, [investigationId, hash]);
  return rows[0] ?? null;
}

export async function insertSource(s: Omit<SourceRow, "id" | "fetched_at">): Promise<SourceRow> {
  const id = uuidv7();
  const rows = await query<SourceRow>(
    `INSERT INTO sources (id, investigation_id, url, final_url, domain, kind, fetch_method, http_status, content_hash, blob_key, text, link_table, title, published_at, lang, status, error, meta, tier, tier_kind, snapshot_key, captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [id, s.investigation_id, s.url, s.final_url, s.domain, s.kind, s.fetch_method, s.http_status, s.content_hash, s.blob_key, s.text, JSON.stringify(s.link_table ?? []), s.title, s.published_at, s.lang, s.status, s.error, JSON.stringify(s.meta ?? {}), s.tier, s.tier_kind, s.snapshot_key, s.captured_at],
  );
  return rows[0]!;
}

export async function setSourcePublisher(id: string, publisherName: string | null, publisherKind: string | null): Promise<void> {
  await query(`UPDATE sources SET publisher_name=$2, publisher_kind=$3 WHERE id=$1`, [id, publisherName || null, publisherKind || null]);
}

export async function updateSourceStatus(id: string, status: string, error: string | null = null): Promise<void> {
  await query(`UPDATE sources SET status=$2, error=$3 WHERE id=$1`, [id, status, error]);
}

export async function getSource(idOrPrefix: string): Promise<SourceRow | null> {
  const rows = await query<SourceRow>(`SELECT * FROM sources WHERE id::text LIKE $1 LIMIT 2`, [`${idOrPrefix}%`]);
  if (rows.length > 1) throw new Error(`ambiguous source prefix ${idOrPrefix}`);
  return rows[0] ?? null;
}

export async function listSources(investigationId: string): Promise<SourceRow[]> {
  return query<SourceRow>(`SELECT id, investigation_id, url, final_url, domain, kind, fetch_method, http_status, fetched_at, content_hash, blob_key, title, published_at, lang, status, error, meta, family_id, tier, tier_kind, snapshot_key, captured_at, publisher_name, publisher_kind, length(text) AS text_len, NULL AS text FROM sources WHERE investigation_id=$1 ORDER BY fetched_at`, [investigationId]);
}

export async function hasExtraction(chunkHash: string, model: string, promptVersion: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM extractions WHERE chunk_hash=$1 AND model=$2 AND prompt_version=$3 AND status='done'`, [chunkHash, model, promptVersion]);
  return rows.length > 0;
}

export interface ExtractionStats {
  investigation_id: string; source_id: string; chunk_index: number; chunk_hash: string; model: string; prompt_version: string;
  status: "done" | "failed" | "skipped"; n_mentions: number; n_relations: number; n_attributes: number; n_rejected: number; n_other: number;
  in_tokens: number; out_tokens: number; usd: number; ms: number; error: string | null; page_summary: string | null;
}

export async function insertClaimsBatch(claims: (RelationClaim | AttributeClaim)[]): Promise<void> {
  if (!claims.length) return;
  const c = await getPool().connect();
  try { await c.query("BEGIN"); for (const cl of claims) await insertClaim(c, cl); await c.query("COMMIT"); }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function insertClaimsAndExtraction(claims: (RelationClaim | AttributeClaim)[], ex: ExtractionStats): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    for (const cl of claims) await insertClaim(c, cl);
    await c.query(
      `INSERT INTO extractions (id, investigation_id, source_id, chunk_index, chunk_hash, model, prompt_version, status, n_mentions, n_relations, n_attributes, n_rejected, n_other, in_tokens, out_tokens, usd, ms, error, page_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (chunk_hash, model, prompt_version) DO UPDATE SET status=EXCLUDED.status, n_mentions=EXCLUDED.n_mentions, n_relations=EXCLUDED.n_relations,
         n_attributes=EXCLUDED.n_attributes, n_rejected=EXCLUDED.n_rejected, n_other=EXCLUDED.n_other, in_tokens=EXCLUDED.in_tokens, out_tokens=EXCLUDED.out_tokens,
         usd=EXCLUDED.usd, ms=EXCLUDED.ms, error=EXCLUDED.error, page_summary=EXCLUDED.page_summary, created_at=now()`,
      [uuidv7(), ex.investigation_id, ex.source_id, ex.chunk_index, ex.chunk_hash, ex.model, ex.prompt_version, ex.status, ex.n_mentions, ex.n_relations, ex.n_attributes, ex.n_rejected, ex.n_other, ex.in_tokens, ex.out_tokens, ex.usd, ex.ms, ex.error, ex.page_summary],
    );
    if (ex.usd > 0) {
      await c.query(`INSERT INTO cost_ledger (id, investigation_id, kind, provider, units, usd, ref) VALUES ($1,$2,'llm',$3,$4,$5,$6)`,
        [uuidv7(), ex.investigation_id, ex.model, JSON.stringify({ in: ex.in_tokens, out: ex.out_tokens }), ex.usd, JSON.stringify({ source_id: ex.source_id, chunk_index: ex.chunk_index })]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function insertClaim(c: pg.PoolClient, cl: RelationClaim | AttributeClaim): Promise<void> {
  const prov = [cl.id, cl.investigation_id, cl.source_id, cl.chunk_index, cl.chunk_hash, cl.quote, cl.span_start, cl.span_end, cl.span_method,
    cl.extractor_conf_raw, cl.verified, cl.attribute_class, cl.status, cl.reject_reason, cl.redaction_reason, JSON.stringify(cl.extractor),
    cl.schema_version, cl.temporal_kind, cl.valid_from_edtf, cl.valid_to_edtf, cl.date_edtf, cl.valid_from_lo, cl.valid_from_hi, cl.valid_to_lo, cl.valid_to_hi,
    cl.date_lo, cl.date_hi, cl.time_qualifier, cl.asserted_at, cl.inferred, cl.derivation ? JSON.stringify(cl.derivation) : null, cl.passage, cl.attributed_to ?? null];
  const provCols = `id, investigation_id, source_id, chunk_index, chunk_hash, quote, span_start, span_end, span_method, confidence, verified, attribute_class, status, reject_reason, redaction_reason, extractor,
    schema_version, temporal_kind, valid_from_edtf, valid_to_edtf, date_edtf, valid_from_lo, valid_from_hi, valid_to_lo, valid_to_hi, date_lo, date_hi, time_qualifier, asserted_at, inferred, derivation, passage, attributed_to`;
  const ph = (n: number) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");
  if (cl.kind === "relation") {
    const vals = [...prov, JSON.stringify(cl.subject), cl.predicate, cl.predicate_specific, JSON.stringify(cl.object), JSON.stringify(cl.qualifiers)];
    await c.query(`INSERT INTO relation_claims (${provCols}, subject, predicate, predicate_specific, object, qualifiers) VALUES (${ph(vals.length)})`, vals);
  } else {
    const vals = [...prov, JSON.stringify(cl.entity), cl.key, cl.key_specific, cl.value, cl.value_norm, cl.datatype];
    await c.query(`INSERT INTO attribute_claims (${provCols}, entity, key, key_specific, value, value_norm, datatype) VALUES (${ph(vals.length)})`, vals);
  }
}

export async function recordCost(input: { investigation_id: string | null; kind: string; provider: string; units: Record<string, unknown>; usd: number; ref?: Record<string, unknown> }): Promise<void> {
  await query(`INSERT INTO cost_ledger (id, investigation_id, kind, provider, units, usd, ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv7(), input.investigation_id, input.kind, input.provider, JSON.stringify(input.units), input.usd, JSON.stringify(input.ref ?? {})]);
}

export async function audit(input: { investigation_id: string | null; actor: string; action: string; detail?: Record<string, unknown> }): Promise<void> {
  await query(`INSERT INTO audit_log (id, workspace_id, investigation_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuidv7(), DEFAULT_WORKSPACE, input.investigation_id, input.actor, input.action, JSON.stringify(input.detail ?? {})]);
}

export async function investigationStats(investigationId: string) {
  const [s] = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM sources WHERE investigation_id=$1) AS sources,
       (SELECT count(*) FROM sources WHERE investigation_id=$1 AND status='failed') AS sources_failed,
       (SELECT count(*) FROM relation_claims WHERE investigation_id=$1 AND status='raw') AS relations,
       (SELECT count(*) FROM attribute_claims WHERE investigation_id=$1 AND status='raw') AS attributes,
       (SELECT count(*) FROM relation_claims WHERE investigation_id=$1 AND status='rejected') + (SELECT count(*) FROM attribute_claims WHERE investigation_id=$1 AND status='rejected') AS rejected,
       (SELECT count(*) FROM relation_claims WHERE investigation_id=$1 AND status='raw' AND span_method='fuzzy') + (SELECT count(*) FROM attribute_claims WHERE investigation_id=$1 AND status='raw' AND span_method='fuzzy') AS fuzzy,
       (SELECT count(*) FROM relation_claims WHERE investigation_id=$1 AND predicate_specific IS NOT NULL AND status='raw') + (SELECT count(*) FROM attribute_claims WHERE investigation_id=$1 AND key_specific IS NOT NULL AND status='raw') AS candidates,
       (SELECT coalesce(sum(usd),0) FROM cost_ledger WHERE investigation_id=$1) AS usd,
       (SELECT count(*) FROM extractions WHERE investigation_id=$1) AS chunks`,
    [investigationId],
  );
  return s!;
}

export interface TierRow { pattern: string; tier: string; kind: string | null }
export async function getTierRows(): Promise<TierRow[]> {
  return query<TierRow>(`SELECT pattern, tier, kind FROM source_tiers`);
}
export async function setTier(pattern: string, tier: string, kind: string | null): Promise<void> {
  await query(`INSERT INTO source_tiers (pattern, tier, kind) VALUES ($1,$2,$3) ON CONFLICT (pattern) DO UPDATE SET tier=EXCLUDED.tier, kind=EXCLUDED.kind`, [pattern, tier, kind]);
}

