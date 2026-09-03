// The investigator: ONE long-lived agent per investigation that drives everything. Nothing runs automatically —
// searching, reading, running capabilities, rebuilding, judging, editing the graph are all tools it calls when it
// decides to. The system's job is to guarantee the substrate: every fact has a source and a quote, grades come
// from provenance, identity merges need an identifier or a judgment, every edit is recorded and reversible.
// Knowledge (how to search, how to investigate) is served by consult_playbook. Memory is the graph + the notebook;
// the transcript is trimmed as it grows (providers.runToolLoop).
import { uuidv7, type ExtractionOutput, type RelationClaim, type AttributeClaim } from "@worldgraph/core";
import { query, findSourceByUrl, findSourceByHash, insertSource, insertClaimsBatch, updateSourceStatus, setSourcePublisher, listCapabilities, getCachedSearch, putCachedSearch, type SourceRow, type InvestigationRow } from "@worldgraph/db";
import { runToolLoop, extractClaimsOnly, buildClaims, promptVersion, lookAt, visionToText, fetchImage, hasVisionKey, type ExtractContext, type ModelSpec, type ToolDef } from "@worldgraph/extract";
import { fetchUrl, sha256, blobKey, FsBlobStore, SEARCH_ENGINES, ENGINE_NAMES, CAP_RUNNERS, type SearchResult, type PivotKind } from "@worldgraph/acquire";
import { loadGraph, ego, paths, timeline, contested, why, recordDecision, type Graph, type GEntity } from "@worldgraph/knowledge";
import { computeGaps, buildMissions } from "./dispatch.ts";
import { openQuestions } from "./questions.ts";
import { consultPlaybook, playbookTopics } from "./playbook.ts";
import { ingestCapability, cacheKeyFor } from "./pivot.ts";

export interface InvestigatorDeps {
  ctx: ExtractContext;
  model: ModelSpec;
  /** rebuild the graph; returns a one-line summary */
  rebuild: () => Promise<string>;
  /** judge open identity hypotheses; returns a one-line summary */
  judge: () => Promise<string>;
  ceilingUsd?: number;
  maxSteps?: number;
  /** the model used by the look_at (vision) tool; defaults to Gemini Flash */
  visionModel?: ModelSpec;
  log?: (s: string) => void;
  trace?: (s: string) => void;
  /** "ask the graph": answer this question from the graph alone (read tools only), then finish */
  question?: string;
  /** chat mode: one turn of an ongoing conversation. The transcript is the LLM session; `say` delivers a message to
   *  the user immediately (send_message tool); `activity` receives readable one-liners of what the agent is doing. */
  chat?: { transcript: { role: "user" | "assistant"; content: unknown }[]; user: string; say: (text: string) => Promise<void>; activity?: (text: string) => void };
}
export interface InvestigatorResult { report: string; usd: number; steps: number; toolCalls: number; stopped: string | null; messages: { role: "user" | "assistant"; content: unknown }[] }

type Claim = RelationClaim | AttributeClaim;
const short = (id: string) => id.slice(0, 8);
const esc = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

export async function runInvestigator(inv: InvestigationRow, deps: InvestigatorDeps): Promise<InvestigatorResult> {
  const { ctx, model } = deps;
  const log = deps.log ?? (() => {});
  const trace = deps.trace ?? (() => {});
  const blobs = new FsBlobStore();
  const staged = new Map<string, { source: SourceRow; claims: Claim[] }>();
  let toolUsd = 0, modelUsd = 0, stopped: string | null = null, report = "";
  const usdTotal = () => toolUsd + modelUsd;
  const caps = new Map((await listCapabilities()).map((c) => [c.id, c]));

  // ---- helpers -------------------------------------------------------------------------------------------
  let graphCache: { g: Graph; at: number } | null = null;
  const graph = async (fresh = false) => { if (fresh || !graphCache || Date.now() - graphCache.at > 20_000) graphCache = { g: await loadGraph(inv.id), at: Date.now() }; return graphCache.g; };
  const findEnt = (g: Graph, ref: string): GEntity | undefined => {
    const raw = ref.trim().replace(/^(entity|link|attr|attribute):/i, "");
    const q = raw.toLowerCase();
    const all = [...g.entities.values()];
    const byClaims = (xs: GEntity[]) => xs.sort((a, b) => b.claim_count - a.claim_count)[0];
    return all.find((e) => e.id === raw || (raw.length >= 6 && e.id.startsWith(raw)))
      ?? byClaims(all.filter((e) => e.name.toLowerCase() === q))
      ?? byClaims(all.filter((e) => e.aliases.some((a) => a.toLowerCase() === q)))
      ?? byClaims(all.filter((e) => e.name.toLowerCase().includes(q)));
  };
  const dossier = (g: Graph, e: GEntity, limit = 40): string => {
    const out = (g.out.get(e.id) ?? []), inn = (g.inn.get(e.id) ?? []), at = g.attrsOf.get(e.id) ?? [];
    const keys = Object.entries(e.keys).map(([k, v]) => `${k}=${v.join(",")}`).join(" ");
    const L = (l: typeof out[number], dir: "→" | "←") => { const o = g.entities.get(dir === "→" ? l.dst : l.src); return `  ${dir} ${l.predicate}${l.predicate_specific ? "[" + l.predicate_specific.replace(/^candidate:/, "") + "]" : ""} ${o?.name ?? "?"} [${o?.type ?? "?"}]  (${l.grade}, ${l.independent_origins} origin${l.independent_origins === 1 ? "" : "s"}${l.contested ? ", CONTESTED" : ""})  link:${short(l.id)}  entity:${short(o?.id ?? "")}`; };
    return [`${e.name} [${e.type}${e.kind ? "/" + e.kind : ""}]  entity:${short(e.id)}  ${e.claim_count} claims${e.aliases.length > 1 ? "  aka " + e.aliases.filter((a) => a !== e.name).slice(0, 5).join(" | ") : ""}${keys ? "  keys: " + keys : ""}`,
      ...at.slice(0, limit).map((a) => `  · ${a.key}${a.key_specific ? "[" + a.key_specific.replace(/^candidate:/, "") + "]" : ""} = ${a.value}  (${a.grade}${a.contested ? ", CONTESTED" : ""})  attr:${short(a.id)}`),
      ...out.slice(0, limit).map((l) => L(l, "→")), ...inn.slice(0, limit).map((l) => L(l, "←")),
      (out.length + inn.length + at.length > limit * 3 ? `  … more (use graph_sql or graph_ego with a filter)` : "")].filter(Boolean).join("\n");
  };
  const stageSource = async (url: string): Promise<{ src: SourceRow | null; msg?: string }> => {
    const existing = await findSourceByUrl(inv.id, url);
    if (existing?.status === "failed") return { src: null, msg: "that page failed to fetch earlier; try another or an archived copy" };
    if (existing?.status === "retracted") return { src: null, msg: "that source was retracted in this investigation" };
    if (existing) return { src: existing };
    try {
      const r = await fetchUrl(url);
      const hash = sha256(r.text); const dup = await findSourceByHash(inv.id, hash);
      if (dup) return { src: dup };
      const key = blobKey(inv.id, hash, r.raw_ext); blobs.put(key, r.raw);
      const snapKey = r.rendered ? blobKey(inv.id, hash, "snapshot.html") : null; if (snapKey && r.rendered) blobs.put(snapKey, r.rendered);
      const host = (() => { try { return new URL(r.final_url).hostname; } catch { return null; } })();
      const src = await insertSource({ investigation_id: inv.id, url, final_url: r.final_url, domain: host, kind: r.kind, fetch_method: r.method, http_status: r.http_status, content_hash: hash, blob_key: key, text: r.text, link_table: r.link_table, title: r.title, published_at: r.published_at ? new Date(r.published_at) : null, lang: r.lang, status: "fetched", error: null, meta: { attempts: r.attempts, links: r.links.length, by: "investigator" }, tier: null, tier_kind: null, snapshot_key: snapKey, captured_at: new Date() });
      return { src };
    } catch (e) { return { src: null, msg: "could not fetch: " + String((e as Error).message).slice(0, 160) }; }
  };
  const note = async (kind: string, title: string | null, body: string, refs: unknown[] = []) => { await query(`INSERT INTO notes (id, investigation_id, kind, title, body, refs) VALUES ($1,$2,$3,$4,$5,$6)`, [uuidv7(), inv.id, kind, title, body, JSON.stringify(refs)]); };
  /** a claim the agent asserts itself must cite a source it has read (a page or a capability result) and a quote on it */
  const sourceForAssertion = async (url: string, quote: string): Promise<{ src: SourceRow } | { err: string }> => {
    const st = staged.get(url); const src = st?.source ?? (await findSourceByUrl(inv.id, url));
    if (!src) return { err: "cite a url you have read with read_url (or a capability:// source url)" };
    if (src.status === "retracted") return { err: "that source is retracted" };
    const text = src.text ?? "";
    if (quote.length < 8 || !text.toLowerCase().includes(quote.slice(0, 80).toLowerCase())) return { err: "the quote must be verbatim text from that source" };
    return { src };
  };
  const assertClaims = async (src: SourceRow, out: ExtractionOutput, tag: string): Promise<Claim[]> => {
    const text = src.text ?? "";
    const chunk = { index: 0, start: 0, end: text.length, text, hash: sha256(`${tag}|${src.id}|${JSON.stringify(out.relations)}|${JSON.stringify(out.attributes)}`) };
    const { claims } = buildClaims({ ...ctx, model: { ...ctx.model, id: `agent:${model.id}` } }, src, chunk, out, promptVersion(ctx.registry), 0, new Set(), src.published_at ? String(src.published_at).slice(0, 10) : null);
    await insertClaimsBatch(claims);
    return claims;
  };
  const mention = (ref: string, name: string, type: string) => ({ ref, surface: name, name, type, type_label: "", type_parent: "", kind: "", hints: [] as { key: string; value: string }[] });
  const noTime = { temporal_kind: "timeless" as const, valid_from: "", valid_to: "", date: "", time_qualifier: "unknown" as const, inferred: false, derivation: "" };

  // ---- tools --------------------------------------------------------------------------------------------
  const tools: ToolDef[] = [
    { name: "consult_playbook", description: `Read a section of the investigator's playbooks (method, search operators, patterns by target, hypotheses, stopping…). Topics: ${playbookTopics().join(", ")}. Call with no topic to list.`, input_schema: { type: "object", properties: { topic: { type: "string" } } } },
    { name: "search", description: `Web search. engine: ${ENGINE_NAMES.join("|")} (google default; exa is semantic). page: 1,2,3… — go past page 1. Operators (site:, inurl:, filetype:, "exact", -term, before:/after:, AROUND(n)) work as written; see consult_playbook("search/google operators"). Returns ranked hits with snippets; snippets are not evidence — read the page.`, input_schema: { type: "object", properties: { query: { type: "string" }, engine: { type: "string" }, page: { type: "integer" }, lang: { type: "string", description: "ISO-639 code, optional" } }, required: ["query"] } },
    { name: "read_url", description: "Fetch a page and extract candidate claims (numbered). Nothing enters the graph until you contribute. Also returns the page's own text head so you can judge it.", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "read_text", description: "Return a window of a fetched page's raw text (for reading legal pages, footers, lists the extractor skipped). from = character offset.", input_schema: { type: "object", properties: { url: { type: "string" }, from: { type: "integer" }, chars: { type: "integer" } }, required: ["url"] } },
    { name: "look_at", description: "Look at an image (a photo URL — e.g. an 'image:' pivot from a profile or post). A vision model reads any text in it, describes the people (apparent age/role, NOT who they are), animals, objects, place cues (signs, landmarks, plates → geolocation) and time cues, and answers your question if you ask one. The image becomes a source with numbered candidate claims; contribute what is supported. Use it on the subject's own photos — it is where the brother, the dog, the town and the era come from. It does NOT identify faces; that is a separate tool.", input_schema: { type: "object", properties: { url: { type: "string" }, question: { type: "string" } }, required: ["url"] } },
    { name: "contribute", description: "Commit chosen candidate claims from a page you read. indices omitted = all. Only relevant, supported claims.", input_schema: { type: "object", properties: { url: { type: "string" }, indices: { type: "array", items: { type: "integer" } } }, required: ["url"] } },
    { name: "list_capabilities", description: "The connector arsenal: id, what it consumes (domain/email/username/name/org/ip/…), what it emits, grade, whether it is enabled (keyed).", input_schema: { type: "object", properties: {} } },
    { name: "run_capability", description: "Run one connector on one value (e.g. infra.rdap on a domain, people.username on a handle, org.wikidata on a name, org.court on an org). Cache-first. Its graded facts are written to the graph as a source you can retract; you get the summary and the new pivot values.", input_schema: { type: "object", properties: { id: { type: "string" }, value: { type: "string" }, refetch: { type: "boolean" } }, required: ["id", "value"] } },
    { name: "graph_lookup", description: "Dossier of an entity by name, alias or id prefix: attributes, links in/out with grades, origins, contested flags, and the ids you need for why/link/retract.", input_schema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] } },
    { name: "graph_ego", description: "The neighbourhood of an entity up to N hops (default 1), optionally filtered to one predicate.", input_schema: { type: "object", properties: { ref: { type: "string" }, hops: { type: "integer" }, predicate: { type: "string" } }, required: ["ref"] } },
    { name: "graph_paths", description: "Shortest paths between two entities (the surprising N-hop link).", input_schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, max_len: { type: "integer" } }, required: ["a", "b"] } },
    { name: "graph_timeline", description: "Dated facts of an entity, earliest first; undated last. Gaps are leads.", input_schema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] } },
    { name: "graph_contested", description: "Facts with conflicting evidence (optionally for one entity).", input_schema: { type: "object", properties: { ref: { type: "string" } } } },
    { name: "graph_gaps", description: "Two ranked suggestion lists (not orders): INDICATOR GAPS (what the goal still lacks) and UNOPENED entities (people/accounts/orgs linked to the case but never investigated — referenced yet with no facts gathered about them). Use it in the ASSESS step: opening the top unopened leads is how the case keeps going instead of stalling when searches dry up.", input_schema: { type: "object", properties: { limit: { type: "integer" } } } },
    { name: "graph_sql", description: "Read-only SQL over this investigation's graph tables (entities, links, attributes, relation_claims, attribute_claims, sources, notes, hypotheses, decisions). SELECT only; an investigation_id filter is added for you where the table has one. Use for anything the other graph tools don't cover.", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
    { name: "graph_duplicates", description: "Groups of entities that look like the same thing: same name, one name inside another (kim / halokim), a shared handle between a person and an account, or a person and an account with the same handle. Resolve each group with same_as (quote) / not_same_as (reason) before you finish.", input_schema: { type: "object", properties: {} } },
    { name: "why", description: "The evidence behind a link or attribute id (from graph_lookup): claims, quotes, sources, publisher kinds, independent origins.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["link", "attribute", "entity"] }, id: { type: "string" } }, required: ["kind", "id"] } },
    { name: "link", description: "Assert a relationship yourself, backed by a verbatim quote from a page you read: subject —predicate→ object. Use an ontology predicate (works_at, owns, member_of, founded, controls, located_in, uses_account, party_to, paid, knows, spouse_of, …) or a candidate label. Types: person|organization|place|account|document|legal_matter|event|asset.", input_schema: { type: "object", properties: { subject: { type: "string" }, subject_type: { type: "string" }, predicate: { type: "string" }, object: { type: "string" }, object_type: { type: "string" }, url: { type: "string" }, quote: { type: "string" }, from: { type: "string", description: "start date (EDTF) if any" }, to: { type: "string" }, qualifiers: { type: "object", additionalProperties: { type: "string" } } }, required: ["subject", "subject_type", "predicate", "object", "object_type", "url", "quote"] } },
    { name: "attribute", description: "Assert an attribute yourself with a quote: entity · key = value (keys: aliases, description, status, date_of_birth, nationality, occupation, website, registry_id (scheme:value), address, founded_on, …).", input_schema: { type: "object", properties: { entity: { type: "string" }, entity_type: { type: "string" }, key: { type: "string" }, value: { type: "string" }, url: { type: "string" }, quote: { type: "string" } }, required: ["entity", "entity_type", "key", "value", "url", "quote"] } },
    { name: "same_as", description: "Assert two names are one entity, with a quote from a page you read. Recorded as an alias claim; the judge confirms the merge on rebuild.", input_schema: { type: "object", properties: { name_a: { type: "string" }, name_b: { type: "string" }, url: { type: "string" }, quote: { type: "string" } }, required: ["name_a", "name_b", "url", "quote"] } },
    { name: "not_same_as", description: "Record that two entities the build merged (or might merge) are different, with your reason. Reversible decision.", input_schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, reason: { type: "string" } }, required: ["a", "b", "reason"] } },
    { name: "split", description: "Un-merge an entity the build wrongly fused (all its member records become separate again), with your reason. Reversible.", input_schema: { type: "object", properties: { ref: { type: "string" }, reason: { type: "string" } }, required: ["ref", "reason"] } },
    { name: "retract", description: "Retract a source (a page url, a capability:// url, or a domain) and every claim it produced, with a reason. Reversible.", input_schema: { type: "object", properties: { source: { type: "string" }, reason: { type: "string" } }, required: ["source", "reason"] } },
    { name: "hypothesis", description: "Create or update a hypothesis on the board. Give id to update. status: open|supported|disproved|abandoned. evidence: what you found for (+) or against (-) it, citing claim/link ids.", input_schema: { type: "object", properties: { id: { type: "string" }, statement: { type: "string" }, status: { type: "string" }, evidence: { type: "string" }, next_action: { type: "string" } } } },
    { name: "hypotheses", description: "The hypothesis board.", input_schema: { type: "object", properties: {} } },
    { name: "note", description: "Write to your notebook. kind: plan|note|query|lead. This is your durable memory; the transcript is trimmed as it grows.", input_schema: { type: "object", properties: { kind: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["kind", "body"] } },
    { name: "notebook", description: "Read your notebook (latest first), optionally one kind.", input_schema: { type: "object", properties: { kind: { type: "string" }, limit: { type: "integer" } } } },
    { name: "rebuild", description: "Rebuild the graph from all claims (resolution, grading, slots). Do it after a batch of contributions.", input_schema: { type: "object", properties: {} } },
    { name: "judge", description: "Have the identity judge decide the open same-entity hypotheses (cheap LLM verdicts, recorded and reversible), then rebuild.", input_schema: { type: "object", properties: {} } },
    { name: "cost", description: "Money and steps spent so far, and the ceiling if any.", input_schema: { type: "object", properties: {} } },
    { name: "send_message", description: "Say something to the person you are working for: a finding as soon as it is solid, a question, a plan, a caveat. Short, plain, specific; cite ids in square brackets at the end of a sentence (e.g. [link:845710f1]) so they can tap the evidence. Send as many as the work deserves — the conversation is the report.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "ask_graph", description: "Ask the graph analyst a question about the current graph (a read-only one-shot run over the graph alone). Use it to check what the graph already establishes before collecting more, or to get a synthesis you would otherwise spend many lookups on.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
    { name: "group_entities", description: "Group entities that are best seen as one thing (a corporate chain — parent, holdings, finance vehicles; a brand and its legal entities; a person's accounts). The graph draws the group as one node that opens on tap. Give a label and the entity refs (names or ids). Grouping is presentation; it never merges records.", input_schema: { type: "object", properties: { label: { type: "string" }, members: { type: "array", items: { type: "string" } }, why: { type: "string" } }, required: ["label", "members"] } },
    { name: "ungroup", description: "Dissolve a group by id or label.", input_schema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] } },
    { name: "groups", description: "List the current groups.", input_schema: { type: "object", properties: {} } },
    { name: "finish", description: "End your turn. In a conversation: call it when you are waiting on the person or the case is done for now (say what you have with send_message first; report may be empty). In a one-shot run: the final report (see consult_playbook('investigator/report')).", input_schema: { type: "object", properties: { report: { type: "string" }, verdict: { type: "string", enum: ["answered", "partial", "unanswerable"] } }, required: [] } },
  ];

  let steps = 0, saidThisTurn = 0;
  const exec = async (name: string, input: Record<string, unknown>): Promise<string> => {
    steps++;
    const S = (k: string) => (input[k] == null ? "" : String(input[k])).trim();
    switch (name) {
      case "consult_playbook": return consultPlaybook(S("topic"));
      case "search": {
        const engine = ENGINE_NAMES.includes(S("engine") as never) ? S("engine") : "google";
        const page = Math.max(1, Number(input.page ?? 1)), q = S("query");
        const ck = `search.${engine}|${q.toLowerCase()}|p${page}${S("lang") ? "|" + S("lang") : ""}`;
        let res: SearchResult; const cached = await getCachedSearch(ck);
        if (cached) res = cached.result as SearchResult;
        else { res = await SEARCH_ENGINES[engine]!(q, { page, lang: S("lang") || undefined }); toolUsd += res.usd; await putCachedSearch(ck, `search.${engine}`, { q, page }, res, "7 days"); }
        await note("query", `${engine} p${page}`, `${q} → ${res.hits.length} hits${res.hits.length ? ": " + res.hits.slice(0, 5).map((h) => h.url).join(" ") : ""}`);
        if (!res.hits.length) return `no results on ${engine} page ${page}`;
        return `${engine} page ${page}${res.more ? " (more pages available)" : ""}:\n` + res.hits.map((h) => `${h.rank}. ${h.url}\n   ${h.title ?? ""}${h.snippet ? " — " + esc(h.snippet).slice(0, 160) : ""}${h.published_at ? "  [" + h.published_at + "]" : ""}`).join("\n");
      }
      case "read_url": {
        const url = S("url");
        if (staged.has(url)) { const st = staged.get(url)!; return summarize(url, st); }
        const { src, msg } = await stageSource(url);
        if (!src) return msg ?? "could not fetch";
        if (!src.text) return "page had no readable text";
        if (src.status === "extracted") {
          const [c] = await query<{ n: string }>(`SELECT (SELECT count(*) FROM relation_claims WHERE source_id=$1 AND status='raw') + (SELECT count(*) FROM attribute_claims WHERE source_id=$1 AND status='raw') n`, [src.id]);
          staged.set(url, { source: src, claims: [] });
          return `already read earlier: ${c?.n ?? 0} facts from it are in the graph. Page head:\n${src.text.slice(0, 1500)}\n(use read_text for more; graph_lookup for what it yielded)`;
        }
        const { claims, usd: u, publisher_name, publisher_kind } = await extractClaimsOnly(ctx, src);
        toolUsd += u;
        if (publisher_name) await setSourcePublisher(src.id, publisher_name, publisher_kind ?? "unknown");
        staged.set(url, { source: src, claims });
        return summarize(url, { source: src, claims }) + `\n\nPage head:\n${src.text.slice(0, 1200)}`;
      }
      case "read_text": {
        const url = S("url"); const src = staged.get(url)?.source ?? (await findSourceByUrl(inv.id, url));
        if (!src?.text) return "not fetched yet — read_url first";
        const from = Math.max(0, Number(input.from ?? 0)), chars = Math.min(8000, Math.max(500, Number(input.chars ?? 4000)));
        return `[${from}..${Math.min(src.text.length, from + chars)} of ${src.text.length}]\n` + src.text.slice(from, from + chars);
      }
      case "look_at": {
        if (!hasVisionKey()) return "vision is off (no GEMINI_API_KEY)";
        const url = S("url"), question = input.question ? S("question") : undefined;
        // an image is a source, keyed by url + question so a re-ask with a new question restages
        const skey = question ? `${url}#q=${question.slice(0, 60)}` : url;
        if (staged.has(skey)) return summarize(skey, staged.get(skey)!);
        const existing = await findSourceByUrl(inv.id, skey);
        if (existing?.status === "extracted" && !question) return `already looked at earlier — its facts are in the graph.\n${(existing.text ?? "").slice(0, 1200)}`;
        let img: { buf: Buffer; contentType: string };
        try { img = await fetchImage(url); } catch (e) { return "could not fetch the image: " + String((e as Error).message).slice(0, 160); }
        let vis; try { vis = await lookAt({ bytes: img.buf, mime: img.contentType, question, model: deps.visionModel }); }
        catch (e) { return "vision failed: " + String((e as Error).message).slice(0, 160); }
        toolUsd += vis.usd;
        const text = visionToText(vis.result, url);
        const hash = sha256(text + skey);
        const ext = (img.contentType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        const key = blobKey(inv.id, sha256(img.buf), ext); blobs.put(key, img.buf); // keep the pixels — IG CDN urls expire
        const host = (() => { try { return new URL(url).hostname; } catch { return null; } })();
        const source = existing ?? await insertSource({ investigation_id: inv.id, url: skey, final_url: url, domain: host, kind: "image", fetch_method: "http", http_status: 200, content_hash: hash, blob_key: key, text, link_table: [], title: vis.result.scene.slice(0, 200), published_at: null, lang: null, status: "fetched", error: null, meta: { vision: vis.result, by: "investigator", bytes: vis.bytes }, tier: null, tier_kind: null, snapshot_key: null, captured_at: new Date() });
        const { claims, usd: u } = await extractClaimsOnly(ctx, source);
        toolUsd += u;
        staged.set(skey, { source, claims });
        return `looked at ${src(url)} —\n${text}\n\n` + summarize(skey, { source, claims });
      }
      case "contribute": {
        const url = S("url"); const st = staged.get(url);
        if (!st) return "read that url first";
        if (!st.claims.length) return "nothing staged from that page (it was read earlier or had no claims)";
        const idx = Array.isArray(input.indices) ? new Set((input.indices as number[]).map(Number)) : null;
        const pick = idx ? st.claims.filter((_, i) => idx.has(i)) : st.claims;
        await insertClaimsBatch(pick); await updateSourceStatus(st.source.id, "extracted");
        st.claims = st.claims.filter((c) => !pick.includes(c));
        return `committed ${pick.length} claim${pick.length === 1 ? "" : "s"} from ${src(url)} (rebuild to see them resolved)`;
      }
      case "list_capabilities": return CAP_RUNNERS.map((r) => { const row = caps.get(r.id); return `${r.id.padEnd(24)} consumes ${r.consumes.join("|") || "(cli-only args)"}  → ${(row?.outputs ?? []).join(", ")}  grade ${(row?.spec as { grade?: string } | undefined)?.grade ?? "?"}  ${row?.enabled ? "ON" : "OFF (needs " + JSON.stringify(row?.requires ?? {}) + ")"}${(row?.spec as { note?: string } | undefined)?.note ? "  — " + (row!.spec as { note: string }).note : ""}`; }).join("\n");
      case "run_capability": {
        const id = S("id"), value = S("value"); const runner = CAP_RUNNERS.find((r) => r.id === id);
        if (!runner) return `unknown capability ${id}; see list_capabilities`;
        const row = caps.get(id); if (row && !row.enabled) return `${id} is disabled (needs ${JSON.stringify(row.requires)})`;
        const kind = (runner.consumes[0] ?? "name") as PivotKind;
        const ck = cacheKeyFor(id, kind, value);
        const cached = input.refetch ? null : await getCachedSearch(ck);
        let result = cached ? (cached.result as Awaited<ReturnType<typeof runner.run>>) : null;
        if (!result) { result = await runner.run([value], kind); await putCachedSearch(ck, id, { kind, value }, { ...result, raw: undefined }, typeof row?.cache_ttl === "string" ? row.cache_ttl : "7 days"); }
        const facts = result.entities.length + result.edges.length + result.attributes.length;
        let landed = "";
        if (facts) { const ing = await ingestCapability(inv.id, ctx, result, value); landed = ing.status === "duplicate" ? "already in the graph from an earlier run" : `${ing.claims} claims written (source ${result.provenance.url ?? "capability://" + id + "/" + value})`; }
        await query(`INSERT INTO actions (id, investigation_id, kind, target, capability_id, state, result, cost_usd, seconds, dedupe_key, started_at, finished_at) VALUES ($1,$2,'capability',$3,$4,'done',$5,0,0,$6,now(),now())`, [uuidv7(), inv.id, JSON.stringify({ kind, value, by: "investigator" }), id, `${facts} facts; ${landed}`, `${id}|${kind}|${value.toLowerCase()}`]);
        const p = result.provenance;
        return [`${id}(${value}) → ${p.source} · grade ${p.grade}${p.note ? " · note: " + p.note : ""}`, landed || "no facts", ...result.entities.slice(0, 12).map((e) => `  • ${e.name} [${e.type}${e.kind ? "/" + e.kind : ""}]`), ...result.edges.slice(0, 20).map((e) => `  → ${e.subject} —${e.predicate}→ ${e.object}${e.at ? " (" + e.at + ")" : e.from ? " (" + e.from + "→" + (e.to ?? "") + ")" : ""}${e.value ? " =" + e.value : ""}`), ...result.attributes.slice(0, 15).map((a) => `  · ${a.entity}: ${a.key} = ${a.value}`), result.pivots.length ? `  pivots: ${result.pivots.slice(0, 20).map((pv) => `${pv.kind}:${pv.value}${pv.weak ? "~" : ""}`).join("  ")}` : ""].filter(Boolean).join("\n");
      }
      case "graph_lookup": {
        const g = await graph(); const e = findEnt(g, S("ref"));
        if (!e) return `"${S("ref")}" is not in the graph (${g.entities.size} entities). Try graph_sql: SELECT canonical_name, type FROM entities WHERE canonical_name ILIKE '%…%'`;
        const same = [...g.entities.values()].filter((x) => x.id !== e.id && x.name.toLowerCase() === e.name.toLowerCase());
        return dossier(g, e) + (same.length ? `\n\nOTHER ENTITIES WITH THIS NAME (kept apart on purpose — different identifiers; use same_as/not_same_as if you can tell): ` + same.map((x) => `${x.name} [${x.type}${x.kind ? "/" + x.kind : ""}] entity:${short(x.id)} ${x.claim_count} claims${Object.keys(x.keys).length ? " keys " + Object.entries(x.keys).map(([k, v]) => k + "=" + v.join(",")).join(" ") : ""}`).join("; ") : "");
      }
      case "graph_ego": {
        const g = await graph(); const e = findEnt(g, S("ref")); if (!e) return "not in the graph";
        const sub = ego(g, e.id, Math.min(3, Number(input.hops ?? 1)), { limit: 60, ...(S("predicate") ? { predicates: [S("predicate")] } : {}) } as never);
        return `${sub.entities.length} entities, ${sub.links.length} links around ${e.name}${sub.truncated ? " (truncated)" : ""}:\n` + sub.links.map((l) => `  ${g.entities.get(l.src)?.name} —${l.predicate}→ ${g.entities.get(l.dst)?.name}  (${l.grade})`).join("\n");
      }
      case "graph_paths": {
        const g = await graph(); const a = findEnt(g, S("a")), b = findEnt(g, S("b")); if (!a || !b) return "one of the two is not in the graph";
        const r = paths(g, a.id, b.id, Math.min(5, Number(input.max_len ?? 3)));
        if (!r.paths.length) return `no path of length ≤ ${Number(input.max_len ?? 3)} between ${a.name} and ${b.name}`;
        return r.paths.slice(0, 8).map((p, i) => `${i + 1}. ` + (p as { links: typeof r.sub.links }).links.map((l) => `${g.entities.get(l.src)?.name} —${l.predicate}→ ${g.entities.get(l.dst)?.name}`).join("  ;  ")).join("\n");
      }
      case "graph_timeline": {
        const g = await graph(); const e = findEnt(g, S("ref")); if (!e) return "not in the graph";
        const t = timeline(g, e.id);
        return t.length ? t.map((x) => `${x.at ?? "?"}${x.until ? " → " + x.until : ""}  ${x.direction === "out" ? "" : "← "}${x.link.predicate} ${g.entities.get(x.direction === "out" ? x.link.dst : x.link.src)?.name}  (${x.link.grade})`).join("\n") : "no dated facts";
      }
      case "graph_contested": {
        const g = await graph(); const e = S("ref") ? findEnt(g, S("ref")) : undefined;
        const c = contested(g, e?.id);
        return (c.links.length + c.attributes.length) ? [...c.links.map((l) => `link:${short(l.id)} ${g.entities.get(l.src)?.name} —${l.predicate}→ ${g.entities.get(l.dst)?.name} (${l.evidence_count} claims)`), ...c.attributes.map((a) => `attr:${short(a.id)} ${g.entities.get(a.entity)?.name} · ${a.key} = ${a.value}`)].join("\n") : "nothing contested";
      }
      case "graph_gaps": {
        const g = await graph(); const q = (await openQuestions(inv.id))[0];
        const subj = (q?.subject_entity_id && g.entities.get(q.subject_entity_id)) || findEnt(g, inv.seed.name) || [...g.entities.values()].sort((a, b) => b.claim_count - a.claim_count)[0];
        if (!subj) return "empty graph — start by reading the seed and running connectors on it";
        const lim = Math.min(40, Number(input.limit ?? 20));
        const parts: string[] = [];
        if (q) { const drafts = buildMissions(computeGaps(g, subj.id, q.indicators, 2, { maxRing: 2 })); if (drafts.length) parts.push("INDICATOR GAPS (what the goal still lacks):\n" + drafts.slice(0, lim).map((d) => `  ${d.score.toFixed(2)}  ${d.objective}`).join("\n")); }
        const unopened = unopenedLeads(g, subj.id, lim);
        if (unopened.length) parts.push(`UNOPENED (linked to the case but never investigated — open the ones worth the cost):\n${unopened.join("\n")}`);
        return parts.join("\n\n") || "no gaps and nothing unopened within 2 hops — the case is saturated at this radius (widen the subject, or the stopping bar may be met)";
      }
      case "graph_sql": {
        const sql = S("sql").replace(/;\s*$/, "");
        if (!/^\s*(select|with)\b/i.test(sql) || /\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(sql)) return "SELECT only";
        // scope: every investigation-bearing table is shadowed by a CTE filtered to THIS investigation, so the agent
        // can write plain `FROM entities` and never sees another case's rows
        const scoped = ["entities", "links", "attributes", "relation_claims", "attribute_claims", "sources", "notes", "hypotheses", "decisions", "missions", "actions", "resolution_decisions", "slots", "extractions"];
        const ctes = scoped.map((t) => `${t} AS (SELECT * FROM ${t} WHERE investigation_id = '${inv.id}')`).join(", ");
        try {
          const rows = await query<Record<string, unknown>>(`WITH ${ctes} SELECT * FROM (${sql}) q LIMIT 200`, []);
          return rows.length ? JSON.stringify(rows.slice(0, 200)).slice(0, 10_000) : "no rows";
        } catch (e) { return "sql error: " + String((e as Error).message).slice(0, 300); }
      }
      case "graph_duplicates": {
        const g = await graph(true);
        const all = [...g.entities.values()].filter((e) => e.type === "person" || e.type === "organization" || e.type === "account");
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const groups: string[][] = [];
        const seen = new Set<string>();
        const add = (xs: GEntity[], why: string) => { const key = xs.map((x) => x.id).sort().join("|"); if (xs.length < 2 || seen.has(key)) return; seen.add(key); groups.push([why, ...xs.map((x) => `${x.name} [${x.type}${x.kind ? "/" + x.kind : ""}] entity:${short(x.id)} ${x.claim_count}c${Object.keys(x.keys).length ? " keys " + Object.entries(x.keys).map(([k, v]) => k + "=" + v.join(",")).join(" ") : ""}`)]); };
        const byName = new Map<string, GEntity[]>();
        for (const e of all) { const k = `${e.type}|${norm(e.name)}`; (byName.get(k) ?? byName.set(k, []).get(k)!).push(e); }
        for (const [k, xs] of byName) if (xs.length > 1) add(xs, `same name (${k.split("|")[0]})`);
        const compact = (e: GEntity) => norm(e.name).replace(/ /g, "");
        for (const a of all) { const ca = compact(a); if (ca.length < 4 || ca.length > 12 || norm(a.name).includes(" ")) continue; for (const b of all) { if (a === b || a.type !== b.type) continue; const cb = compact(b); if (cb.length > ca.length && cb.includes(ca)) add([a, b], "name contained in name"); } }
        const persons = all.filter((e) => e.type === "person"), accounts = all.filter((e) => e.type === "account");
        for (const p of persons) { const hs = new Set([...(p.keys.handle ?? []), ...(p.keys.email ?? [])].map((v) => v.toLowerCase().replace(/^@/, ""))); if (!hs.size) continue;
          for (const q of persons) if (q !== p && [...(q.keys.handle ?? []), ...(q.keys.email ?? [])].some((v) => hs.has(v.toLowerCase().replace(/^@/, "")))) add([p, q], "shared handle/email");
          for (const acc of accounts) if ((acc.keys.identifier ?? []).some((v) => hs.has(v.toLowerCase().replace(/^@/, "")))) add([p, acc], "person owns this account (linked by handle; fine to leave as two nodes)"); }
        if (!groups.length) return "no duplicate-looking groups";
        const NL = String.fromCharCode(10);
        return groups.map((gr) => `• ${gr[0]}${NL}    ${gr.slice(1).join(NL + "    ")}`).join(NL);
      }
      case "why": {
        const g = await graph(); const kind0 = S("kind"); let id = S("id");
        const pm = /^(link|attr|attribute|entity|claim):/i.exec(id); if (pm) id = id.slice(pm[0].length);
        const kind = ((pm?.[1]?.toLowerCase() === "attr" ? "attribute" : pm?.[1]?.toLowerCase()) || kind0 || "link") as "link" | "attribute" | "entity";
        if (id.length < 36) { const pool = kind === "link" ? g.links.map((l) => l.id) : kind === "attribute" ? g.attributes.map((a) => a.id) : [...g.entities.keys()]; id = pool.find((x) => x.startsWith(id)) ?? id; }
        const w = await why(inv.id, kind, id);
        return `${w.label}\n${w.claims.length} claims · ${w.origins} independent origins\n` + w.claims.map((c) => `  [${c.publisher_kind ?? "?"}] ${c.domain} ${c.asserted_at ?? ""}\n    “${esc(c.quote).slice(0, 240)}”\n    ${c.url}`).join("\n") + (w.decisions?.length ? `\ndecisions: ${w.decisions.map((d) => d.method + " " + d.verdict + (d.note ? " — " + d.note.slice(0, 80) : "")).join("; ")}` : "");
      }
      case "link": {
        const s = await sourceForAssertion(S("url"), S("quote")); if ("err" in s) return s.err;
        const quals = Object.entries((input.qualifiers as Record<string, string>) ?? {}).map(([key, value]) => ({ key, value: String(value) }));
        const pred = S("predicate"); const known = ctx.registry.extractablePredicates.includes(pred);
        const out: ExtractionOutput = { mentions: [mention("m1", S("subject"), S("subject_type") || "person"), mention("m2", S("object"), S("object_type") || "organization")], attributes: [],
          relations: [{ subject: "m1", predicate: known ? pred : "candidate", candidate_label: known ? "" : pred, candidate_parent: "", object: "m2", qualifiers: quals, quote: S("quote"), attributed_to: "", confidence: 1, attribute_class: "public", ...noTime, ...(S("from") || S("to") ? { temporal_kind: "interval" as const, valid_from: S("from"), valid_to: S("to"), time_qualifier: "exact" as const } : {}) }],
          page: { published_at: "", summary: "", publisher_name: "", publisher_kind: "" } };
        const claims = await assertClaims(s.src, out, "link");
        const c = claims[0]; return c?.status === "raw" ? `recorded: ${S("subject")} —${pred}→ ${S("object")} (claim ${short(c.id)}); rebuild to resolve` : `rejected: ${c?.reject_reason ?? "?"} — check the predicate's domain/range for those types`;
      }
      case "attribute": {
        const s = await sourceForAssertion(S("url"), S("quote")); if ("err" in s) return s.err;
        const out: ExtractionOutput = { mentions: [mention("m1", S("entity"), S("entity_type") || "person")], relations: [],
          attributes: [{ entity: "m1", key: S("key"), key_parent: "", value: S("value"), datatype: "string", quote: S("quote"), attributed_to: "", confidence: 1, attribute_class: "public", ...noTime }],
          page: { published_at: "", summary: "", publisher_name: "", publisher_kind: "" } };
        const claims = await assertClaims(s.src, out, "attr");
        const c = claims[0]; return c?.status === "raw" ? `recorded: ${S("entity")} · ${S("key")} = ${S("value")} (claim ${short(c.id)})` : `rejected: ${c?.reject_reason ?? "?"}`;
      }
      case "same_as": {
        const s = await sourceForAssertion(S("url"), S("quote")); if ("err" in s) return s.err;
        const g = await graph(); const type = findEnt(g, S("name_a"))?.type ?? "person";
        const out: ExtractionOutput = { mentions: [mention("m1", S("name_a"), type)], relations: [], attributes: [{ entity: "m1", key: "aliases", key_parent: "", value: S("name_b"), datatype: "string", quote: S("quote"), attributed_to: "", confidence: 1, attribute_class: "public", ...noTime, derivation: "agent_same_as" }], page: { published_at: "", summary: "", publisher_name: "", publisher_kind: "" } };
        await assertClaims(s.src, out, "same_as");
        // when both are already graph entities, your quote-backed assertion is a judgment: record it as a reversible
        // 'same' decision between their member records (like the judge does), so the next rebuild merges them
        const ea = findEnt(g, S("name_a")), eb = findEnt(g, S("name_b"));
        let n = 0;
        if (ea && eb && ea.id !== eb.id && ea.type === eb.type) {
          const ma = await query<{ provisional_id: string }>(`SELECT provisional_id FROM entity_members WHERE entity_id=$1`, [ea.id]), mb = await query<{ provisional_id: string }>(`SELECT provisional_id FROM entity_members WHERE entity_id=$1`, [eb.id]);
          for (const x of ma) for (const y of mb) { let pa = x.provisional_id, pb = y.provisional_id; if (pa > pb) [pa, pb] = [pb, pa]; const nid = uuidv7(); await query(`INSERT INTO resolution_decisions (id, investigation_id, a_id, b_id, verdict, method, note) VALUES ($1,$2,$3,$4,'same','llm',$5)`, [nid, inv.id, pa, pb, `investigator same_as: "${S("quote").slice(0, 160)}" (${S("url")})`.slice(0, 900)]); await query(`UPDATE resolution_decisions SET superseded_by=$1 WHERE investigation_id=$2 AND a_id=$3 AND b_id=$4 AND superseded_by IS NULL AND id<>$1`, [nid, inv.id, pa, pb]); n++; }
          await recordDecision(inv.id, { actor: "llm", kind: "merge", subject: { a: ea.id, b: eb.id }, rationale: `same_as ${ea.name} = ${eb.name}: "${S("quote").slice(0, 200)}" (${S("url")})`, reversible_by: "wg unmerge / wg decide" });
        }
        return `recorded: "${S("name_a")}" also known as "${S("name_b")}" with your quote${n ? `; ${n} same-entity decision${n === 1 ? "" : "s"} recorded - rebuild to merge` : "; rebuild + judge to merge"}`;
      }
      case "not_same_as": {
        const g = await graph(); const a = findEnt(g, S("a")), b = findEnt(g, S("b")); if (!a || !b) return "one of the two is not in the graph";
        const ma = await query<{ provisional_id: string }>(`SELECT provisional_id FROM entity_members WHERE entity_id=$1`, [a.id]), mb = await query<{ provisional_id: string }>(`SELECT provisional_id FROM entity_members WHERE entity_id=$1`, [b.id]);
        let n = 0;
        for (const x of ma) for (const y of mb) { let pa = x.provisional_id, pb = y.provisional_id; if (pa > pb) [pa, pb] = [pb, pa]; const nid = uuidv7(); await query(`INSERT INTO resolution_decisions (id, investigation_id, a_id, b_id, verdict, method, note) VALUES ($1,$2,$3,$4,'not_same','llm',$5)`, [nid, inv.id, pa, pb, `investigator: ${S("reason")}`.slice(0, 900)]); await query(`UPDATE resolution_decisions SET superseded_by=$1 WHERE investigation_id=$2 AND a_id=$3 AND b_id=$4 AND superseded_by IS NULL AND id<>$1`, [nid, inv.id, pa, pb]); n++; }
        await recordDecision(inv.id, { actor: "llm", kind: "refer", subject: { a: a.id, b: b.id }, rationale: `not_same_as ${a.name} ↔ ${b.name}: ${S("reason")}`, reversible_by: "wg decide" });
        return `recorded ${n} not-same decision${n === 1 ? "" : "s"} between ${a.name} and ${b.name}; rebuild to apply`;
      }
      case "split": {
        const g = await graph(); const e = findEnt(g, S("ref")); if (!e) return "not in the graph";
        const members = await query<{ provisional_id: string; name: string }>(`SELECT provisional_id, name FROM entity_members WHERE entity_id=$1 ORDER BY claim_count DESC`, [e.id]);
        if (members.length < 2) return `${e.name} has a single member record; nothing to split (maybe you want retract or not_same_as)`;
        for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) { let pa = members[i]!.provisional_id, pb = members[j]!.provisional_id; if (pa > pb) [pa, pb] = [pb, pa]; const nid = uuidv7(); await query(`INSERT INTO resolution_decisions (id, investigation_id, a_id, b_id, verdict, method, note) VALUES ($1,$2,$3,$4,'not_same','llm',$5)`, [nid, inv.id, pa, pb, `investigator split: ${S("reason")}`.slice(0, 900)]); await query(`UPDATE resolution_decisions SET superseded_by=$1 WHERE investigation_id=$2 AND a_id=$3 AND b_id=$4 AND superseded_by IS NULL AND id<>$1`, [nid, inv.id, pa, pb]); }
        await recordDecision(inv.id, { actor: "llm", kind: "split", subject: { entity: e.id, members: members.map((m) => m.provisional_id) }, rationale: `split ${e.name} (${members.map((m) => m.name).join(" | ")}): ${S("reason")}`, reversible_by: "wg decide <a> <b> same" });
        return `split ${e.name} into ${members.length} records: ${members.map((m) => m.name).join(" | ")}; rebuild to apply`;
      }
      case "retract": {
        const ref = S("source");
        const srcs = await query<{ id: string; url: string }>(`SELECT id, coalesce(final_url,url) url FROM sources WHERE investigation_id=$1 AND status<>'retracted' AND (url=$2 OR final_url=$2 OR domain=$2 OR id::text LIKE $3)`, [inv.id, ref, `${ref}%`]);
        if (!srcs.length) return `no active source matching "${ref}"`;
        const ids = srcs.map((x) => x.id); let n = 0;
        await query(`UPDATE sources SET status='retracted', retracted_at=now(), retracted_reason=$2 WHERE id = ANY($1::uuid[])`, [ids, S("reason")]);
        for (const t of ["relation_claims", "attribute_claims"]) n += (await query(`UPDATE ${t} SET status='retracted' WHERE source_id = ANY($1::uuid[]) AND status='raw' RETURNING id`, [ids])).length;
        await recordDecision(inv.id, { actor: "llm", kind: "policy", subject: { sources: ids }, rationale: `investigator retracted ${srcs.map((x) => x.url).join(", ")} (${n} claims): ${S("reason")}`, reversible_by: "wg reinstate" });
        for (const [u, st] of staged) if (ids.includes(st.source.id)) staged.delete(u);
        return `retracted ${srcs.length} source${srcs.length === 1 ? "" : "s"} · ${n} claims; rebuild to apply`;
      }
      case "hypothesis": {
        const id = S("id"), statement = S("statement"), status = S("status") || "open";
        if (!["open", "supported", "disproved", "abandoned"].includes(status)) return "status must be open|supported|disproved|abandoned";
        const ev = S("evidence") ? [{ kind: "agent", note: S("evidence"), at: new Date().toISOString() }] : [];
        if (id) {
          const rows = await query<{ id: string }>(`UPDATE hypotheses SET pattern = pattern || $3::jsonb, status=$4, evidence = evidence || $5::jsonb, updated_at=now() WHERE investigation_id=$1 AND id::text LIKE $2 RETURNING id`, [inv.id, `${id}%`, JSON.stringify({ ...(statement ? { statement } : {}), ...(S("next_action") ? { next_action: S("next_action") } : {}) }), status === "supported" ? "supported" : status, JSON.stringify(ev)]);
          return rows.length ? `updated hypothesis ${short(rows[0]!.id)} → ${status}` : "no such hypothesis id";
        }
        if (!statement) return "statement is required for a new hypothesis";
        const nid = uuidv7();
        await query(`INSERT INTO hypotheses (id, investigation_id, kind, pattern, evidence, status, score) VALUES ($1,$2,'free',$3,$4,$5,0.5)`, [nid, inv.id, JSON.stringify({ statement, next_action: S("next_action") || null }), JSON.stringify(ev), status]);
        return `hypothesis ${short(nid)} recorded: ${statement}`;
      }
      case "hypotheses": {
        const rows = await query<{ id: string; kind: string; pattern: Record<string, string>; status: string; evidence: { note?: string; verdict?: string; reason?: string }[] }>(`SELECT id, kind, pattern, status, evidence FROM hypotheses WHERE investigation_id=$1 AND (kind='free' OR (kind='identity' AND status='open')) ORDER BY kind, created_at`, [inv.id]);
        if (!rows.length) return "board is empty — write your first hypotheses";
        return rows.map((h) => h.kind === "free" ? `${short(h.id)} [${h.status}] ${h.pattern.statement}${h.pattern.next_action ? "\n    next: " + h.pattern.next_action : ""}${(h.evidence ?? []).slice(-3).map((e) => "\n    - " + (e.note ?? e.reason ?? "")).join("")}` : `${short(h.id)} [identity, open] ${(h.pattern as { a_name?: string }).a_name} ↔ ${(h.pattern as { b_name?: string }).b_name}  (judge decides; or use same_as / not_same_as)`).join("\n");
      }
      case "note": { const kind = ["plan", "note", "query", "lead", "report"].includes(S("kind")) ? S("kind") : "note"; await note(kind, S("title") || null, S("body")); return `noted (${kind})`; }
      case "notebook": {
        const rows = await query<{ kind: string; title: string | null; body: string; created_at: Date }>(`SELECT kind, title, body, created_at FROM notes WHERE investigation_id=$1 ${S("kind") ? "AND kind=$3" : ""} ORDER BY created_at DESC LIMIT $2`, S("kind") ? [inv.id, Number(input.limit ?? 30), S("kind")] : [inv.id, Number(input.limit ?? 30)]);
        return rows.length ? rows.reverse().map((r) => `[${r.kind}${r.title ? " · " + r.title : ""}] ${r.body}`).join("\n") : "notebook is empty";
      }
      case "rebuild": { const s = await deps.rebuild(); graphCache = null; return s; }
      case "judge": { const s = await deps.judge(); graphCache = null; return s; }
      case "cost": return `spent $${usdTotal().toFixed(3)} · ${steps} tool calls${deps.ceilingUsd ? ` · ceiling $${deps.ceilingUsd}` : " · no ceiling"}`;
      case "send_message": { const text = S("text"); if (!text) return "empty"; if (deps.chat) { await deps.chat.say(text); saidThisTurn++; } else await note("note", "message", text); return "sent"; }
      case "ask_graph": {
        const q = S("question"); if (!q) return "question required";
        const r = await runInvestigator(inv, { ctx, model, question: q, maxSteps: 40, rebuild: async () => "read-only", judge: async () => "read-only", log: () => {} });
        return r.report || "(no answer)";
      }
      case "group_entities": {
        const g = await graph(true); const label = S("label"); const refs = Array.isArray(input.members) ? (input.members as string[]) : [];
        const ids = [...new Set(refs.map((r) => findEnt(g, String(r))?.id).filter(Boolean) as string[])];
        if (!label || ids.length < 2) return "a label and at least two entities that exist in the graph are required";
        const gid = uuidv7();
        await query(`INSERT INTO entity_groups (id, investigation_id, label, members, note) VALUES ($1,$2,$3,$4::uuid[],$5)`, [gid, inv.id, label, ids, S("why") || null]);
        return `grouped ${ids.length} entities as "${label}" (group ${short(gid)})`;
      }
      case "ungroup": {
        const ref = S("ref");
        const rows = await query<{ id: string }>(`DELETE FROM entity_groups WHERE investigation_id=$1 AND (id::text LIKE $2 OR lower(label)=lower($3)) RETURNING id`, [inv.id, `${ref}%`, ref]);
        return rows.length ? `dissolved ${rows.length} group${rows.length === 1 ? "" : "s"}` : "no such group";
      }
      case "groups": {
        const g = await graph(); const rows = await query<{ id: string; label: string; members: string[]; note: string | null }>(`SELECT id, label, members, note FROM entity_groups WHERE investigation_id=$1 ORDER BY created_at`, [inv.id]);
        return rows.length ? rows.map((r) => `${short(r.id)} ${r.label}: ${r.members.map((m) => g.entities.get(m)?.name ?? short(m)).join(" | ")}${r.note ? " — " + r.note : ""}`).join("\n") : "no groups";
      }
      case "finish": { report = S("report"); if (deps.chat) { if (report && report.length > 40 && !saidThisTurn) await deps.chat.say(report); return "ok — turn ended"; } await note(deps.question ? "note" : "report", deps.question ? `answer: ${deps.question.slice(0, 80)}` : (S("verdict") || "partial"), report); return "ok"; }
      default: return "unknown tool";
    }
  };
  const summarize = (url: string, st: { source: SourceRow; claims: Claim[] }) => {
    if (!st.claims.length) return `read ${url} — no candidate claims staged`;
    return `read ${url} — ${st.claims.length} candidate claims:\n` + st.claims.slice(0, 60).map((c, i) => c.kind === "relation" ? `[${i}] ${c.subject.name} —${c.predicate}${c.predicate_specific ? "[" + c.predicate_specific.replace(/^candidate:/, "") + "]" : ""}→ ${c.object.name}` : `[${i}] ${c.entity.name} · ${c.key} = ${c.value}`).join("\n") + (st.claims.length > 60 ? `\n… ${st.claims.length - 60} more` : "") + "\n(contribute the indices worth keeping)";
  };
  const src = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

  // Unopened leads: entities LINKED to the case but never investigated — referenced by others yet with no facts
  // gathered ABOUT them (no outbound links, ≤1 attribute). This is the "a human stops when unopened entities run
  // out, not when queries dry up" signal (research/19 F6). Ranked by proximity to the subject and how often the
  // case already mentions them. Pure graph — no auto-firing; the agent picks which to open.
  const INVESTIGABLE = new Set(["person", "organization", "account", "instagram", "tiktok", "twitter", "place", "domain", "email", "username", "phone"]);
  const TYPE_WEIGHT: Record<string, number> = { person: 1.6, instagram: 1.5, account: 1.4, tiktok: 1.4, twitter: 1.4, organization: 1.2, domain: 1.0, email: 1.3, username: 1.3, phone: 1.2, place: 0.8 };
  const nextMove = (e: GEntity): string => {
    const t = e.type, k = e.kind ?? "";
    if (t === "instagram" || k === "instagram") return `social.ig_profile / look_at their photos`;
    if (t === "account" || t === "username" || k === "username" || k === "handle") return `people.username + social.ig_profile on the handle`;
    if (t === "person") return `search the name + run people.* connectors; open any handle`;
    if (t === "organization") return `org.* connectors + read the site`;
    if (t === "domain") return `infra.rdap / infra.passive_dns / read the site`;
    if (t === "email") return `people.gravatar / people.breach / people.dehashed`;
    if (t === "place") return `geo.geocode; read about it`;
    return `search + read`;
  };
  const unopenedLeads = (g: Graph, subjectId: string, limit = 12): string[] => {
    // BFS hop distance over both directions
    const hop = new Map<string, number>([[subjectId, 0]]);
    let frontier = [subjectId];
    for (let d = 1; d <= 2 && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const l of [...(g.out.get(id) ?? []), ...(g.inn.get(id) ?? [])]) {
        const o = l.src === id ? l.dst : l.src;
        if (!hop.has(o)) { hop.set(o, d); next.push(o); }
      }
      frontier = next;
    }
    const scored: { e: GEntity; d: number; mentions: number; score: number }[] = [];
    for (const [id, d] of hop) {
      if (d === 0) continue;
      const e = g.entities.get(id); if (!e) continue;
      const type = e.type.toLowerCase();
      if (!INVESTIGABLE.has(type) && !INVESTIGABLE.has(e.kind ?? "")) continue;
      const out = (g.out.get(id) ?? []).length, attrs = (g.attrsOf.get(id) ?? []).length, inn = (g.inn.get(id) ?? []).length;
      if (out > 0 || attrs > 1) continue; // it's been explored — facts exist about it
      const w = TYPE_WEIGHT[type] ?? TYPE_WEIGHT[e.kind ?? ""] ?? 0.9;
      const score = (d === 1 ? 2 : 1) * (1 + Math.log1p(inn)) * w;
      scored.push({ e, d, mentions: inn, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ e, d, mentions }) => `  entity:${short(e.id)}  ${e.name} [${e.type}${e.kind ? "/" + e.kind : ""}]  ${d}-hop · ${mentions} mention${mentions === 1 ? "" : "s"} · unopened → ${nextMove(e)}`);
  };

  // ---- the run --------------------------------------------------------------------------------------------
  const g0 = await graph(true);
  const inventory = g0.entities.size ? `The graph already holds ${g0.entities.size} entities and ${g0.links.length} links. Start with graph_lookup on the subject and the notebook.` : "The graph is empty. Start by reading the seed's own pages and running the connectors on it.";
  const system = `You are the lead investigator on an open-source (OSINT) investigation. You are in full control: nothing happens unless you do it. You decide what to search, what to read, which connectors to run, what enters the graph, how entities resolve, and when the investigation is done.

SUBJECT: ${inv.seed.name} (${inv.seed.kind})
GOAL: ${inv.goal_text}

${inventory}

How to work: read consult_playbook("investigator/method") first, then the playbook section for this case type (person case / organization case / domain case) and "search/strategy". Keep a plan and a hypothesis board; write notes as you go (your transcript is trimmed, the notebook and the graph are your memory). Chase every lead; the people bound to the subject (owner, founder, members) get their own deep dive. Go past page 1 of searches, rotate engines, use operators. Run connectors on every identifier you find. Read pages; snippets are not evidence.

The graph's rules (they protect the truth of what you build): every fact needs a source you read and a verbatim quote; a name is never identity — join entities only with same_as + quote or a shared identifier, and split what the build fused wrongly; grades come from who published, not from you; every edit you make is recorded and reversible, so act, then correct. Reading only: never log in, never use leaked credentials, never touch systems.

Before finishing: rebuild, then call graph_duplicates and resolve every group — same_as with a quote when they are one thing, not_same_as with a reason when they are not; a graph with the same person twice is not done. Then judge, then rebuild again.

Finish only when the stopping bar (consult_playbook("investigator/stopping")) is met, with a full report (consult_playbook("investigator/report")), or when the run is ending.`;

  const READ_ONLY = new Set(["consult_playbook", "graph_lookup", "graph_ego", "graph_paths", "graph_timeline", "graph_contested", "graph_gaps", "graph_sql", "why", "notebook", "hypotheses", "cost", "finish"]);
  const askSystem = `You answer a question about an investigation using ONLY its graph (entities, links, attributes, their evidence) and the investigator's notebook — no web, no new collection. Investigation: "${inv.seed.name}" (${inv.seed.kind}); goal: ${inv.goal_text}.

QUESTION: ${deps.question}

Work the graph like an analyst: look up the entities the question names, follow links, check paths and timelines, read the evidence (why) behind the facts that carry your answer, and note grades and contested flags.

Then call finish with the answer in this shape, and keep it SHORT — it is read on a phone:
- First line: the answer in one or two plain sentences, with a confidence word (almost certain / likely / unclear / unlikely / no evidence).
- Then at most four short bullets of evidence. Each bullet: the fact in plain words, the source name, and a quote of at most ~15 words. Put the graph id at the END of the bullet in square brackets, e.g. [link:845710f1] — never inside a sentence.
- Then one line starting "Unknown:" with what the graph cannot tell.
No headings, no bold, no restating the question, no ids in prose. Under 150 words unless the question truly needs more.`;
  const chatSystem = `You are the lead investigator on an open-source (OSINT) investigation, working WITH the person who opened it, in a conversation that continues across turns. You are in full control of the work: nothing happens unless you do it. You decide what to search, what to read, which connectors to run, what enters the graph, how entities resolve, how they are grouped, and when a line of enquiry is exhausted.

SUBJECT: ${inv.seed.name} (${inv.seed.kind})
GOAL: ${inv.goal_text}

${inventory}

The rhythm: COLLECT (search deep — pages 2–5, several engines, operators; read the pages; run connectors on every identifier; look_at the photos; contribute what is relevant and supported) → when you are satisfied with a round, CONSOLIDATE (rebuild, settle duplicates with graph_duplicates / same_as / not_same_as / split, retract junk, group entities that are one thing for the reader) → ASSESS (what is established, what is thin, what is missing, what is surprising; update the hypothesis board; run graph_gaps and read its UNOPENED list — the people and accounts linked to the case you have not yet investigated; ask_graph when a synthesis helps) → CONTINUE by opening the most valuable unopened lead. A dry search does not end the case; an empty UNOPENED list (nothing left worth its cost) does. Repeat until the stopping bar is met (consult_playbook("investigator/stopping")).

When a message arrives, answer it FIRST with send_message — in the size the message deserves (a quick question gets a quick answer; "two sentences" means two sentences) — and say what you will do next if there is work; then do the work. A small ask does not start a new collection round. Talk to the person as you go with send_message: a solid finding as soon as you have it, the plan when you change it, a question when only they can answer. Short, plain, specific; ids in square brackets at the END of a sentence so they can tap the evidence. Do not narrate tool calls; do not repeat what the activity feed shows. When they send you a message, treat it as a lead or an instruction from the owner of the case and act on it. End your turn with finish when you are waiting on them or the case is done for now — the conversation is the report; there is no separate report.

The graph's rules: every fact needs a source you read and a verbatim quote; a name is never identity — join entities only with same_as + quote or a shared identifier, split what the build fused wrongly; grades come from who published; every edit is recorded and reversible. Reading only: never log in, never use leaked credentials, never touch systems.`;

  /** what a tool call means, in words a person can follow (the activity feed) */
  const describe = (name: string, input: Record<string, unknown>): string | null => {
    const v = (k: string) => String(input[k] ?? "").trim();
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.slice(0, 40); } };
    switch (name) {
      case "search": return `Searching ${v("engine") || "google"}${Number(input.page ?? 1) > 1 ? " page " + input.page : ""}: ${v("query")}`;
      case "read_url": return `Reading ${host(v("url"))}`;
      case "read_text": return `Reading more of ${host(v("url"))}`;
      case "look_at": return `Looking at a photo${v("question") ? " (" + v("question").slice(0, 40) + ")" : ""}`;
      case "contribute": return `Keeping facts from ${host(v("url"))}`;
      case "run_capability": return `Running ${v("id")} on ${v("value")}`;
      case "graph_lookup": return `Checking the graph for ${v("ref")}`;
      case "graph_ego": case "graph_paths": case "graph_timeline": case "graph_contested": case "graph_gaps": case "graph_sql": case "why": case "notebook": case "hypotheses": case "cost": case "list_capabilities": return null;
      case "consult_playbook": return `Consulting the playbook: ${v("topic") || "index"}`;
      case "link": return `Recording: ${v("subject")} ${v("predicate").replace(/_/g, " ")} ${v("object")}`;
      case "attribute": return `Recording: ${v("entity")} ${v("key")} = ${v("value")}`;
      case "same_as": return `Joining ${v("name_a")} and ${v("name_b")}`;
      case "not_same_as": return `Keeping ${v("a")} and ${v("b")} apart`;
      case "split": return `Splitting ${v("ref")}`;
      case "retract": return `Retracting ${v("source")}`;
      case "hypothesis": return v("statement") ? `Hypothesis: ${v("statement").slice(0, 120)}` : `Updating a hypothesis → ${v("status")}`;
      case "note": return v("kind") === "plan" ? `Plan: ${v("body").slice(0, 140)}` : null;
      case "rebuild": return "Rebuilding the graph";
      case "judge": return "Judging identity pairs";
      case "graph_duplicates": return "Checking for duplicates";
      case "group_entities": return `Grouping as "${v("label")}"`;
      case "ungroup": return `Ungrouping ${v("ref")}`;
      case "ask_graph": return `Asking the graph: ${v("question").slice(0, 120)}`;
      case "send_message": return null;
      case "finish": return null;
      default: return null;
    }
  };

  const r = await runToolLoop(model, {
    system: deps.question ? askSystem : deps.chat ? chatSystem : system,
    user: deps.question ? `Answer the question.` : deps.chat ? deps.chat.user : `Begin. Frame the question, inventory the graph, write the plan, then work it.`,
    initialMessages: deps.chat?.transcript,
    tools: deps.question ? tools.filter((t) => READ_ONLY.has(t.name)) : tools, exec,
    maxSteps: deps.maxSteps ?? 600, keepRecent: 18, maxToolChars: 14_000,
    onStep: (t) => { log("   · " + t.replace(/\s+/g, " ").slice(0, 200)); trace("\n### " + t); },
    onTool: (name, input, out, u) => { log(`   ▸ ${name}(${JSON.stringify(input).slice(0, 120)}) → ${out.split("\n")[0]!.slice(0, 120)}`); const d = describe(name, input); if (d) deps.chat?.activity?.(d); trace(`\n>>> ${name} ${JSON.stringify(input)}\n<<< ${out.slice(0, 2000)}`); modelUsd = u; },
    shouldStop: () => { if (deps.ceilingUsd && usdTotal() >= deps.ceilingUsd) { stopped = `cost ceiling $${deps.ceilingUsd} reached`; return stopped; } return null; },
  });
  modelUsd = r.usd;
  if (!report) report = r.finalText;
  return { report, usd: usdTotal(), steps: r.steps, toolCalls: r.toolCalls, stopped, messages: r.messages };
}
