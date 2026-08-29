# Research 01 — Evidence-based accuracy (truth discovery, source reliability, LLM confidence)

*Research agent report, 2026-08-29. Question: how do we get accuracy that is real, not a made-up number?*

## 1. Truth discovery / knowledge fusion: what the real methods do

All share one loop: **fact truth ↔ source reliability**, estimated jointly without labels. Survey: Li et al., [arXiv 1505.02463](https://arxiv.org/abs/1505.02463).

- **Majority / weighted voting.** Count sources per value. Needs ≥3 sources per fact. Fails when sources copy each other. Yet Waguih & Berti-Equille found "majority voting is competitive with more sophisticated truth discovery methods" on most datasets ([arXiv 1409.6428](https://arxiv.org/pdf/1409.6428)) — fancy models only win when source reliability varies a lot.
- **TruthFinder** (Yin, Han, Yu 2008; [PDF](http://hanj.cs.illinois.edu/pdf/kdd07_xyin.pdf)). Fixed-point: fact confidence = 1 − ∏(1 − source trust); source trust = mean confidence of its facts. Assumes independence; copying breaks it. ~100 lines to implement.
- **Latent Truth Model** (Zhao et al., VLDB 2012; [PDF](http://web.cs.ucla.edu/~yzsun/classes/2014Spring_CS7280/Papers/Trust/p550-zhao.pdf)). Bayesian; each source has separate false-positive and false-negative rates; handles multi-valued facts. Needs many facts per source.
- **Latent Credibility Analysis** (Pasternack & Roth, WWW 2013; [PDF](https://cogcomp.seas.upenn.edu/papers/PasternackRo13.pdf)). EM over mutual-exclusion sets; source honesty latent.
- **Dawid–Skene** ([comparison](https://arxiv.org/pdf/1310.5764)). Confusion matrix per source via EM; +6–7 pts over majority when the model fits; majority is more robust.
- **Google Knowledge Vault** (Dong et al., KDD 2014; [PDF](https://www.cs.ubc.ca/~murphyk/papers/kv-kdd14.pdf)). *Supervised* fusion classifier over per-triple features — **number of unique sources**, per-extractor confidence, which extractors fired — trained under a local closed-world assumption with Freebase as labels; validated by plotting predicted vs observed precision. Lesson: extractor confidence is *one feature into a calibrated classifier*, never the output. Sequel **Knowledge-Based Trust** ([arXiv 1502.03519](https://arxiv.org/abs/1502.03519)) separates *extraction error* from *source error* as distinct latent variables — exactly what a fudge multiplier collapses.
- **Copying / source dependence** (Dong, Berti-Equille, Srivastava VLDB 2009; [ACM](https://dl.acm.org/doi/10.14778/1687627.1687690)). Sharing *true* values is weak evidence of copying; sharing the same *false* values is strong evidence. Churnalism: 54% of UK articles partly PR-sourced; some outlets reuse up to 97% of press-release text ([CJR](https://www.cjr.org/the_news_frontier/churnalism_exposed.php), [T&F 2024](https://www.tandfonline.com/doi/full/10.1080/1461670X.2024.2409836)). **For OSINT, independence — not count — is the whole game.**

## 2. Source reliability without labels: the cheap version

The iterative loop only converges with many facts per source *and* real conflicts — M1 has neither. Proxies, by cost:

1. **Domain tier priors.** Wikipedia Perennial Sources (~1,200 domains; [page](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources), Wikidata [Q59821108](https://www.wikidata.org/wiki/Q59821108)); Media Bias/Fact Check factuality ([API](https://mediabiasfactcheck.com/mbfcs-data-api/)); Iffy Index ([iffy.news](https://iffy.news/index/)). Rating sets agree strongly ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10500312/)). Structural tiers: government / registry / court / SEC / company-own-site = primary; wire (Reuters/AP/AFP) = high; PR wires and aggregators = zero independent weight.
2. **Primary vs aggregator detection.** Host in PR-wire/aggregator list; "SOURCE:" / "PRNewswire" boilerplate; `<link rel=canonical>` off-site; schema.org `isBasedOn`; later publish date than a near-duplicate.
3. **Near-duplicate collapsing.** MinHash+LSH on 5-shingles at *passage/quote* level, Jaccard ≥ 0.6 → same origin cluster. Ten aggregators of one release = 1 origin. `pg_trgm similarity()` with a GIN index is fine at M1 scale ([docs](https://www.postgresql.org/docs/current/pgtrgm.html)); [`minhash` npm](https://www.npmjs.com/package/minhash), [datasketch](https://yorko.github.io/2023/practical-near-dup-detection/).
4. **Shared-false-value copy detection** — only once there are enough conflicts. Not M1.

## 3. LLM self-reported confidence: usable?

**As a feature, weakly; as a number to show, no.**
- Kadavath et al. ([arXiv 2207.05221](https://arxiv.org/abs/2207.05221)): calibrated on multiple-choice / true-false in the right format; degrades under shift.
- Tian et al. EMNLP 2023 ([arXiv 2305.14975](https://arxiv.org/abs/2305.14975)): verbalized confidence beats logprobs for RLHF models but overconfidence remains.
- 2024–25: verbalized confidence clusters at 80–100% regardless of accuracy; RLHF makes it worse ([arXiv 2502.11028](https://arxiv.org/pdf/2502.11028); [ICLR 2025](https://openreview.net/forum?id=l0tg0jzsdL)). LLM judges are overconfident too ([arXiv 2508.06225](https://arxiv.org/html/2508.06225v2)); self-consistency misses confidently-wrong answers ([arXiv 2505.17656](https://arxiv.org/pdf/2505.17656)).

Cheap, defensible signals for an *extraction* task ("does the quote support S-P-O?"):

| Signal | Cost | What it buys |
|---|---|---|
| Quote verbatim-in-page check | ~0 | Kills fabricated quotes; hard gate |
| NLI cross-encoder (DeBERTa-MNLI) quote → claim: entail / neutral / contradict | tiny (CPU) | Objective "quote supports claim" verdict ([sbert NLI](https://sbert.net/examples/cross_encoder/training/nli/README.html)) |
| Independent judge model (different vendor), binary "supported by quote?" | 1 cheap call / claim | Decorrelated error; ~90%+ human agreement in fact-checking setups ([FactEHR](https://arxiv.org/pdf/2412.12422)) |
| Re-extraction agreement (2–3×) | 2–3× | Catches unstable extractions; misses systematic errors |
| Verbalized confidence | 0 | Raw feature; bucket low/med/high; never display |

## 4. Evidence-based edge scoring

Store components, not a product. Present a *profile*, derive a *grade*, show a number only where it's a real count.

**Per claim:** `quote_found` (exact/fuzzy/none — hard gate), `support` (entails / neutral / contradicts from NLI, optional judge verdict), `extractor_conf_bucket` (raw float kept, not scored).

**Per edge:** `origin_clusters` → **independent sources = number of near-duplicate clusters**; `primary_count`, `tier_max`, `tier_histogram`; `contradicting_clusters` (independent sources asserting a conflicting object for a functional predicate); `verified`; `first_seen`, `last_seen`.

**Grade (ordinal, not probability):**
- **Established** — ≥2 independent clusters incl. ≥1 primary, no contradictions, verified.
- **Corroborated** — ≥2 independent clusters, or 1 primary verified, no contradictions.
- **Single-source** — 1 cluster, verified.
- **Disputed** — any contradicting cluster of tier ≥ the supporting tier.
- **Unverified** — extraction-only or fuzzy-quote-only.

**Display:** `"3 independent sources (1 primary: sec.gov) · verified · last seen 2026-08-12"` or `"Disputed: 2 sources say X, 1 primary says Y"`. Show a percentage **only** when empirically grounded: after hand-labelling a few hundred edges, report *observed precision per grade* ("Corroborated edges were correct 91% of the time, n=212") — the Knowledge Vault approach. Never a per-edge float before that.

Wikidata's model is the template: statements carry references (P854 reference URL, P813 retrieved, P248 stated in) and *ranks* (preferred / normal / deprecated with reason), not confidence numbers ([Help:Sources](https://www.wikidata.org/wiki/Help:Sources)). FEVER's SUPPORTS / REFUTES / NEI is the right judge vocabulary. ClaimReview / Google Fact Check API as an "externally fact-checked" flag.

## 5. Reusable pieces
- Truth discovery (Python sidecar, later): [truthdiscovery](https://github.com/joesingo/truthdiscovery), [spectrum](https://github.com/totucuong/spectrum), [TruthFinder](https://github.com/IshitaTakeshi/TruthFinder).
- Dedup: `pg_trgm`, [`minhash` npm](https://github.com/duhaime/minhash), datasketch.
- Source tiers: Perennial Sources, MBFC API, Iffy Index.
- NLI: `cross-encoder/nli-deberta-v3-*` via ONNX sidecar or transformers.js.

## Recommendation for WorldGraph M1

**Store per claim:** source_url, domain, fetched_at, published_at, quote + offset + match kind, passage fingerprint (minhash or trigram-indexed), extractor_model, extractor_raw_conf (JSON, never scored), nli_label, judge_label (nullable), source_tier, is_primary, is_aggregator, origin_cluster_id.

**Store per edge:** independent_sources, primary_sources, tier_max, contradicting_sources, verified, grade, first_seen, last_seen. Recompute on every new claim; all counts, all SQL.

**Compute:** quote gate → passage dedup clustering → tier lookup → NLI on every claim → judge on edges with a conflict or a primary source → grade. No EM / TruthFinder yet — not enough conflicts per source to converge, and majority-of-independent-sources is competitive anyway.

**Show:** evidence profile string + grade badge; quote and URL on click; a "Disputed" panel with both sides. Never a percentage.

**Do not fake:** no extractor-conf × fudge products; no per-edge probability until an audited precision-per-grade table exists; no source-trust scores until ≥ ~50 adjudicated claims per domain.

**M2 unlock:** with labelled audits, train a KV-style fusion classifier on the stored features (that's when raw extractor confidence earns its keep) and turn on shared-false-value copy detection.
