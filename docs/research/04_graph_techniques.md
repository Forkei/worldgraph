# Research 04 — Graph techniques that actually help investigations

*Research agent report, 2026-08-29. Question: which graph theory is useful for an investigation graph, cheaply; what should "refolding" mean.*

Assumed scale: one investigation = 10²–10⁵ nodes, ≤ 1M edges, heterogeneous, provenance on every edge, intervals on many. At that size compute is ms–s; the cost is engineering and UX.

## 1. Structure & importance

| Technique | Answers | Cost | Verdict |
|---|---|---|---|
| Degree per edge type | "Who is the hub? Which org has 40 officers?" | SQL GROUP BY | **Day 1** |
| PageRank | "Who matters beyond degree?" | 0.02–0.07 s @300k edges (igraph) | Yes, per node type / on a typed projection. ICIJ's Paradise Papers used degree + PageRank + shortest paths, nothing fancier ([Neo4j](https://neo4j.com/blog/depth-graph-analysis-paradise-papers/)) |
| HITS | hubs vs authorities | same | Marginal |
| Betweenness | "Who is the broker between two clusters?" | O(nm): 637 s @300k (igraph); sample ([Brandes & Pich](https://link.springer.com/chapter/10.1007/978-3-540-77004-6_10)) | Exact < 50k edges, sampled above |
| **Articulation points / bridges** | "The one person connecting two worlds" | O(n+m), instant | **Highest-value cheap primitive.** In the 9/11 network each articulation point is a "messenger" ([Nat. Comm. 2017](https://www.nature.com/articles/ncomms14223)) |
| k-core | "Dense nucleus of the network" | O(m) | Yes; better than Louvain for core vs periphery |
| Ego-network (k-hop) | "Everything within 2 hops of X" | indexed traversal | The basic analyst gesture (Bloom "expand") |

## 2. Community & pattern detection

- **Leiden** over Louvain (Louvain can emit disconnected communities; Leiden guarantees connected — [Traag 2019](https://www.nature.com/articles/s41598-019-41695-z)). Run on a **one-mode projection** (person–person via shared orgs), never on the raw heterogeneous graph.
- **Pattern matching is what financial-crime tools actually run**: shared identifier across accounts, round-tripping = directed cycle, shell stars ([Neo4j fraud](https://neo4j.com/use-cases/fraud-detection/)). Linkurious productizes patterns as **alerts** — a Cypher pattern is a detection rule; matches dedupe into cases ([alerts](https://doc.linkurious.com/admin-manual/3.0/alerts/)). ICIJ's canonical find: "people sharing an address who aren't married, linked to suspicious accounts" ([Computer Weekly](https://www.computerweekly.com/news/450280758/Panama-Papers-revealed-by-graph-database-visualisation-software)).
- **Verdict**: pattern library > community detection. Ship named patterns: shared address, shared officer across ≥3 entities, star of shells around one nominee, directed cycle ≤5 hops, resigned-and-replaced-by-same-person.

## 3. Link prediction

- **Heuristics (common neighbors, Jaccard, Adamic–Adar)** are ms-cheap and repeatedly competitive with GNNs ([Neo-GNNs](https://arxiv.org/pdf/2206.04216); node2vec beats Adamic–Adar by ~1 AUROC point). **Use these, computed along meta-paths** (Person–Org–Person) so the score is typed and explainable ("both directors of 3 shared companies").
- **node2vec/DeepWalk**: unstable across runs, not explainable. Skip.
- **R-GCN / KGE (TransE, ComplEx, RotatE)**: benchmark wins don't transfer to small, sparse, domain-specific KGs ([RelaGraph](https://www.sciencedirect.com/science/article/abs/pii/S030645732300184X), [arXiv 2405.10745](https://arxiv.org/abs/2405.10745)). Defer until many linked investigations + a labelled "later-confirmed" edge set exists — the one dataset WorldGraph naturally produces.
- **Non-negotiable schema rule**: predicted edges live in a separate table (`suggested_edge` with `method`, `score`, `evidence_path`), never in the extracted-edge table; they become real only when an analyst accepts or a source is found.

## 4. Entity resolution as a graph problem

Bhattacharya & Getoor: resolve *collectively* using relational evidence — two "J. Smith" whose co-mentions already resolve to one cluster are more likely the same ([TKDD 2007](https://linqs.org/assets/resources/bhattacharya-tkdd07.pdf)). Practical: similarity = α·attribute_sim + (1−α)·Jaccard(resolved neighbors), iterate. Keep `same_as` as *edges with provenance*, clusters as a view (components above threshold), with a contradiction guard (two birthdates, two countries of incorporation ⇒ reject merge). Cross-investigation `same_as` are just lower-trust edges in the same mechanism — fits "link, never merge".

## 5. Summarization / "refolding"

- **Graph summarization** literature (supernodes minimizing reconstruction loss, [CSUR 2018](https://dl.acm.org/doi/10.1145/3186727)) is the wrong tool: grouping should be *semantic* (by org, place, time, community), not loss-minimizing.
- **Bipartite folding / one-mode projection**: person–org → person–person co-affiliation weighted by shared orgs; "the crucial step for all further analysis"; inflates density, so significance-test co-occurrence counts ([Zweig & Kaufmann](https://link.springer.com/article/10.1007/s13278-011-0021-0), [bipartite review 2023](https://arxiv.org/pdf/2310.01284)).

Refolding = a **projection operator** `fold(graph, meta_path, aggregate)` producing a derived graph whose edges carry the underlying paths as evidence. One SQL self-join per meta-path; materialize per investigation + meta-path.

## 6. Temporal graphs

Time-respecting paths are non-transitive ([Holme & Saramäki](https://arxiv.org/pdf/1108.1780)); temporal betweenness needs sampling — skip. Cheap and useful: `valid_from/valid_to` as `tstzrange` (GiST-indexable); "who was at X when Y was" = interval overlap join; snapshot at t = interval filter; diff = set difference of edge ids; time-respecting BFS only for "could information have flowed A→B".

## 7. Path & QA primitives

Shortest + k-shortest ≤ L with predicate/confidence/time filters — the headline Panama-Papers move (Tillerson → Queen). Linkurious ships "Find path" and "Expand non-leaf nodes" as templates; Bloom lets analysts pick relationship types to expand. **Meta-paths** (Sun et al., PathSim, [VLDB 2011](https://web.cs.ucla.edu/~yzsun/papers/vldb11_topKSim.pdf)) as the *vocabulary* for projections, link-prediction features, ER neighborhood similarity, and saved patterns — one concept, four uses.

## 8. Postgres/AGE vs library

- **Apache AGE**: openCypher MATCH, VLE `*1..n`; **no** built-in centrality/community/pathfinding ([gdotv](https://gdotv.com/blog/apache-age-explained/)). Recursive CTEs + `tstzrange` cover k-hop, overlap, components at this scale.
- **pgRouting**: `pgr_dijkstra` on any edge-table query ([docs](https://docs.pgrouting.org/latest/en/pgr_dijkstra.html)).
- **Sidecar**: igraph is the sweet spot (PageRank 0.07 s, k-core 0.01 s @300k; Leiden included) — load a per-investigation graph in < 1 s, cache results in `node_metrics(investigation_id, node_id, metric, value, computed_at)`.
- **Viz-level**: graphology has betweenness/PageRank/Louvain in JS for ≤ 50k edges; Cosmograph for millions. Compute metrics server-side so they're citable.

## Recommendation for WorldGraph (in order)

1. **Typed k-hop expand + ego-network** with type/confidence/time filters — "what's around X?"
2. **Path finder** (shortest + k-shortest ≤ L, predicate-filtered) — "how is A connected to B?"
3. **Meta-path projections ("refolding")** as materialized views with evidence paths — foundation for 4, 5, 7.
4. **Structural flags**: degree-by-type, articulation points, bridges, k-core, sampled betweenness (igraph sidecar, cached) — "who is the broker / hub / nucleus?"
5. **Named pattern library + alerts** — "does this graph contain a known scheme?"
6. **Temporal overlap + snapshot diff** via `tstzrange` — "who was where when; what's new?"
7. **Collective ER** (attribute + neighborhood Jaccard, `same_as` edges, contradiction guard).
8. **Heuristic link suggestions** (Adamic–Adar along meta-paths → `suggested_edge`). GNN/KGE only after accepted/rejected suggestions exist as labels across many investigations.

Leiden after 3, on projections. Skip node2vec, HITS, temporal centrality, loss-minimizing summarization.

## What "refolding" should mean in WorldGraph

A **level-of-detail operator over meta-paths**, not compression:
- `fold(P–O–P)`: person co-affiliation graph (weight = shared orgs, evidence = the two underlying edges).
- `fold(O–P–O)`: org interlock graph ("shared directors").
- `collapse(Org)`: supernode absorbing employees; superedges aggregated by type — zoom out; `unfold` restores.
- `fold(P–Event–P)`, `fold(P–Place–P)` with a time window: co-presence graphs.
- `fold(same_as)`: cluster-level view where each resolved entity is one node.

Every folded edge keeps its path evidence, so the folded view is as citable as the base graph. Refolding = switching meta-path; the base graph is never mutated.
