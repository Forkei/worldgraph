// The toolkit (model §4.4): the only way the loop's LLM calls and the analyst touch the graph. Every operator
// returns a BOUNDED subgraph whose edges carry their grade and can be explained with `why` (toolkitDb.ts).
// Pure functions over a loaded Graph so they are unit-testable and run in milliseconds; nothing here writes.

export interface GEntity { id: string; type: string; kind: string | null; name: string; aliases: string[]; keys: Record<string, string[]>; claim_count: number; first_seen?: string | null; last_seen?: string | null }
export interface GLink {
  id: string; src: string; predicate: string; predicate_specific: string | null; dst: string;
  qualifiers: Record<string, string>; qualifier_conflicts: Record<string, unknown>;
  grade: string; reliability: string; credibility: number; evidence_count: number; independent_origins: number; contested: boolean; derived: boolean;
  temporal_kind: string | null; valid_from_lo: string | null; valid_from_hi: string | null; valid_to_lo: string | null; valid_to_hi: string | null; date_lo: string | null; date_hi: string | null;
}
export interface GAttribute {
  id: string; entity: string; key: string; key_specific: string | null; value: string; datatype: string;
  grade: string; reliability: string; credibility: number; evidence_count: number; independent_origins: number; contested: boolean;
  valid_from_lo: string | null; valid_to_hi: string | null; date_lo: string | null;
}
export interface Graph { entities: Map<string, GEntity>; links: GLink[]; attributes: GAttribute[]; out: Map<string, GLink[]>; inn: Map<string, GLink[]>; attrsOf: Map<string, GAttribute[]> }
export interface Subgraph { entities: GEntity[]; links: GLink[]; attributes: GAttribute[]; truncated: boolean; note?: string }

export const GRADE_RANK: Record<string, number> = { established: 0, corroborated: 1, single_source: 2, unverified: 3, disputed: 4 };
const gradeOk = (g: string, min?: string) => min === undefined || (GRADE_RANK[g] ?? 9) <= (GRADE_RANK[min] ?? 9);
const linkOrder = (a: GLink, b: GLink) => (GRADE_RANK[a.grade] ?? 9) - (GRADE_RANK[b.grade] ?? 9) || b.independent_origins - a.independent_origins || b.evidence_count - a.evidence_count;

export function makeGraph(entities: GEntity[], links: GLink[], attributes: GAttribute[] = []): Graph {
  const g: Graph = { entities: new Map(entities.map((e) => [e.id, e])), links, attributes, out: new Map(), inn: new Map(), attrsOf: new Map() };
  for (const l of links) {
    (g.out.get(l.src) ?? g.out.set(l.src, []).get(l.src)!).push(l);
    (g.inn.get(l.dst) ?? g.inn.set(l.dst, []).get(l.dst)!).push(l);
  }
  for (const a of attributes) (g.attrsOf.get(a.entity) ?? g.attrsOf.set(a.entity, []).get(a.entity)!).push(a);
  for (const arr of g.out.values()) arr.sort(linkOrder);
  for (const arr of g.inn.values()) arr.sort(linkOrder);
  return g;
}

export const touching = (g: Graph, id: string): GLink[] => [...(g.out.get(id) ?? []), ...(g.inn.get(id) ?? [])];
const other = (l: GLink, id: string) => (l.src === id ? l.dst : l.src);

/** Time helpers: a link "holds at t" when its known start is ≤ t and its known end is ≥ t; point events on their date. */
export function holdsAt(l: GLink, t: string): "yes" | "no" | "undated" {
  if (l.date_lo || l.date_hi) return (l.date_lo ?? l.date_hi!) <= t && t <= (l.date_hi ?? l.date_lo!) ? "yes" : "no";
  const from = l.valid_from_lo ?? l.valid_from_hi, to = l.valid_to_hi ?? l.valid_to_lo;
  if (!from && !to) return "undated";
  if (from && from > t) return "no";
  if (to && to < t) return "no";
  return "yes";
}

function collect(g: Graph, links: GLink[], seed: string[] = []): Subgraph {
  const ids = new Set<string>(seed);
  for (const l of links) { ids.add(l.src); ids.add(l.dst); }
  const entities = [...ids].map((i) => g.entities.get(i)).filter((e): e is GEntity => !!e);
  const attributes = entities.flatMap((e) => g.attrsOf.get(e.id) ?? []);
  return { entities, links, attributes, truncated: false };
}

export interface EgoOpts { predicates?: string[]; asOf?: string; minGrade?: string; limit?: number; includeDerived?: boolean }
/** Neighbourhood of an entity, `hops` deep, best-graded edges first, bounded by `limit` edges. */
export function ego(g: Graph, id: string, hops = 1, o: EgoOpts = {}): Subgraph {
  const limit = o.limit ?? 200, preds = o.predicates && new Set(o.predicates);
  const seen = new Set<string>([id]), picked: GLink[] = [], pickedIds = new Set<string>();
  let frontier = [id], truncated = false;
  for (let h = 0; h < hops && frontier.length && !truncated; h++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const l of touching(g, n)) {
        if (pickedIds.has(l.id)) continue;
        if (preds && !preds.has(l.predicate)) continue;
        if (!gradeOk(l.grade, o.minGrade)) continue;
        if (l.derived && o.includeDerived === false) continue;
        if (o.asOf && holdsAt(l, o.asOf) === "no") continue;
        if (picked.length >= limit) { truncated = true; break; }
        picked.push(l); pickedIds.add(l.id);
        const m = other(l, n);
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
      if (truncated) break;
    }
    frontier = next;
  }
  return { ...collect(g, picked, [id]), truncated };
}

export interface PathOpts { predicates?: string[]; window?: { lo?: string; hi?: string }; limit?: number; budget?: number }
export interface Path { nodes: string[]; links: GLink[] }
/** Simple paths a→b up to `maxLen` edges (undirected), best-graded first, bounded by `limit` paths and a node budget. */
export function paths(g: Graph, a: string, b: string, maxLen = 3, o: PathOpts = {}): { paths: Path[]; sub: Subgraph } {
  const limit = o.limit ?? 20, preds = o.predicates && new Set(o.predicates);
  let budget = o.budget ?? 50_000, truncated = false;
  const found: Path[] = [];
  const inWindow = (l: GLink) => {
    if (!o.window) return true;
    const from = l.valid_from_lo ?? l.date_lo, to = l.valid_to_hi ?? l.date_hi;
    if (o.window.hi && from && from > o.window.hi) return false;
    if (o.window.lo && to && to < o.window.lo) return false;
    return true;
  };
  // iterative deepening so the shortest paths come first
  for (let depth = 1; depth <= maxLen && found.length < limit && !truncated; depth++) {
    const walk = (n: string, path: Path, visited: Set<string>) => {
      if (found.length >= limit || truncated) return;
      if (--budget <= 0) { truncated = true; return; }
      if (path.links.length === depth) { if (n === b) found.push({ nodes: [...path.nodes], links: [...path.links] }); return; }
      for (const l of touching(g, n)) {
        if (preds && !preds.has(l.predicate)) continue;
        if (!inWindow(l)) continue;
        const m = other(l, n);
        if (visited.has(m)) continue;
        if (m === b && path.links.length + 1 !== depth) continue;   // reach b only at the target depth
        visited.add(m); path.nodes.push(m); path.links.push(l);
        walk(m, path, visited);
        visited.delete(m); path.nodes.pop(); path.links.pop();
      }
    };
    walk(a, { nodes: [a], links: [] }, new Set([a]));
  }
  const links = [...new Map(found.flatMap((p) => p.links).map((l) => [l.id, l])).values()];
  return { paths: found, sub: { ...collect(g, links, [a, b]), truncated } };
}

/** Entities of type `on` present in both subgraphs, with the edges from either side that touch them. */
export function intersect(a: Subgraph, b: Subgraph, on?: string): Subgraph {
  const inB = new Set(b.entities.map((e) => e.id));
  const shared = a.entities.filter((e) => inB.has(e.id) && (!on || e.type === on));
  const ids = new Set(shared.map((e) => e.id));
  const links = [...new Map([...a.links, ...b.links].filter((l) => ids.has(l.src) || ids.has(l.dst)).map((l) => [l.id, l])).values()];
  const ents = new Map(shared.map((e) => [e.id, e]));
  for (const l of links) for (const x of [a, b]) for (const e of x.entities) if ((e.id === l.src || e.id === l.dst) && !ents.has(e.id)) ents.set(e.id, e);
  return { entities: [...ents.values()], links, attributes: [...a.attributes, ...b.attributes].filter((x) => ids.has(x.entity)), truncated: a.truncated || b.truncated };
}

export interface Fold { a: string; b: string; via: string[]; links: GLink[] }
/** Meta-path folding: ["person","works_at","organization","works_at","person"] → pairs of persons sharing an employer.
 *  Predicates match in either direction; "*" matches any predicate or type. */
export function fold(g: Graph, metaPath: string[], o: { limit?: number; from?: string } = {}): { folds: Fold[]; sub: Subgraph } {
  if (metaPath.length < 3 || metaPath.length % 2 === 0) throw new Error("meta-path must alternate type, predicate, type, …");
  const limit = o.limit ?? 200;
  const typeOk = (e: GEntity | undefined, t: string) => !!e && (t === "*" || e.type === t);
  const starts = o.from ? [g.entities.get(o.from)].filter((e): e is GEntity => !!e) : [...g.entities.values()].filter((e) => typeOk(e, metaPath[0]!));
  const folds: Fold[] = [];
  const seenPair = new Set<string>();
  let truncated = false;
  const walk = (n: string, i: number, via: string[], links: GLink[], start: string) => {
    if (folds.length >= limit) { truncated = true; return; }
    if (i >= metaPath.length - 1) {
      if (n === start) return;
      const key = start < n ? `${start}|${n}` : `${n}|${start}`;
      if (seenPair.has(key)) return;
      seenPair.add(key); folds.push({ a: start, b: n, via: [...via], links: [...links] });
      return;
    }
    const pred = metaPath[i + 1]!, nextType = metaPath[i + 2]!;
    for (const l of touching(g, n)) {
      if (pred !== "*" && l.predicate !== pred) continue;
      const m = other(l, n);
      if (!typeOk(g.entities.get(m), nextType) || via.includes(m) || m === start) continue;
      if (i + 2 < metaPath.length - 1) via.push(m);
      links.push(l);
      walk(m, i + 2, via, links, start);
      links.pop();
      if (i + 2 < metaPath.length - 1) via.pop();
    }
  };
  for (const s of starts) { walk(s.id, 0, [], [], s.id); if (truncated) break; }
  const links = [...new Map(folds.flatMap((f) => f.links).map((l) => [l.id, l])).values()];
  return { folds, sub: { ...collect(g, links), truncated } };
}

export interface TimelineEntry { at: string | null; until: string | null; fuzzy: boolean; link: GLink; entity: string; direction: "out" | "in" }
/** Dated edges of an entity (or of a subgraph), earliest first; undated edges are listed last. */
export function timeline(g: Graph, target: string | Subgraph): TimelineEntry[] {
  const ids = typeof target === "string" ? [target] : target.entities.map((e) => e.id);
  const links = typeof target === "string" ? touching(g, target) : target.links;
  const idSet = new Set(ids);
  const rows: TimelineEntry[] = [];
  for (const l of new Map(links.map((l) => [l.id, l])).values()) {
    const entity = idSet.has(l.src) ? l.src : l.dst;
    const at = l.date_lo ?? l.valid_from_lo ?? l.valid_from_hi ?? null, until = l.date_hi && l.date_hi !== l.date_lo ? l.date_hi : l.valid_to_hi ?? l.valid_to_lo ?? null;
    rows.push({ at, until, fuzzy: !!(l.valid_from_lo && l.valid_from_hi && l.valid_from_lo !== l.valid_from_hi), link: l, entity, direction: l.src === entity ? "out" : "in" });
  }
  return rows.sort((x, y) => (x.at === null ? 1 : y.at === null ? -1 : x.at.localeCompare(y.at)) || linkOrder(x.link, y.link));
}

/** The world as of one date: edges that hold at t, attributes valid then, and the undated remainder kept apart. */
export function at(g: Graph, id: string, t: string): { holds: GLink[]; undated: GLink[]; ended: GLink[]; attributes: GAttribute[] } {
  const holds: GLink[] = [], undated: GLink[] = [], ended: GLink[] = [];
  for (const l of touching(g, id)) { const h = holdsAt(l, t); (h === "yes" ? holds : h === "no" ? ended : undated).push(l); }
  const attributes = (g.attrsOf.get(id) ?? []).filter((a) => (!a.valid_from_lo || a.valid_from_lo <= t) && (!a.valid_to_hi || a.valid_to_hi >= t));
  return { holds: holds.sort(linkOrder), undated: undated.sort(linkOrder), ended: ended.sort(linkOrder), attributes };
}

/** Competing facts: contested links/attributes and links whose qualifiers disagree across sources. */
export function contested(g: Graph, id?: string, predicate?: string): { links: GLink[]; attributes: GAttribute[] } {
  const links = (id ? touching(g, id) : g.links).filter((l) => (l.contested || l.grade === "disputed" || Object.keys(l.qualifier_conflicts ?? {}).length > 0) && (!predicate || l.predicate === predicate));
  const attributes = (id ? g.attrsOf.get(id) ?? [] : g.attributes).filter((a) => a.contested || a.grade === "disputed");
  return { links: [...new Map(links.map((l) => [l.id, l])).values()], attributes };
}

export interface Similar { id: string; score: number; shared: string[] }
/** Entities of the same type that share neighbours (Jaccard over neighbour sets) — the "who else sits here" question. */
export function similar(g: Graph, id: string, k = 10): Similar[] {
  const me = g.entities.get(id);
  if (!me) return [];
  const nb = (x: string) => new Set(touching(g, x).map((l) => other(l, x)));
  const mine = nb(id);
  if (!mine.size) return [];
  const out: Similar[] = [];
  const candidates = new Set<string>();
  for (const n of mine) for (const l of touching(g, n)) { const m = other(l, n); if (m !== id && g.entities.get(m)?.type === me.type) candidates.add(m); }
  for (const c of candidates) {
    const theirs = nb(c);
    const shared = [...mine].filter((x) => theirs.has(x));
    if (!shared.length) continue;
    out.push({ id: c, score: Number((shared.length / (mine.size + theirs.size - shared.length)).toFixed(3)), shared });
  }
  return out.sort((a, b) => b.score - a.score || b.shared.length - a.shared.length).slice(0, k);
}
