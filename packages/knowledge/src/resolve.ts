// Resolution (model §1.8, M1_DESIGN §4), TypeScript-native. Operates on PROVISIONAL entities (exact
// normalized-name clusters). Pairwise scoring in the Fellegi–Sunter spirit: additive log-odds weights per
// feature, with the name weights informed by token rarity learned from the corpus itself (a shared rare token
// is worth more than a shared common one). Bands: ≥ AUTO_SAME → merge · [HYPOTHESIS, AUTO_SAME) → identity
// hypothesis · below → nothing. Hard keys: match ⇒ same; conflict ⇒ never. Decisions (records) override scores.
// Org type-boundary rule: "X" vs "X Management LP / X Fund II / X Holdings" ⇒ related, not merged.

export interface Provisional {
  id: string; type: string; kind: string | null; name: string; name_norm: string;
  keys: Record<string, string[]>;          // hard identity keys
  neighbors: Set<string>;                  // ids of linked provisional entities (context)
  claim_count: number;
}
export interface Decision { a_id: string; b_id: string; verdict: "same" | "not_same" | "related"; related_kind?: string | null }
export interface PairScore { a: string; b: string; score: number; p: number; features: Record<string, number | string | boolean>; verdict: "same" | "hypothesis" | "not_same" | "related" | "none"; related_kind?: string }

export const AUTO_SAME = 0.95, HYPOTHESIS = 0.6;
export const PRIOR = -6;

const HARD_KEYS = ["email", "phone", "handle", "url", "orcid", "licence", "registry_id", "domain", "docket", "parcel_id", "identifier"];
const STRUCTURE_TOKENS = new Set(["management", "fund", "funds", "holdings", "trust", "foundation", "partners", "advisors", "advisers", "gp", "capital"]);
const RELATED_SUFFIX = new Set(["management", "fund", "funds", "holdings", "trust", "foundation", "opco", "advisors", "advisers", "gp", "sicav", "ii", "iii", "iv", "v", "xvii"]);
const STOP = new Set(["the", "of", "and", "de", "du", "la", "le", "les", "des", "et", "inc", "llc", "lp", "ltd", "co", "corp"]);

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const m = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) for (let j = Math.max(0, i - m); j < Math.min(b.length, i + m + 1); j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches++; break; }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const j = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let l = 0; while (l < 4 && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}

export const initialism = (norm: string) => norm.split(" ").filter((t) => !STOP.has(t)).map((t) => t[0]).join("");
const tokens = (norm: string) => norm.split(" ").filter((t) => t && !STOP.has(t));

/** Inverse document frequency of name tokens over the corpus of provisional entities (rarity = evidence). */
export function tokenIdf(ents: Provisional[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const e of ents) for (const t of new Set(tokens(e.name_norm))) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, ents.length);
  return new Map([...df].map(([t, d]) => [t, Math.log((n + 1) / (d + 0.5))]));
}

/** "investors.palantir.com" → "palantir.com": the registrable part is what identifies an organization. */
export const registrableDomain = (v: string): string => { const h = v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:?#].*$/, ""); const p = h.split("."); return p.length > 2 && !/^(co|com|org|net|gov|ac|edu)$/.test(p[p.length - 2]!) ? p.slice(-2).join(".") : p.length > 3 ? p.slice(-3).join(".") : h; };
const orgDomains = (keys: Record<string, Iterable<string>>): Set<string> => { const s = new Set<string>(); for (const k of ["domain", "url"]) for (const v of keys[k] ?? []) { const d = registrableDomain(v); if (d.includes(".")) s.add(d); } return s; };
/** The identity key an organization mention is filed under at build time: its registrable domain, else its
 *  registry id, else "" (keyless). Same name + different key = different provisional records. */
export function orgIdentityKey(keys: Record<string, string[]>): string {
  const d = [...orgDomains(keys)].sort()[0];
  if (d) return `domain:${d}`;
  const r = (keys.registry_id ?? []).slice().sort()[0];
  return r ? `registry_id:${r}` : "";
}
const hasAnyKey = (e: Provisional) => HARD_KEYS.some((k) => (e.keys[k] ?? []).length > 0);

function hardKeyRelation(a: Provisional, b: Provisional): "match" | "conflict" | "none" {
  let out: "match" | "conflict" | "none" = "none";
  for (const k of HARD_KEYS) {
    const ka = a.keys[k] ?? [], kb = b.keys[k] ?? [];
    if (!ka.length || !kb.length) continue;
    if (ka.some((v) => kb.includes(v))) return "match";
    if (k === "email" || k === "licence" || k === "registry_id" || k === "orcid" || k === "docket") out = "conflict";
    if (k === "identifier" && a.type === "account" && b.type === "account") out = "conflict";   // an account IS its identifier (two IPs are two accounts)
  }
  // two organizations on different registrable domains are different organizations (a company has one primary web
  // identity; a person may have many emails, so this rule is org-only)
  if (out === "none" && a.type === "organization" && b.type === "organization") {
    const da = orgDomains(a.keys), db = orgDomains(b.keys);
    if (da.size && db.size) out = [...da].some((d) => db.has(d)) ? "match" : "conflict";   // same registrable domain = same org
  }
  return out;
}

const UNIT_TOKENS = new Set(["school", "college", "department", "dept", "graduate", "institute", "division", "lab", "laboratory", "center", "centre", "faculty", "unit", "office", "bureau", "chapter", "branch"]);
const ORDINAL = /^(i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,3}|\d{1,3}(st|nd|rd|th)?)$/;
const isOrdinal = (t: string) => ORDINAL.test(t);

/**
 * Structural relation between two organization names:
 *   alias      — "acorn" ~ "acorn capital"; "alder maple" ~ "alder maple cedar dale"
 *   manages    — "acorn" vs "acorn capital management lp" (management company / fund vehicle)
 *   part_of    — "stanford university" vs "stanford university graduate school of business"
 *   sibling    — "acorn ii lp" vs "acorn iii lp" (a fund series: same family, different vehicle)
 *   none
 */
export function orgStructure(a: string, b: string): "alias" | "manages" | "part_of" | "sibling" | "none" {
  const ta0 = tokens(a), tb0 = tokens(b);
  const oa = ta0.filter(isOrdinal), ob = tb0.filter(isOrdinal);
  const ta = ta0.filter((t) => !isOrdinal(t)), tb = tb0.filter((t) => !isOrdinal(t));
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!short.length || !long.length) return "none";
  const prefix = short.every((t, i) => long[i] === t);
  const contained = short.every((t) => long.includes(t));
  if (!prefix && !contained) return "none";                           // structurally unrelated names
  const ordinalsDiffer = (oa.length && ob.length && (oa.length !== ob.length || oa.some((t, i) => t !== ob[i]))) || (oa.length > 0) !== (ob.length > 0);
  if (ordinalsDiffer) return "sibling";                                // same family, different vehicle / series
  const extra = long.filter((t) => !short.includes(t));
  if (!extra.length) return "alias";
  if (extra.some((t) => UNIT_TOKENS.has(t))) return "part_of";
  if (extra.some((t) => RELATED_SUFFIX.has(t))) return "manages";
  if (extra.every((t) => STRUCTURE_TOKENS.has(t))) return "alias";   // "acorn" ~ "acorn capital"
  if (prefix && short.length >= 2) return "alias";                    // "alder maple" ~ "alder maple cedar dale"
  return "none";
}

/** Two names carrying different long numeric identifiers (post ids, docket numbers) are different things. */
function numericIdConflict(a: string, b: string): boolean {
  const na: string[] = a.match(/\d{4,}/g) ?? [], nb: string[] = b.match(/\d{4,}/g) ?? [];
  return na.length > 0 && nb.length > 0 && !na.some((x) => nb.includes(x));
}

export function scorePair(a: Provisional, b: Provisional, idf: Map<string, number>): PairScore {
  const f: Record<string, number | string | boolean> = {};
  let w = 0;
  const hk = hardKeyRelation(a, b);
  f.hard_key = hk;
  if (hk === "conflict") return { a: a.id, b: b.id, score: -99, p: 0, features: f, verdict: "not_same" };
  if (hk === "match") w += 15;
  if (numericIdConflict(a.name_norm, b.name_norm)) { f.numeric_id_conflict = true; return { a: a.id, b: b.id, score: -99, p: 0, features: f, verdict: "not_same" }; }
  if (a.kind && b.kind && a.kind !== b.kind) { f.kind_conflict = true; w -= 3; }
  const jw = jaroWinkler(a.name_norm, b.name_norm); f.jw = Number(jw.toFixed(3));
  const ta = tokens(a.name_norm), tb = tokens(b.name_norm);
  const shared = ta.filter((t) => tb.includes(t));
  const sharedIdf = shared.reduce((s, t) => s + (idf.get(t) ?? 1), 0);
  const unionIdf = [...new Set([...ta, ...tb])].reduce((s, t) => s + (idf.get(t) ?? 1), 0);
  f.token_overlap = Number((unionIdf ? sharedIdf / unionIdf : 0).toFixed(3));
  let initialismHit = false;
  if (a.type === "organization") {
    const os = orgStructure(a.name_norm, b.name_norm); f.org_structure = os;
    if (os === "manages" || os === "part_of" || os === "sibling") {
      // direction: the longer (more specific) name is the vehicle / unit; it points at the shorter (brand / parent)
      const aLonger = tokens(a.name_norm).length >= tokens(b.name_norm).length;
      f.related_src = aLonger ? a.id : b.id;
      return { a: a.id, b: b.id, score: -1, p: 0, features: f, verdict: "related", related_kind: os };
    }
    if (os === "alias") w += 6;
    const ia = initialism(a.name_norm), ib = initialism(b.name_norm);
    if ((ia.length >= 3 && ia === b.name_norm.replace(/\s/g, "")) || (ib.length >= 3 && ib === a.name_norm.replace(/\s/g, ""))) { f.initialism = true; initialismHit = true; w += 9; }
  }
  if (a.type === "person") {
    // A person's name alone is never identity (research 02/13): identical full names across sources land in the
    // hypothesis band; shared context (co-mentioned entities) or a hard key lifts them to a merge.
    if (a.name_norm === b.name_norm) { f.exact_name = true; w += 6.5; }
    else if (jw >= 0.92) w += 4; else if (jw >= 0.85) w += 1.5; else if (jw < 0.6 && !shared.length) w -= 4;
    const la = ta.at(-1), lb = tb.at(-1);
    if (la && la === lb && ta[0]?.[0] === tb[0]?.[0] && ta[0] !== tb[0]) { f.surname_initial = true; w += 1; }
  } else {
    if (jw >= 0.92) w += 4; else if (jw >= 0.85) w += 1.5; else if (jw < 0.6 && !shared.length && !initialismHit) w -= 4;
    w += 3 * (f.token_overlap as number) + Math.min(4, sharedIdf * 0.8);       // rare shared tokens count more
  }
  const nb = [...a.neighbors].filter((n) => b.neighbors.has(n)).length;
  const nu = new Set([...a.neighbors, ...b.neighbors]).size;
  f.context_jaccard = Number((nu ? nb / nu : 0).toFixed(3));
  f.shared_neighbors = nb;
  if (nb >= 1) w += Math.min(5, 2.5 * nb);        // same full name + one corroborating entity ⇒ merge (research 02 §7.1)
  // context alone never creates a candidate: some name signal (near-identical name, alias structure,
  // initialism, a shared rare token, or a hard key) is required — otherwise "University of Arizona" and
  // "Stanford University" would pair up just because both link to the same person.
  const rareCut = Math.log((idf.size + 1) / 2.5);   // a token seen in ≤ 2 names of the corpus
  const rareShared = shared.some((t) => (idf.get(t) ?? 0) >= rareCut);
  const nameSignal = hk === "match" || f.exact_name === true
    || (a.type === "person" ? jw >= 0.8
      : a.type === "organization" ? (jw >= 0.8 || f.org_structure === "alias" || initialismHit || rareShared)
      : jw >= 0.85);                                   // events, documents, credentials, places: names are specific
  f.name_signal = nameSignal;
  const prior = PRIOR;                               // most pairs are not the same
  const p = nameSignal ? 1 / (1 + Math.exp(-(w + prior))) : 0;
  f.weight = Number(w.toFixed(2));
  const verdict = p >= AUTO_SAME ? "same" : p >= HYPOTHESIS ? "hypothesis" : "none";
  return { a: a.id, b: b.id, score: w, p: Number(p.toFixed(4)), features: f, verdict };
}

/** Candidate pairs via cheap blocking: shared informative token, initialism, or hard key. */
export function candidatePairs(ents: Provisional[], idf: Map<string, number>): [Provisional, Provisional][] {
  const byType = new Map<string, Provisional[]>();
  for (const e of ents) (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e);
  const pairs: [Provisional, Provisional][] = [];
  const seen = new Set<string>();
  const push = (a: Provisional, b: Provisional) => { const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; if (!seen.has(k)) { seen.add(k); pairs.push(a.id < b.id ? [a, b] : [b, a]); } };
  for (const group of byType.values()) {
    const byTok = new Map<string, Provisional[]>(), byInit = new Map<string, Provisional[]>(), byKey = new Map<string, Provisional[]>();
    for (const e of group) {
      for (const t of new Set(tokens(e.name_norm))) if ((idf.get(t) ?? 0) > 1.0 || t.length >= 5) (byTok.get(t) ?? byTok.set(t, []).get(t)!).push(e);
      const ini = initialism(e.name_norm); if (ini.length >= 3) (byInit.get(ini) ?? byInit.set(ini, []).get(ini)!).push(e);
      const compact = e.name_norm.replace(/\s/g, ""); if (compact.length >= 3 && compact.length <= 6) (byInit.get(compact) ?? byInit.set(compact, []).get(compact)!).push(e);
      for (const k of HARD_KEYS) for (const v of e.keys[k] ?? []) (byKey.get(`${k}:${v}`) ?? byKey.set(`${k}:${v}`, []).get(`${k}:${v}`)!).push(e);
    }
    for (const bucket of [...byTok.values(), ...byInit.values(), ...byKey.values()]) {
      if (bucket.length > 60) continue;                                   // hub token — not informative
      for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++) push(bucket[i]!, bucket[j]!);
    }
  }
  return pairs;
}

export interface ResolveResult { clusters: Map<string, string>; merges: PairScore[]; hypotheses: PairScore[]; related: PairScore[]; guarded: PairScore[] }

/** Score all candidate pairs, apply decisions, cluster with union-find and a hard-key contradiction guard. */

export function resolve(ents: Provisional[], decisions: Decision[]): ResolveResult {
  const idf = tokenIdf(ents);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const decided = new Map(decisions.map((d) => [`${d.a_id}|${d.b_id}`, d]));
  const parent = new Map(ents.map((e) => [e.id, e.id]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const keysOf = new Map<string, Record<string, Set<string>>>();
  const clusterKeys = (root: string) => keysOf.get(root) ?? keysOf.set(root, {}).get(root)!;
  for (const e of ents) for (const [k, vs] of Object.entries(e.keys)) for (const v of vs) (clusterKeys(e.id)[k] ??= new Set()).add(v);
  const typeOf = new Map(ents.map((e) => [e.id, e.type]));
  const conflicts = (ra: string, rb: string) => {
    const ka = clusterKeys(ra), kb = clusterKeys(rb);
    if (["email", "licence", "registry_id", "orcid", "docket"].some((k) => ka[k] && kb[k] && ![...ka[k]!].some((v) => kb[k]!.has(v)) && ka[k]!.size && kb[k]!.size)) return true;
    if (typeOf.get(ra) === "account" && typeOf.get(rb) === "account" && ka.identifier && kb.identifier && ![...ka.identifier].some((v) => kb.identifier!.has(v))) return true;
    // organizations: disjoint registrable domains conflict unless some other identifier is shared
    if (typeOf.get(ra) === "organization" && typeOf.get(rb) === "organization") {
      const shared = HARD_KEYS.some((k) => ka[k] && kb[k] && [...ka[k]!].some((v) => kb[k]!.has(v)));
      if (!shared) { const da = orgDomains(ka), db = orgDomains(kb); if (da.size && db.size && ![...da].some((d) => db.has(d))) return true; }
    }
    return false;
  };
  const union = (a: string, b: string): boolean => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return true;
    if (conflicts(ra, rb)) return false;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(drop, keep);
    const kk = clusterKeys(keep), kd = clusterKeys(drop);
    for (const [k, vs] of Object.entries(kd)) for (const v of vs) (kk[k] ??= new Set()).add(v);
    return true;
  };
  const merges: PairScore[] = [], related: PairScore[] = [], guarded: PairScore[] = [];
  let hypotheses: PairScore[] = [];
  // 1. decisions first (records win)
  for (const d of decisions) if (d.verdict === "same") union(d.a_id, d.b_id);
  // 1b. keyless organization mentions attach to the keyed record of the same name ONLY when that name is
  //     unambiguous here (exactly one keyed record). Two keyed records with the same name (different domains) make
  //     the keyless mentions ambiguous: they stay their own record and the judge gets a hypothesis for each side.
  const orgsByName = new Map<string, Provisional[]>();
  for (const e of ents) if (e.type === "organization") (orgsByName.get(e.name_norm) ?? orgsByName.set(e.name_norm, []).get(e.name_norm)!).push(e);
  for (const group of orgsByName.values()) {
    const keyed = group.filter(hasAnyKey), keyless = group.filter((e) => !hasAnyKey(e));
    if (!keyed.length || !keyless.length) continue;
    for (const k of keyless) {
      if (keyed.length === 1) { const s = scorePair(k, keyed[0]!, idf); if (union(k.id, keyed[0]!.id)) merges.push({ ...s, verdict: "same", features: { ...s.features, name_unambiguous: true } }); }
      else for (const c of keyed) { const s = scorePair(k, c, idf); if (s.verdict !== "not_same") hypotheses.push({ ...s, p: Math.max(s.p, HYPOTHESIS), verdict: "hypothesis", features: { ...s.features, name_ambiguous: keyed.length } }); }
    }
  }
  // 2. scored pairs
  const pairs = candidatePairs(ents, idf);
  const scored = pairs.map(([a, b]) => scorePair(a, b, idf)).sort((x, y) => y.p - x.p);
  for (const s of scored) {
    const d = decided.get(`${s.a}|${s.b}`);
    if (d) { if (d.verdict === "related") related.push({ ...s, verdict: "related", related_kind: d.related_kind ?? undefined }); continue; }
    if (s.verdict === "related") { related.push(s); continue; }
    // IDENTITY MERGES ONLY ON A SHARED UNIQUE IDENTIFIER (model v0.4 §5). The score never merges — it only
    // proposes candidates worth judging. A judgment (verifier/agent) or the owner does the rest, as decisions.
    if (s.features.hard_key === "match") { if (union(s.a, s.b)) merges.push(s); else guarded.push(s); }
    else if (s.verdict === "same" || s.verdict === "hypothesis") hypotheses.push({ ...s, verdict: "hypothesis" });
  }
  // 3. collective pass (Bhattacharya & Getoor): merged clusters pool their neighbourhoods; re-score the
  //    hypothesis band with cluster-level context until nothing more crosses the line.
  for (let round = 0; round < 6 && hypotheses.length; round++) {
    const clusterNeighbors = new Map<string, Set<string>>();
    for (const e of ents) { const r = find(e.id); const set = clusterNeighbors.get(r) ?? clusterNeighbors.set(r, new Set()).get(r)!; for (const n of e.neighbors) set.add(find(n)); }
    const withCtx = (e: Provisional): Provisional => ({ ...e, neighbors: clusterNeighbors.get(find(e.id)) ?? new Set() });
    const next: PairScore[] = [];
    let changed = false;
    for (const h of hypotheses) {
      const a = byId.get(h.a)!, b = byId.get(h.b)!;
      if (find(a.id) === find(b.id)) continue;                        // already together via another pair
      const s = scorePair(withCtx(a), withCtx(b), idf);
      // context can raise a candidate's rank but never merge it — only an identifier, a judgment, or the owner merges
      if (s.features.hard_key === "match") { if (union(s.a, s.b)) { merges.push({ ...s, features: { ...s.features, collective_round: round + 1 } }); changed = true; } else guarded.push(s); }
      else if (s.verdict === "same" || s.verdict === "hypothesis") next.push({ ...s, verdict: "hypothesis" });
    }
    hypotheses = next;
    if (!changed) break;
  }
  hypotheses = hypotheses.filter((h) => find(h.a) !== find(h.b));
  const clusters = new Map<string, string>();
  for (const e of ents) clusters.set(e.id, find(e.id));
  return { clusters, merges, hypotheses, related, guarded };
}
