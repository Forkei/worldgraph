// Extractor v2: source text → chunks → model → validated, quote-gated, hierarchy-resolved, time-normalized
// claims → DB. No confidence adjustments: the model's number is kept raw and never used for ranking.
import { z } from "zod";
import {
  uuidv7, kvToRecord, normValue, DATATYPES, ATTRIBUTE_CLASSES, TEMPORAL_KINDS, TIME_QUALIFIERS, parseEdtf, dobFromAge, startFromDuration,
  type Registry, type Policy, type Mention, type RelationClaim, type AttributeClaim, type AttributeClass, type ExtractionOutput, type Time, type TimeOut,
} from "@worldgraph/core";
import { hasExtraction, insertClaimsAndExtraction, type SourceRow, type ExtractionStats } from "@worldgraph/db";
import { chunkText, type Chunk } from "./chunk.ts";
import { prepareText, locateQuote, surfaceInQuote } from "./quoteGate.ts";
import { systemPrompt, promptVersion, contextBlock, userPrompt, type InvestigationContext } from "./prompt.ts";
import { callModel, type ModelSpec } from "./providers.ts";

const KV = z.array(z.object({ key: z.string(), value: z.string() })).default([]);
const AttrClass = z.enum(ATTRIBUTE_CLASSES as unknown as [AttributeClass, ...AttributeClass[]]).catch("public");
const TimeShape = {
  temporal_kind: z.enum(TEMPORAL_KINDS).catch("timeless"),
  valid_from: z.string().default(""), valid_to: z.string().default(""), date: z.string().default(""),
  time_qualifier: z.enum(TIME_QUALIFIERS).catch("unknown"),
  inferred: z.boolean().default(false), derivation: z.string().default(""),
};
const OutputSchema = z.object({
  mentions: z.array(z.object({ ref: z.string(), surface: z.string(), name: z.string(), type: z.string(), type_label: z.string().default(""), type_parent: z.string().default(""), kind: z.string().default(""), hints: KV })).default([]),
  relations: z.array(z.object({ subject: z.string(), predicate: z.string(), candidate_label: z.string().default(""), candidate_parent: z.string().default(""), object: z.string(), qualifiers: KV, quote: z.string(), confidence: z.number().min(0).max(1).catch(0.5), attribute_class: AttrClass, ...TimeShape })).default([]),
  attributes: z.array(z.object({ entity: z.string(), key: z.string(), key_parent: z.string().default(""), value: z.string(), datatype: z.enum(DATATYPES).catch("string"), quote: z.string(), confidence: z.number().min(0).max(1).catch(0.5), attribute_class: AttrClass, ...TimeShape })).default([]),
  page: z.object({ published_at: z.string().default(""), summary: z.string().default("") }).default({ published_at: "", summary: "" }),
});

export interface ExtractContext {
  investigation: InvestigationContext & { id: string };
  model: ModelSpec;
  policy: Policy;
  registry: Registry;
  log?: (s: string) => void;
}

export interface ExtractSummary {
  chunks: number; skipped: number; relations: number; attributes: number; rejected: number; redacted: number;
  fuzzy: number; candidates: number; derived: number; usd: number; ms: number; rejectReasons: Record<string, number>;
}

const CLASS_RANK: Record<AttributeClass, number> = { public: 0, sensitive: 1, restricted: 2 };
const maxClass = (a: AttributeClass, b: AttributeClass): AttributeClass => (CLASS_RANK[a] >= CLASS_RANK[b] ? a : b);

export async function extractSource(ctx: ExtractContext, source: SourceRow): Promise<ExtractSummary> {
  const log = ctx.log ?? (() => {});
  const sum: ExtractSummary = { chunks: 0, skipped: 0, relations: 0, attributes: 0, rejected: 0, redacted: 0, fuzzy: 0, candidates: 0, derived: 0, usd: 0, ms: 0, rejectReasons: {} };
  if (!source.text) return sum;
  const chunks = chunkText(source.text);
  sum.chunks = chunks.length;
  const system = [systemPrompt(ctx.registry), contextBlock(ctx.investigation)];
  const pv = promptVersion(ctx.registry);
  const schema = ctx.registry.extractionJsonSchema();
  const seen = new Set<string>();
  const pageDate = source.published_at ? source.published_at.toISOString().slice(0, 10) : null;

  for (const chunk of chunks) {
    if (await hasExtraction(chunk.hash, ctx.model.id, pv)) { sum.skipped++; continue; }
    const page = { url: source.final_url ?? source.url, title: source.title, published_at: pageDate, chunk_index: chunk.index, chunk_count: chunks.length };
    const base: ExtractionStats = {
      investigation_id: source.investigation_id, source_id: source.id, chunk_index: chunk.index, chunk_hash: chunk.hash,
      model: ctx.model.id, prompt_version: pv, status: "done", n_mentions: 0, n_relations: 0, n_attributes: 0, n_rejected: 0, n_other: 0,
      in_tokens: 0, out_tokens: 0, usd: 0, ms: 0, error: null, page_summary: null,
    };
    let llm;
    try { llm = await callModel(ctx.model, { system, user: userPrompt(page, chunk.text), schema }); }
    catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      log(`  chunk ${chunk.index}: model error: ${msg}`);
      await insertClaimsAndExtraction([], { ...base, status: "failed", error: msg });
      continue;
    }
    sum.usd += llm.usd; sum.ms += llm.ms;
    let parsed: ExtractionOutput;
    try { parsed = OutputSchema.parse(JSON.parse(llm.text)) as ExtractionOutput; }
    catch (e) {
      const msg = "bad model output: " + String((e as Error).message).slice(0, 300);
      log(`  chunk ${chunk.index}: ${msg}`);
      await insertClaimsAndExtraction([], { ...base, status: "failed", error: msg, in_tokens: llm.inTok, out_tokens: llm.outTok, usd: llm.usd, ms: llm.ms });
      continue;
    }
    const assertedAt = pageDate ?? parseEdtf(parsed.page.published_at)?.lo ?? null;
    const { claims, stats } = buildClaims(ctx, source, chunk, parsed, pv, llm.usd, seen, assertedAt);
    for (const [k, v] of Object.entries(stats.rejectReasons)) sum.rejectReasons[k] = (sum.rejectReasons[k] ?? 0) + v;
    sum.relations += stats.relations; sum.attributes += stats.attributes; sum.rejected += stats.rejected; sum.redacted += stats.redacted;
    sum.fuzzy += stats.fuzzy; sum.candidates += stats.candidates; sum.derived += stats.derived;
    await insertClaimsAndExtraction(claims, {
      ...base, n_mentions: parsed.mentions.length, n_relations: stats.relations, n_attributes: stats.attributes, n_rejected: stats.rejected, n_other: stats.candidates,
      in_tokens: llm.inTok, out_tokens: llm.outTok, usd: llm.usd, ms: llm.ms, page_summary: parsed.page.summary || null,
    });
    log(`  chunk ${chunk.index + 1}/${chunks.length}: ${stats.relations} rel, ${stats.attributes} attr, ${stats.rejected} rejected${stats.candidates ? `, ${stats.candidates} candidate` : ""}${stats.derived ? `, ${stats.derived} derived` : ""} · ${(llm.ms / 1000).toFixed(1)}s · $${llm.usd.toFixed(4)}`);
  }
  return sum;
}

interface BuildStats { relations: number; attributes: number; rejected: number; redacted: number; fuzzy: number; candidates: number; derived: number; rejectReasons: Record<string, number> }

function timeOf(t: TimeOut, assertedAt: string | null, kindDefault?: Time["temporal_kind"]): Time {
  const vf = parseEdtf(t.valid_from), vt = parseEdtf(t.valid_to), d = parseEdtf(t.date);
  let qual = t.time_qualifier;
  if (qual === "unknown" && (vf?.qualifier === "circa" || vt?.qualifier === "circa" || d?.qualifier === "circa")) qual = "circa";
  if (qual === "unknown" && (vf || vt || d)) qual = "exact";
  let kind = t.temporal_kind;
  if (kindDefault && kind === "timeless") kind = kindDefault;
  return {
    temporal_kind: kind,
    valid_from_edtf: vf?.edtf ?? null, valid_to_edtf: vt?.edtf ?? null, date_edtf: d?.edtf ?? null,
    valid_from_lo: vf?.lo ?? null, valid_from_hi: vf?.hi ?? null, valid_to_lo: vt?.lo ?? null, valid_to_hi: vt?.hi ?? null,
    date_lo: d?.lo ?? null, date_hi: d?.hi ?? null,
    time_qualifier: qual, asserted_at: assertedAt,
  };
}

export function buildClaims(ctx: ExtractContext, source: SourceRow, chunk: Chunk, out: ExtractionOutput, pv: string, usd: number, seen: Set<string>, assertedAt: string | null): { claims: (RelationClaim | AttributeClaim)[]; stats: BuildStats } {
  const stats: BuildStats = { relations: 0, attributes: 0, rejected: 0, redacted: 0, fuzzy: 0, candidates: 0, derived: 0, rejectReasons: {} };
  const prepared = prepareText(chunk.text);
  const perItemCost = usd / Math.max(1, out.relations.length + out.attributes.length);
  const extractor = { model: ctx.model.id, prompt_version: pv, effort: ctx.model.effort ?? null, cost_usd: Number(perItemCost.toFixed(6)) };
  const refs = new Map(out.mentions.map((m) => [m.ref, m]));
  const mention = (ref: string, quote: string): Mention | null => {
    const m = refs.get(ref);
    if (!m) return null;
    const rt = ctx.registry.resolveNodeType(m.type === "candidate" ? (m.type_label || "candidate") : m.type, m.type_parent || undefined);
    return { surface: m.surface, name: m.name || m.surface, type: rt.type, type_label: rt.label, kind: m.kind || null, hints: kvToRecord(m.hints), surface_in_quote: surfaceInQuote(m.surface, quote) };
  };
  const reject = (reason: string) => { stats.rejected++; stats.rejectReasons[reason] = (stats.rejectReasons[reason] ?? 0) + 1; };
  const claims: (RelationClaim | AttributeClaim)[] = [];

  const provenance = (quote: string, conf: number, attrClass: AttributeClass, t: TimeOut, kindDefault?: Time["temporal_kind"]) => {
    const loc = locateQuote(quote, prepared);
    return {
      prov: {
        investigation_id: source.investigation_id, source_id: source.id, chunk_index: chunk.index, chunk_hash: chunk.hash,
        quote, span_start: loc ? chunk.start + loc.start : null, span_end: loc ? chunk.start + loc.end : null, span_method: loc?.method ?? null,
        extractor_conf_raw: conf, verified: null, attribute_class: attrClass,
        status: (loc ? "raw" : "rejected") as RelationClaim["status"], reject_reason: loc ? null : "quote_not_found", redaction_reason: null,
        inferred: !!t.inferred, derivation: t.derivation ? { rule: t.derivation } : null, schema_version: ctx.registry.hash, extractor,
        ...timeOf(t, assertedAt, kindDefault),
      }, loc,
    };
  };

  for (const r of out.relations) {
    const subject = mention(r.subject, r.quote), object = mention(r.object, r.quote);
    const rp = ctx.registry.resolvePredicate(r.predicate === "candidate" ? (r.candidate_label || "candidate") : r.predicate, r.candidate_label, r.candidate_parent);
    const attrClass = maxClass(r.attribute_class, ctx.registry.attributeClassFloor(rp.predicate));
    const { prov, loc } = provenance(r.quote, r.confidence, attrClass, r, "interval");
    const claim: RelationClaim = { id: uuidv7(), kind: "relation", ...prov,
      subject: subject ?? { surface: r.subject, name: r.subject, type: "artifact", type_label: null, kind: null, hints: {}, surface_in_quote: false },
      predicate: rp.predicate, predicate_specific: rp.specific,
      object: object ?? { surface: r.object, name: r.object, type: "artifact", type_label: null, kind: null, hints: {}, surface_in_quote: false },
      qualifiers: kvToRecord(r.qualifiers) };
    if (!subject || !object) { claim.status = "rejected"; claim.reject_reason = "bad_ref"; reject("bad_ref"); }
    else if (claim.status === "rejected") reject("quote_not_found");
    else if (rp.fallback && !r.candidate_label) { claim.status = "rejected"; claim.reject_reason = "unknown_predicate"; reject("unknown_predicate"); }
    else {
      const v = ctx.registry.validateRelation(subject.type, rp.predicate, object.type);
      if (!v.ok) { claim.status = "rejected"; claim.reject_reason = "type_violation: " + v.reason; reject("type_violation"); }
    }
    finalize(claim, `r|${claim.subject.name}|${rp.predicate}|${rp.specific ?? ""}|${claim.object.name}|${claim.span_start ?? claim.quote}`);
    if (claim.status === "raw") { stats.relations++; if (rp.specific) stats.candidates++; if (loc?.method === "fuzzy") stats.fuzzy++; }
  }

  for (const a of out.attributes) {
    const entity = mention(a.entity, a.quote);
    const ak = ctx.registry.resolveAttributeKey(a.key, a.key_parent || undefined);
    // derived quantities → underlying dated fact
    let key = ak.key, specific = ak.specific, value = a.value, datatype = a.datatype, derivation = a.derivation, t: TimeOut = a;
    const ageMatch = /^(age|age_years|years_old)$/.test(a.key.trim().toLowerCase()) ? Number(String(a.value).match(/\d{1,3}/)?.[0]) : NaN;
    if (Number.isFinite(ageMatch) && assertedAt) {
      const dob = dobFromAge(ageMatch, assertedAt);
      if (dob) { key = "date_of_birth"; specific = null; value = dob.edtf; datatype = "date"; derivation = "age_at_date"; t = { ...a, temporal_kind: "timeless", valid_from: "", valid_to: "", date: "", time_qualifier: "circa" }; stats.derived++; }
    }
    const spec = ctx.registry.attributeKeys[key]!;
    const attrClass = maxClass(a.attribute_class, spec.attribute_class);
    const { prov, loc } = provenance(a.quote, a.confidence, attrClass, { ...t, derivation }, spec.temporal_kind);
    if (prov.temporal_kind === "timeless" && spec.temporal_kind !== "timeless") prov.temporal_kind = spec.temporal_kind;
    const claim: AttributeClaim = { id: uuidv7(), kind: "attribute", ...prov,
      entity: entity ?? { surface: a.entity, name: a.entity, type: "artifact", type_label: null, kind: null, hints: {}, surface_in_quote: false },
      key, key_specific: specific, value, value_norm: normValue(value), datatype };
    if (!entity) { claim.status = "rejected"; claim.reject_reason = "bad_ref"; reject("bad_ref"); }
    else if (claim.status === "rejected") reject("quote_not_found");
    finalize(claim, `a|${claim.entity.name}|${key}|${specific ?? ""}|${claim.value_norm}`);
    if (claim.status === "raw") { stats.attributes++; if (specific) stats.candidates++; if (loc?.method === "fuzzy") stats.fuzzy++; }
  }
  // duration hints on relations ("10 years at X") are handled by the model via valid_from ≈ page − N (circa); startFromDuration is exported for connectors.
  void startFromDuration;
  return { claims, stats };

  function finalize(claim: RelationClaim | AttributeClaim, dedupeKey: string) {
    if (claim.status === "raw") {
      if (seen.has(dedupeKey)) { claim.status = "rejected"; claim.reject_reason = "duplicate_overlap"; reject("duplicate_overlap"); }
      else seen.add(dedupeKey);
    }
    if (claim.status === "raw") {
      const d = ctx.policy.redact(claim);
      if (d.action === "redact") { claim.status = "redacted"; claim.redaction_reason = d.reason; stats.redacted++; }
    }
    claims.push(claim);
  }
}
