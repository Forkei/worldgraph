// DB glue for origin clustering: load an investigation's raw claims with passages + source families,
// cluster, write origin_cluster_id back. Idempotent; re-run after every ingest.
import { query, withTx } from "@worldgraph/db";
import { clusterOrigins, independentOrigins, type ClaimForClustering } from "./origins.ts";

interface Row { id: string; kind: "relation" | "attribute"; fact_key: string; source_id: string; family_id: string | null; passage: string | null; quote: string }

export async function runOriginClustering(investigationId: string): Promise<{ claims: number; clusters: number; facts: number; multiOrigin: number }> {
  const rows = await query<Row>(
    `SELECT c.id, 'relation' AS kind, lower(coalesce(c.subject->>'name','')) || '|' || c.predicate || '|' || lower(coalesce(c.object->>'name','')) AS fact_key,
            c.source_id, s.family_id, c.passage, c.quote
       FROM relation_claims c JOIN sources s ON s.id = c.source_id WHERE c.investigation_id = $1 AND c.status = 'raw'
     UNION ALL
     SELECT c.id, 'attribute', lower(coalesce(c.entity->>'name','')) || '|' || c.key || '|' || c.value_norm, c.source_id, s.family_id, c.passage, c.quote
       FROM attribute_claims c JOIN sources s ON s.id = c.source_id WHERE c.investigation_id = $1 AND c.status = 'raw'`,
    [investigationId],
  );
  const claims: ClaimForClustering[] = rows.map((r) => ({ id: r.id, fact_key: r.fact_key, source_id: r.source_id, family_id: r.family_id, passage: r.passage ?? r.quote }));
  const assignment = clusterOrigins(claims);
  const per = independentOrigins(claims, assignment);
  await withTx(async (c) => {
    const rel = rows.filter((r) => r.kind === "relation"), attr = rows.filter((r) => r.kind === "attribute");
    if (rel.length) await c.query(`UPDATE relation_claims AS c SET origin_cluster_id = v.cluster::uuid FROM (SELECT unnest($1::uuid[]) id, unnest($2::text[]) cluster) v WHERE c.id = v.id`, [rel.map((r) => r.id), rel.map((r) => assignment.get(r.id))]);
    if (attr.length) await c.query(`UPDATE attribute_claims AS c SET origin_cluster_id = v.cluster::uuid FROM (SELECT unnest($1::uuid[]) id, unnest($2::text[]) cluster) v WHERE c.id = v.id`, [attr.map((r) => r.id), attr.map((r) => assignment.get(r.id))]);
  });
  const clusters = new Set(assignment.values()).size;
  const multi = [...per.values()].filter((n) => n > 1).length;
  return { claims: rows.length, clusters, facts: per.size, multiOrigin: multi };
}
