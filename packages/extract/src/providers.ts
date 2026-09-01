// Model providers (pluggable extractor backends). One call shape for Anthropic and Gemini; every call
// returns tokens, cost, latency so the ledger and benchmarks are exact.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { env, requireEnv } from "@worldgraph/core";

export interface ModelSpec {
  /** alias used on the CLI */
  alias: string;
  id: string;
  provider: "anthropic" | "gemini";
  label: string;
  /** USD per 1M tokens: [input, output] (output includes thinking) */
  price: [number, number];
  effort?: "low" | "medium" | "high";
  thinking: boolean;
}

export const MODELS: Record<string, ModelSpec> = {
  "gemini-3.7-flash": { alias: "gemini-3.7-flash", id: "gemini-3.7-flash", provider: "gemini", label: "Gemini 3.7 Flash", price: [0.75, 3.75], thinking: true },
  "gemini-3.5-flash-lite": { alias: "gemini-3.5-flash-lite", id: "gemini-3.5-flash-lite", provider: "gemini", label: "Gemini 3.5 Flash-Lite", price: [0.3, 2.5], thinking: true },
  "haiku-4-5": { alias: "haiku-4-5", id: "claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", price: [1, 5], thinking: false },
  "sonnet-5": { alias: "sonnet-5", id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5 (low)", price: [2, 10], effort: "low", thinking: true },
  "sonnet-5-medium": { alias: "sonnet-5-medium", id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5 (medium)", price: [2, 10], effort: "medium", thinking: true },
  "opus-5": { alias: "opus-5", id: "claude-opus-5", provider: "anthropic", label: "Claude Opus 5 (low)", price: [5, 25], effort: "low", thinking: true },
};
export const DEFAULT_MODEL = "gemini-3.7-flash";

export function getModel(alias: string): ModelSpec {
  const m = MODELS[alias];
  if (!m) throw new Error(`unknown model alias "${alias}". Known: ${Object.keys(MODELS).join(", ")}`);
  return m;
}

export interface LlmRequest {
  system: string[];       // system blocks; [0] is the stable, cacheable prefix
  user: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}
export interface LlmResult {
  text: string;
  inTok: number;
  outTok: number;
  usd: number;
  ms: number;
  stop: string | null;
}

const costOf = (m: ModelSpec, inTok: number, outTok: number) => (inTok * m.price[0] + outTok * m.price[1]) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let anthropicClient: Anthropic | null = null;
let geminiClient: GoogleGenAI | null = null;

export async function callModel(m: ModelSpec, req: LlmRequest): Promise<LlmResult> {
  let delay = 3000;
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    try {
      const r = m.provider === "anthropic" ? await callAnthropic(m, req) : await callGemini(m, req);
      return { ...r, usd: costOf(m, r.inTok, r.outTok), ms: Date.now() - t0 };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const retryable = /429|rate|overloaded|503|500|502|ECONN|timeout|fetch failed|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg);
      if (!retryable || attempt >= 3) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
}

async function callAnthropic(m: ModelSpec, req: LlmRequest): Promise<Omit<LlmResult, "usd" | "ms">> {
  anthropicClient ??= new Anthropic({ apiKey: requireEnv("anthropicKey") });
  const system = req.system.map((text, i) => (i === 0 ? { type: "text" as const, text, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text }));
  const params: Record<string, unknown> = {
    model: m.id,
    max_tokens: req.maxOutputTokens ?? 48_000,
    system,
    messages: [{ role: "user", content: req.user }],
    output_config: { format: { type: "json_schema", schema: req.schema }, ...(m.effort ? { effort: m.effort } : {}) },
  };
  if (m.thinking) params.thinking = { type: "adaptive" };
  // stream + finalMessage: large max_tokens require streaming to avoid HTTP timeouts
  const res = await anthropicClient.messages.stream(params as never).finalMessage();
  if (res.stop_reason === "refusal") throw new Error("refusal: " + JSON.stringify(res.stop_details ?? {}));
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const u = res.usage;
  // cost-effective input tokens: fresh ×1, cache write ×1.25, cache read ×0.1 (Anthropic pricing)
  const inTok = Math.round((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1);
  return { text, inTok, outTok: u.output_tokens ?? 0, stop: res.stop_reason ?? null };
}

async function callGemini(m: ModelSpec, req: LlmRequest): Promise<Omit<LlmResult, "usd" | "ms">> {
  geminiClient ??= new GoogleGenAI({ apiKey: requireEnv("geminiKey") });
  const res = await geminiClient.models.generateContent({
    model: m.id,
    contents: req.user,
    config: {
      systemInstruction: req.system.join("\n\n"),
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      maxOutputTokens: req.maxOutputTokens ?? 65_536,
    },
  });
  const u = res.usageMetadata ?? {};
  const stop = res.candidates?.[0]?.finishReason ?? null;
  const text = res.text ?? "";
  if (!text) throw new Error(`gemini returned no text (finish=${stop})`);
  // cached-prompt tokens bill at ~0.25x; cost-effective input = fresh + 0.25 x cached
  const cached = u.cachedContentTokenCount ?? 0;
  const inTok = Math.round((u.promptTokenCount ?? 0) - cached * 0.75);
  return { text, inTok, outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), stop: String(stop) };
}

export const hasKeyFor = (m: ModelSpec): boolean => (m.provider === "anthropic" ? !!env.anthropicKey : !!env.geminiKey);

// ---- tool-use loop (for mission agents): multi-turn Anthropic tool use ----
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }
export interface ToolLoopResult { finalText: string; usd: number; steps: number; toolCalls: number; transcript: { role: string; text: string }[] }

/**
 * Run an Anthropic tool-use loop: the model thinks, calls tools (executed by `exec`), sees results, repeats,
 * until it stops calling tools or `maxSteps` is hit. Used by mission agents (plan/agent.ts).
 */
export async function runToolLoop(
  m: ModelSpec,
  opts: { system: string; user: string; tools: ToolDef[]; exec: (name: string, input: Record<string, unknown>) => Promise<string>; maxSteps?: number; onStep?: (note: string) => void },
): Promise<ToolLoopResult> {
  if (m.provider !== "anthropic") throw new Error("runToolLoop currently supports Anthropic models only");
  anthropicClient ??= new Anthropic({ apiKey: requireEnv("anthropicKey") });
  const maxSteps = opts.maxSteps ?? 24;
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: opts.user }];
  const transcript: { role: string; text: string }[] = [];
  let usd = 0, toolCalls = 0, step = 0;
  // cache the static prefix (system + tools) and roll a cache breakpoint onto the last message each turn, so a
  // multi-step mission pays full price only for NEW tokens and cheap cache-reads for the growing history
  // (instead of re-sending the whole conversation at full price every step).
  const cachedTools = opts.tools.map((t, i) => (i === opts.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t));
  const cacheLast = (msgs: { role: string; content: unknown }[]) => msgs.map((mm, i) => {
    if (i !== msgs.length - 1) return mm;
    const c = mm.content;
    if (typeof c === "string") return { ...mm, content: [{ type: "text", text: c, cache_control: { type: "ephemeral" as const } }] };
    if (Array.isArray(c) && c.length) { const cp = c.map((b) => ({ ...(b as object) })); (cp[cp.length - 1] as { cache_control?: unknown }).cache_control = { type: "ephemeral" }; return { ...mm, content: cp }; }
    return mm;
  });
  for (; step < maxSteps; step++) {
    const res = await anthropicClient.messages.stream({
      model: m.id, max_tokens: 8000,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: cachedTools as never, messages: cacheLast(messages) as never,
      ...(m.thinking ? { thinking: { type: "adaptive" } } : {}),
    } as never).finalMessage();
    const u = res.usage;
    usd += costOf(m, (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1, u.output_tokens ?? 0);
    const say = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    if (say) { transcript.push({ role: "assistant", text: say }); opts.onStep?.(say); }
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") return { finalText: say, usd, steps: step + 1, toolCalls, transcript };
    const results: unknown[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      toolCalls++;
      const tu = block as { id: string; name: string; input: Record<string, unknown> };
      let out: string;
      try { out = await opts.exec(tu.name, tu.input ?? {}); }
      catch (e) { out = "ERROR: " + String((e as Error).message).slice(0, 300); }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out.slice(0, 12_000) });
    }
    messages.push({ role: "user", content: results });
  }
  return { finalText: "(stopped: max steps reached)", usd, steps: step, toolCalls, transcript };
}
