// `wg export-html <inv> --out file.html` — a standalone, shareable case-file page: the force graph, every entity's
// dossier (attributes + links with grades) and the evidence behind each fact (quotes + sources), all embedded.
// No server, no keys: it is what you send to a phone. Template: apps/web/src/export.html.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, type InvestigationRow } from "@worldgraph/db";

const here = path.dirname(fileURLToPath(import.meta.url));

interface Evidence { quote: string; url: string | null; domain: string | null; pk: string | null; at: string | null }

export async function exportHtml(inv: InvestigationRow, out: string, subjectId: string | null): Promise<{ entities: number; links: number; attrs: number; evidence: number }> {
  const entities = await query(`SELECT id, canonical_name name, type, kind, claim_count claims, identity_keys keys FROM entities WHERE investigation_id=$1`, [inv.id]);
  const links = await query(`SELECT l.id, l.src_id s, l.predicate p, l.predicate_specific ps, l.dst_id o, l.qualifiers q, l.grade, l.reliability rel, l.credibility cred, l.independent_origins origins, l.evidence_count ec, l.contested, l.derived, to_char(l.valid_from_lo,'YYYY-MM-DD') vf, to_char(l.valid_to_hi,'YYYY-MM-DD') vt, to_char(l.date_lo,'YYYY-MM-DD') dl FROM links l WHERE l.investigation_id=$1`, [inv.id]);
  const attrs = await query(`SELECT a.id, a.entity_id e, a.key, a.key_specific ks, a.value, a.grade, a.reliability rel, a.credibility cred, a.independent_origins origins, a.contested FROM attributes a WHERE a.investigation_id=$1`, [inv.id]);
  const sources = Number((await query<{ n: string }>(`SELECT count(*) n FROM sources WHERE investigation_id=$1 AND status='extracted'`, [inv.id]))[0]?.n ?? 0);

  // evidence: one pass over the justifications of every link/attribute → the claims that support them → their quotes + sources
  const just = await query<{ derived_kind: string; derived_id: string; supports: { kind: string; id: string }[] }>(
    `SELECT derived_kind, derived_id, supports FROM justifications WHERE investigation_id=$1 AND derived_kind IN ('link','attribute')`, [inv.id]);
  const claimIds = new Set<string>();
  for (const j of just) for (const s of j.supports ?? []) if (s.kind === "claim") claimIds.add(s.id);
  const ids = [...claimIds];
  const claims = new Map<string, Evidence>();
  for (const table of ["relation_claims", "attribute_claims"]) {
    for (let i = 0; i < ids.length; i += 2000) {
      const rows = await query<{ id: string; quote: string; asserted_at: string | null; url: string | null; domain: string | null; publisher_kind: string | null; published_at: Date | null }>(
        `SELECT c.id, c.quote, c.asserted_at, src.url, src.domain, src.publisher_kind, src.published_at FROM ${table} c JOIN sources src ON src.id=c.source_id WHERE c.id = ANY($1::uuid[])`, [ids.slice(i, i + 2000)]);
      for (const r of rows) claims.set(r.id, { quote: r.quote, url: r.url, domain: r.domain, pk: r.publisher_kind, at: (r.asserted_at ?? (r.published_at ? String(r.published_at) : null))?.slice(0, 10) ?? null });
    }
  }
  const evidence: Record<string, Evidence[]> = {};
  for (const j of just) {
    const list: Evidence[] = [];
    const seen = new Set<string>();
    for (const s of j.supports ?? []) {
      if (s.kind !== "claim") continue;
      const c = claims.get(s.id); if (!c) continue;
      const k = `${c.url}|${c.quote}`; if (seen.has(k)) continue; seen.add(k);
      list.push(c);
    }
    if (list.length) evidence[`${j.derived_kind}:${j.derived_id}`] = list.slice(0, 12);
  }

  const data = { seed: inv.seed.name, goal: inv.goal_text, subject: subjectId, sources: Number(sources), entities, links, attrs, evidence };
  const tpl = readFileSync(path.join(here, "../../web/src/export.html"), "utf8");
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script");
  const html = tpl.replace("__TITLE__", escapeHtml(inv.seed.name)).replace("__DATA__", json);
  writeFileSync(out, html, "utf8");
  return { entities: entities.length, links: links.length, attrs: attrs.length, evidence: Object.keys(evidence).length };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
