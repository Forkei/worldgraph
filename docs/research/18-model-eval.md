# 18 — Model eval: the investigator on one case, three models

*2026-09-02. Harness: `wg eval --seed examplerealm.online --kind domain --models … --ceiling 1.5 --steps 200`.
Each model investigates the same case from scratch in its own investigation (title `EVAL <model> · <seed>`),
same extractor (Gemini 3.7 Flash), same tools, same playbooks, same $1.50 ceiling. Measured after a final rebuild.*

| model | inv | entities | links | corroborated facts | sources | $ | steps | tool calls | min | ended |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude Haiku 4.5 | 01a062ce | 68 | 75 | 19 | 20 | ~1.5 | — | 198 | — | ceiling (run log lost to a DNS outage) |
| Claude Sonnet 5 (low) | 01a062e3 | 75 | 82 | **54** | **39** | 1.69 | 51 | 147 | 13 | ceiling $1.50 |
| Claude Sonnet 5 (medium) | 01a062ee | 51 | 47 | 31 | 26 | 1.49 | 51 | 133 | 12 | finished on its own |

Reference: the earlier full run on the same case with Sonnet 5 (low), $3 ceiling — 130 tool calls, $1.82, 11 min,
and a report that met the domain stopping bar (`HANDOFF §8`).

## What the numbers say

- **Corroborated facts per dollar** is the metric that matters (a fact with ≥2 independent origins or an
  authoritative record), not entity count. Sonnet low produced ~3× Haiku's corroborated facts for the same money,
  from twice the sources: it reads more pages and reads the right ones. Haiku spends its calls on searches and
  graph lookups and contributes thinly.
- **Haiku's report is an infrastructure listing** (registrar, IPs, nameservers) with the operator question barely
  touched; Sonnet's reports name the operator with the evidence chain and disentangle the homonyms.
- **Sonnet medium finished on its own** under the ceiling with fewer facts. Its extra reasoning went into
  judging "done" earlier, not into collecting more. For collection-heavy runs, low effort + more budget beats
  medium effort.
- Both Sonnet runs used ~50 model steps for ~140 tool calls: it batches several tool calls per turn, which is
  where the cost efficiency comes from.

## Decision

Default agent model: **Sonnet 5 (low)**. Haiku is not good enough to drive an investigation; it may still serve
as the judge (identity pairs, where it already is) and could serve as a reader. Sonnet medium is not worth its
premium here. Opus 5 not yet measured (roughly 2.5× Sonnet's price; try on a person case where reasoning about
namesakes matters more than volume). Gemini and open-weight models need a tool loop implementation first
(`runToolLoop` is Anthropic-only) — the eval harness is ready for them once that exists.

## Caveats

- One case, one run each: variance between runs of the same model is real and unmeasured. Run the harness three
  times per model before trusting a small difference.
- Precision was not measured here (`wg audit` samples claims against their quotes; run it on the three EVAL
  investigations for the missing column).
- Haiku's cost/time columns are missing because a machine-level DNS outage killed the eval process after its run;
  its graph and report survived in the database.
