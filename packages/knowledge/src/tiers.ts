// Source reliability tier (Admiralty A–F) and independence family, from editable table rows.
// Longest matching domain pattern wins; '*' is the default.
export interface TierRow { pattern: string; tier: string; family_id: string | null; kind: string | null }
export interface TierResult { tier: string; family_id: string | null; kind: string | null; pattern: string }

export function resolveTier(domain: string | null, rows: TierRow[]): TierResult {
  const d = (domain ?? "").toLowerCase().replace(/^www\./, "");
  let best: TierRow | null = null;
  for (const r of rows) {
    const p = r.pattern.toLowerCase();
    const match = p === "*" ? true : p.startsWith(".") ? d.endsWith(p) || d === p.slice(1) : d === p || d.endsWith("." + p);
    if (match && (!best || (best.pattern === "*" ? true : p.length > best.pattern.length))) best = r;
  }
  best ??= { pattern: "*", tier: "F", family_id: null, kind: "unknown" };
  return { tier: best.tier, family_id: best.family_id, kind: best.kind, pattern: best.pattern };
}
