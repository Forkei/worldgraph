# Extraction model benchmark — results

Generated 2026-08-29T18:39Z. Same prompt, same JSON schema, same 10 real pages (capped at 24k chars each). Judge: Claude Opus 5, grading up to 60 items per page against the page text.

| Model | Pages | Items (rel+attr) | Quote verbatim | Judge: supported | partial | unsupported | Mean s/page | Max s | $/page | $ total | Good items / $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gemini 3.7 Flash | 10/10 | 237 (160+77) | 92% | **100%** | 0% | 0% | 10.2 | 16 | $0.0226 | $0.226 | 1043 |
| Gemini 3.1 Pro | 10/10 | 318 (237+81) | 77% | **97%** | 3% | 0% | 104.5 | 232 | $0.1895 | $1.895 | 164 |
| Opus 5 (low) | 10/10 | 357 (247+110) | 92% | **97%** | 2% | 0% | 43.2 | 89 | $0.1777 | $1.777 | 195 |
| Sonnet 5 (low) | 10/10 | 352 (269+83) | 91% | **97%** | 2% | 1% | 33.2 | 61 | $0.0689 | $0.689 | 496 |
| Haiku 4.5 | 10/10 | 475 (267+208) | 87% | **95%** | 4% | 1% | 31.7 | 72 | $0.0382 | $0.382 | 1187 |
| Sonnet 5 (medium) | 9/10 | 339 (265+74) | 97% | **94%** | 5% | 1% | 37.7 | 77 | $0.0752 | $0.677 | 473 |
| Gemini 3.5 Flash-Lite | 10/10 | 188 (150+38) | 94% | **92%** | 7% | 1% | 8.9 | 23 | $0.0117 | $0.117 | 1481 |
| Gemini 2.5 Flash | 9/10 | 772 (517+255) | 80% | **91%** | 8% | 1% | 68.9 | 122 | $0.0486 | $0.437 | 1604 |

**How to read it**
- *Items*: relations + attributes emitted. More is not better by itself — see *supported*.
- *Quote verbatim*: share of items whose quote is found character-for-character (after whitespace/quote-mark normalization) in the page. This is the M0 hard gate; anything below ~90% means the model paraphrases quotes.
- *Judge supported*: share of items an independent Opus 5 judge says the page actually states. This is the accuracy number.
- *Good items / $*: estimated supported items per dollar — the cost-efficiency number.


**Errors**

- Sonnet 5 (medium): wiki-org: Streaming is required for operations that may take longer than 10 minutes. See h

**Other/proposed types & predicates emitted** (open-ontology escape hatch usage)

- Gemini 3.7 Flash: 0 other types, 2 other predicates
- Gemini 3.1 Pro: 1 other types, 23 other predicates
- Opus 5 (low): 10 other types, 42 other predicates
- Sonnet 5 (low): 10 other types, 30 other predicates
- Haiku 4.5: 4 other types, 3 other predicates
- Sonnet 5 (medium): 2 other types, 43 other predicates
- Gemini 3.5 Flash-Lite: 0 other types, 3 other predicates
- Gemini 2.5 Flash: 87 other types, 171 other predicates
