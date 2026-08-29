# Research 02 — Entity resolution, cheap and multi-source

*Research agent report, 2026-08-29. Question: how does a system decide "ACORN" = "Acorn Capital" and that registry-profile Person E is LinkedIn-Person E, cheaply and reversibly?*

## 1. The classic pipeline (and where it breaks)

**Normalization.** NFKC, casefold, strip punctuation/diacritics into `name_norm`; keep the raw surface. Orgs: strip legal suffixes (LP, LLC, SAS, GmbH) with a suffix table ([cleanco](https://github.com/psolin/cleanco)) but *store* the stripped suffix as a feature — "Acorn" vs "Acorn Capital Management LP" is a signal. Persons: split given/family, detect ALL-CAPS-surname French convention ("Eliot VARNEY"), generate initials.

**Blocking.** Pairwise is O(n²). Survey: Papadakis et al. ([arXiv 1905.06167](https://arxiv.org/abs/1905.06167)). Practice: OR multiple cheap rules (Splink's approach) — same `name_norm`; first token + type; metaphone(surname) + first initial; same domain/handle; `pg_trgm` similarity > 0.4; top-20 pgvector neighbors. Aim for recall ≥ 0.98 at blocking; precision is the scorer's job.

**Pairwise scoring — Fellegi–Sunter** (as in [Splink](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html)): each comparison (name exact / Jaro–Winkler ≥ 0.92 / metaphone / else; employer; city; date overlap) gets m (P(obs | match)) and u (P(obs | non-match)); log2(m/u) match weights add; weight 4 ≈ 95%. **u-probabilities solve the common-name problem automatically**: a surname shared by 40k people has high u, so a name-only match earns little. Estimate λ and u by random sampling, m via EM ([rationale](https://moj-analytical-services.github.io/splink/topic_guides/training/training_rationale.html)). TF-IDF cosine on name tokens is a good org feature (rare tokens like "Cedar" dominate; "Capital" contributes nothing).

**Clustering.** Transitive closure gives recall but "very low precision" ([Draisbach et al.](https://hpi.de/oldsite/fileadmin/user_upload/fachgebiete/naumann/publications/PDFs/2019_draisbach_transforming.pdf); [survey](https://arxiv.org/pdf/1905.06397)): A≈B and B≈C does not imply A≈C; one wrong link creates "a large number of implicit false positives" ([Linacre](https://www.robinlinacre.com/measuring_data_linking_accuracy/)). Alternatives: center/merge-center, Markov clustering, correlation clustering (uses negative edges too).

**Practices.**
- Two thresholds: auto-merge ≥ 0.95, auto-reject < 0.30, middle = "uncertain band".
- Connected components only over edges ≥ 0.95, then **post-check every cluster for conflicts** (two emails, two licence numbers, two DOBs, two Wikidata QIDs) → split by dropping the weakest edge.
- Cap cluster size (~50 mentions); route black-hole clusters to review.

## 2. Tools

| Tool | Approach | Fit |
|---|---|---|
| **Splink** (MIT) | Fellegi–Sunter, unsupervised EM, SQL-generated; DuckDB/Spark/Postgres | Best fit. Postgres backend is minimal; run in a Python sidecar on DuckDB over exported mentions; write scored pairs back. |
| Dedupe (MIT) | active learning, 20–50 human labels | fine small; awkward at scale |
| Zingg | Spark active learning | overkill |
| Senzing | commercial, free to 100k records | strongest out-of-box; opaque |
| pyJedAI | blocking/meta-blocking + many clustering algos | useful for the clustering step |
| Ditto / DeepMatcher / Unicorn | supervised PLM matchers | need thousands of labels; PLMs drop 22–61% F1 on unseen entities. Skip for M1. |

Native Postgres: `pg_trgm`, `fuzzystrmatch` (`dmetaphone`, `levenshtein`), `pgvector` for kNN on "name + context" strings.

## 3. LLM-assisted resolution, cheaply

Peeters & Bizer, EDBT 2025 ([arXiv 2310.11244](https://arxiv.org/html/2310.11244v4)): zero-shot GPT-4-class beats fine-tuned matchers by 40–68% F1 on *unseen* entities; cheap-model zero-shot ≈ $0.06 per 1,000 pairs; handwritten matching rules *hurt* strong models. BATCHER (ICDE 2024, [PDF](https://dbgroup.cs.tsinghua.edu.cn/ligl/papers/ICDE24-ER.pdf)) and CE-RAG4EM ([arXiv 2602.05708](https://arxiv.org/html/2602.05708)): pack 4–6 pairs per prompt with retrieved evidence. LLM confidence poorly calibrated ([arXiv 2509.19557](https://arxiv.org/pdf/2509.19557)) — ask for a categorical verdict + cited evidence.

Rule: LLM only on the middle band (5–15% of pairs after Splink), batches of 5, cheap model, each side as `{surface forms, source URL, 2 evidence quotes, extracted attributes}`, output `same | different | unsure | related(parent/child/alias)` + one-line reason. 100k uncertain pairs ≈ $10–30.

## 4. Organizations

- **Suffix stripping is a feature, not a merge rule.** "Acorn Capital Management, LP" is the SEC-registered adviser (CRD 304391, [adviserinfo](https://adviserinfo.sec.gov/firm/summary/304391)) that *manages* the brand "ACORN". Model: `Acorn Capital Management LP —manages→ ACORN`, with "Acorn"/"ACORN"/"Acorn Capital" as aliases of the firm node.
- **Alias tables.** Wikidata [Q4346838](https://www.wikidata.org/wiki/Q4346838) lists AMCD / Alder Maple aliases + Crunchbase ID + official website. Seed `org_alias` from Wikidata aliases + Crunchbase slugs + OpenCorporates legal names; **a shared website domain is the strongest cheap org key.**
- **Acronyms**: generate the initialism (K-P-C-B); require co-occurrence or an alias-table hit before merging.
- **Policy**: merge on alias/domain/registry match, or suffix-stripped name equal AND same sector/city AND no conflicting registry IDs. Otherwise `related_to(kind=parent|subsidiary|manages|fund_of)` or `same_as(status=proposed)`. **Never silently merge across a type boundary** (brand vs legal entity vs fund) — link.

## 5. Persons across weak sources

OpenAlex's recipe ([how it's built](https://help.openalex.org/data/how-its-built/)): weigh name, co-mentions, affiliations, topics, plus a hard ID (ORCID) when present; hard IDs are *propagated* to mentions that lack them once clustered.
- **Identity keys** (near-decisive): email, handle/URL, ORCID, registry/licence number, phone. Same key ⇒ +15; conflicting key ⇒ veto.
- **Context**: employer (+4), city (+2), overlapping years (+1), shared co-mentions (+3 each, cap 9), same activity domain (+1).
- **Negative evidence**: conflicting DOB / gender / concurrent employer / distinct hard IDs ⇒ `not_same_as`.
- **Common-name**: u from name frequency (INSEE/SSA tables or corpus frequency). "Eliot Varney" is rare ⇒ name alone ~+10; "Jean Martin" ~+2.

## 6. Reversibility & provenance

```
mention(id, source_url, surface, type, attrs, evidence_quote, fetched_at)      -- immutable
candidate_pair(m1, m2, features jsonb, score, method, model_version, created_at)
decision(id, m1, m2, verdict same_as|not_same_as|related, kind, confidence,
         by human|rule|splink|llm, evidence, note, created_at, superseded_by)
entity = materialized view: connected components over active same_as minus not_same_as,
         conflict-checked → refreshed on demand
```
Stable entity IDs via `canonical_mention` (oldest wins); undo = superseding decision + re-materialize. Matches [Resolvi](https://arxiv.org/html/2503.08087v3), Neo4j's `SAME_AS{confidence,status,method}` review pattern ([agent-memory](https://neo4j.com/labs/agent-memory/explanation/resolution-deduplication/)), FHIR `$unmerge`. New mention → block → score only against its blocks; a new hard ID can *split* a cluster, so conflict-check runs on every refresh.

## 7. Evaluation

Measure at cluster level (B³ precision/recall), not only pairwise — pairwise F1 hides cascading merges ([Linacre](https://www.robinlinacre.com/measuring_data_linking_accuracy/); [er-evaluation](https://github.com/OlivierBinette/Awesome-Entity-Resolution)). Build gold by **scenario sampling**: group candidate pairs by comparison vector, label 5–10 per frequent vector + adversarial cases (two the maintainers, AMCD vs AM). 200–400 labels suffice. Track pairwise P/R in the middle band, B³ F1, clusters split by conflict check, LLM call cost.

## Recommendation for WorldGraph M1

1. **Normalize (TS)**: `name_norm`, `org_core`, `initialism`, `surname_dmetaphone`, extracted keys (email/URL/handle/licence regex), context attrs (org, city, years) per mention.
2. **Block (Postgres)**: OR of — same key; same `org_core`/`name_norm`; `pg_trgm similarity > 0.45`; `dmetaphone(surname)` + first initial; initialism ↔ ALL-CAPS token; pgvector top-20 on `"{name} | {org} | {city}"`. ≤ 50× mentions pairs.
3. **Score (Python sidecar, Splink on DuckDB)**: name (exact / JW ≥ 0.92 / dmetaphone / TF-IDF ≥ 0.6), hard-key, org, city, year overlap, co-mention Jaccard. u by sampling, m by EM; +15/veto for hard keys. **≥ 0.95 same · < 0.30 different · between → LLM.**
4. **Org alias layer**: Wikidata aliases + website domain + registry IDs; type-boundary rule → `related(manages|fund_of)` not merge.
5. **LLM band** (Haiku-class): batches of 5, evidence both sides, verdict ∈ {same, different, related:kind, unsure}; unsure → human. < $1 per 10k pairs.
6. **Cluster**: components on same ≥ 0.95 ∪ LLM-same; hard-key conflict check; split on conflict; cap 50.
7. **Persist decisions**; entities as a view; undo = superseding decision.
8. **Evaluate**: 300-pair scenario-sampled gold; B³ F1 ≥ 0.9 before raising auto thresholds.

**The athle.fr case.** Surname exact after casefold; rare name ⇒ ~+10; FRA vs "France" (+2); club/city vs profile city (+2 if present); no conflicts → lands ~0.85–0.93, the middle band. The LLM sees both evidence quotes and says `same` or `unsure`. What makes it decisive cheaply: (a) club/city matching LinkedIn location, (b) a birth-year band from the athletics category consistent with graduation year, (c) a co-mention, or (d) the founder's one-click confirmation — stored as a human `same_as` decision that **also attaches `licence 1000001` as a hard identity key**, so every future athle.fr mention resolves deterministically. Design lesson: **every human confirmation should harvest a new hard key for the entity.**
