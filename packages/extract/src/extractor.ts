// Extractor (X1): source text → chunks → model → validated, quote-gated, policy-checked claims → DB.
import { z } from "zod";
import {
  uuidv7, kvToRecord, normValue, DATATYPES, ATTRIBUTE_CLASSES,
  type Registry, type Policy, type Mention, type RelationClaim, type AttributeClaim, type AttributeClass, type ExtractionOutput,
} from "@worldgraph/core";
import { hasExtraction, insertClaimsAndExtraction, type SourceRow, type ExtractionStats } from "@worldgraph/db";
import { chunkText, type Chunk } from "./chunk.ts";
import { prepareText, locateQuote, surfaceInQuote } from "./quoteGate.ts";
import { systemPrompt, promptVersion, contextBlock, userPrompt, type InvestigationContext } from "./prompt.ts";
import { callModel, type ModelSpec } from "./providers.ts";

const KV = z.array(z.object({ key: z.string(), value: z.string() })).default([]);
const AttrClass = z.enum(ATTRIBUTE_CLASSES as [AttributeClass, ...AttributeClass[]]).catch("public");
const OutputSchema = z.object({
  mentions: z.array(z.object({ ref: z.string(), surface: z.string(), name: z.string(), type: z.string(), type_label: z.string().default(""), hints: KV })).default([]),
  relations: z.array(z.object({
    subject: z.string(), predicate: z.string(), predicate_label: z.string().default(""), object: z.string(),
    properties: KV, quote: z.string(), confidence: z.number().min(0).max(1).catch(0.5), attribute_class: AttrClass,
  })).default([]),
  attributes: z.array(z.object({
    entity: z.string(), key: z.string(), value: z.string(), datatype: z.enum(DATATYPES).catch("string"),
    properties: KV, quote: z.string(), confidence: z.number().min(0).max(1).catch(0.5), attribute_class: AttrClass,
  })).default([]),
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
  chunks: number;
  skipped: number;
  relations: number;
  attributes: number;
  rejected: number;
  redacted: number;
  fuzzy: number;
  other: number;
  usd: number;
  ms: number;
  rejectReasons: Record<string, number>;
}

const CLASS_RANK: Record<AttributeClass, number> = { public: 0, sensitive: 1, restricted: 2 };
const maxClass = (a: AttributeClass, b: AttributeClass): AttributeClass => (CLASS_RANK[a] >= CLASS_RANK[b] ? a : b);

export async function extractSource(ctx: ExtractContext, source: SourceRow): Promise<ExtractSummary> {
  const log = ctx.log ?? (() => {});
  const sum: ExtractSummary = { chunks: 0, skipped: 0, relations: 0, attributes: 0, rejected: 0, redacted: 0, fuzzy: 0, other: 0, usd: 0, ms: 0, rejectReasons: {} };
  if (!source.text) return sum;
  const chunks = chunkText(source.text);
  sum.chunks = chunks.length;
  const system = [systemPrompt(ctx.registry), contextBlock(ctx.investigation)];
  const pv = promptVersion(ctx.registry);
  const schema = ctx.registry.extractionJsonSchema();
  const seen = new Set<string>(); // overlap dedupe within this source

  for (const chunk of chunks) {
    if (await hasExtraction(chunk.hash, ctx.model.id, pv)) { sum.skipped++; continue; }
    const page = { url: source.final_url ?? source.url, title: source.title, published_at: source.published_at ? source.published_at.toISOString().slice(0, 10) : null, chunk_index: chunk.index, chunk_count: chunks.length };
    const base: ExtractionStats = {
      investigation_id: source.investigation_id, source_id: source.id, chunk_index: chunk.index, chunk_hash: chunk.hash,
      model: ctx.model.id, prompt_version: pv, status: "done", n_mentions: 0, n_relations: 0, n_attributes: 0, n_rejected: 0, n_other: 0,
      in_tokens: 0, out_tokens: 0, usd: 0, ms: 0, error: null, page_summary: null,
    };
    let llm;
    try {
      llm = await callModel(ctx.model, { system, user: userPrompt(page, chunk.text), schema });
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      log(`  chunk ${chunk.index}: model error: ${msg}`);
      await insertClaimsAndExtraction([], { ...base, status: "failed", error: msg });
      continue;
    }
    sum.usd += llm.usd; sum.ms += llm.ms;
    let parsed: ExtractionOutput;
    try {
      parsed = OutputSchema.parse(JSON.parse(llm.text)) as ExtractionOutput;
    } catch (e) {
      const msg = "bad model output: " + String((e as Error).message).slice(0, 300);
      log(`  chunk ${chunk.index}: ${msg}`);
      await insertClaimsAndExtraction([], { ...base, status: "failed", error: msg, in_tokens: llm.inTok, out_tokens: llm.outTok, usd: llm.usd, ms: llm.ms });
      continue;
    }
    const { claims, stats } = buildClaims(ctx, source, chunk, parsed, pv, llm.usd, seen);
    for (const [k, v] of Object.entries(stats.rejectReasons)) sum.rejectReasons[k] = (sum.rejectReasons[k] ?? 0) + v;
    sum.relations += stats.relations; sum.attributes += stats.attributes; sum.rejected += stats.rejected; sum.redacted += stats.redacted; sum.fuzzy += stats.fuzzy; sum.other += stats.other;
    await insertClaimsAndExtraction(claims, {
      ...base, n_mentions: parsed.mentions.length, n_relations: stats.relations, n_attributes: stats.attributes, n_rejected: stats.rejected, n_other: stats.other,
      in_tokens: llm.inTok, out_tokens: llm.outTok, usd: llm.usd, ms: llm.ms, page_summary: parsed.page.summary || null,
    });
    log(`  chunk ${chunk.index + 1}/${chunks.length}: ${stats.relations} rel, ${stats.attributes} attr, ${stats.rejected} rejected${stats.fuzzy ? `, ${stats.fuzzy} fuzzy` : ""} · ${(llm.ms / 1000).toFixed(1)}s · $${llm.usd.toFixed(4)}`);
  }
  return sum;
}

interface BuildStats { relations: number; attributes: number; rejected: number; redacted: number; fuzzy: number; other: number; rejectReasons: Record<string, number> }

export function buildClaims(ctx: ExtractContext, source: SourceRow, chunk: Chunk, out: ExtractionOutput, pv: string, usd: number, seen: Set<string>): { claims: (RelationClaim | AttributeClaim)[]; stats: BuildStats } {
  const stats: BuildStats = { relations: 0, attributes: 0, rejected: 0, redacted: 0, fuzzy: 0, other: 0, rejectReasons: {} };
  const prepared = prepareText(chunk.text);
  const perItemCost = usd / Math.max(1, out.relations.length + out.attributes.length);
  const extractor = { model: ctx.model.id, prompt_version: pv, effort: ctx.model.effort ?? null, cost_usd: Number(perItemCost.toFixed(6)) };
  const refs = new Map<string, ExtractionOutput["mentions"][number]>();
  for (const m of out.mentions) refs.set(m.ref, m);
  const mention = (ref: string, quote: string): Mention | null => {
    const m = refs.get(ref);
    if (!m) return null;
    return { surface: m.surface, name: m.name || m.surface, type: ctx.registry.nodeTypes[m.type] ? m.type : "other", type_label: m.type_label || (ctx.registry.nodeTypes[m.type] ? undefined : m.type), hints: kvToRecord(m.hints), surface_in_quote: surfaceInQuote(m.surface, quote) };
  };
  const reject = (reason: string) => { stats.rejected++; stats.rejectReasons[reason] = (stats.rejectReasons[reason] ?? 0) + 1; };
  const claims: (RelationClaim | AttributeClaim)[] = [];

  const provenance = (quote: string, confidence: number, attrClass: AttributeClass) => {
    const loc = locateQuote(quote, prepared);
    return {
      investigation_id: source.investigation_id, source_id: source.id, chunk_index: chunk.index, chunk_hash: chunk.hash,
      quote, span_start: loc ? chunk.start + loc.start : null, span_end: loc ? chunk.start + loc.end : null, span_method: loc?.method ?? null,
      confidence, verified: null, attribute_class: attrClass, status: (loc ? "raw" : "rejected") as RelationClaim["status"],
      reject_reason: loc ? null : "quote_not_found", redaction_reason: null, extractor, _loc: loc,
    };
  };

  for (const r of out.relations) {
    const subject = mention(r.subject, r.quote), object = mention(r.object, r.quote);
    const predicateKnown = ctx.registry.predicates[r.predicate] && ctx.registry.extractablePredicates.includes(r.predicate);
    const predicate = predicateKnown ? r.predicate : "other";
    const predicate_label = predicate === "other" ? (r.predicate_label || (predicateKnown ? null : r.predicate)) : null;
    const attrClass = maxClass(r.attribute_class, ctx.registry.attributeClassFloor(predicate));
    const { _loc, ...prov } = provenance(r.quote, r.confidence, attrClass);
    const claim: RelationClaim = { id: uuidv7(), kind: "relation", ...prov, subject: subject ?? { surface: r.subject, name: r.subject, type: "other", hints: {}, surface_in_quote: false }, predicate, predicate_label, object: object ?? { surface: r.object, name: r.object, type: "other", hints: {}, surface_in_quote: false }, properties: kvToRecord(r.properties) };
    if (!subject || !object) { claim.status = "rejected"; claim.reject_reason = "bad_ref"; reject("bad_ref"); }
    else if (claim.status === "rejected") reject("quote_not_found");
    else {
      const v = ctx.registry.validateRelation(subject.type, predicate, object.type);
      if (!v.ok) { claim.status = "rejected"; claim.reject_reason = "type_violation: " + v.reason; reject("type_violation"); }
    }
    finalize(claim, `r|${claim.subject.name}|${predicate}|${predicate_label ?? ""}|${claim.object.name}|${prepared.norm.length && claim.span_start != null ? claim.span_start : claim.quote}`);
    if (claim.status === "raw") { stats.relations++; if (predicate === "other") stats.other++; if (_loc?.method === "fuzzy") stats.fuzzy++; }
  }
  for (const a of out.attributes) {
    const entity = mention(a.entity, a.quote);
    const { _loc, ...prov } = provenance(a.quote, a.confidence, a.attribute_class);
    const claim: AttributeClaim = { id: uuidv7(), kind: "attribute", ...prov, entity: entity ?? { surface: a.entity, name: a.entity, type: "other", hints: {}, surface_in_quote: false }, key: a.key.trim().toLowerCase().replace(/\s+/g, "_"), value: a.value, value_norm: normValue(a.value), datatype: a.datatype, properties: kvToRecord(a.properties) };
    if (!entity) { claim.status = "rejected"; claim.reject_reason = "bad_ref"; reject("bad_ref"); }
    else if (claim.status === "rejected") reject("quote_not_found");
    finalize(claim, `a|${claim.entity.name}|${claim.key}|${claim.value_norm}`);
    if (claim.status === "raw") { stats.attributes++; if (_loc?.method === "fuzzy") stats.fuzzy++; }
  }
  return { claims, stats };

  function finalize(claim: RelationClaim | AttributeClaim, dedupeKey: string) {
    if (claim.status === "raw") {
      const m = claim.kind === "relation" ? [claim.subject, claim.object] : [claim.entity];
      if (m.some((x) => !x.surface_in_quote)) claim.confidence = Number((claim.confidence * 0.8).toFixed(3));
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
