# Walkthrough — one investigation, tick by tick

*2026-08-30. A concrete run of the investigation model from `docs/research/11–13` on the canonical seed, so the
system can be imagined before it is designed. Autonomous mode. Prices and yields are realistic, not measured.
Notation: **[graph]** = computed structurally, no model call · **[LLM]** = a model call · **[connector]** = a
fetch or API · **[log]** = written to the research log / decision log.*

---

## Seed

> "Jane Doe, teaches at Lincoln Middle School, Springfield IL. Everything public: work, home, family, history,
> activities, accounts." Policy `unrestricted`. Budget $10.

## Tick 0 — the Question

**[LLM]** compiles the goal into a Question, using the registry and the expected-record table as its vocabulary:

```
Question Q1  subject: person "Jane Doe" {employer: "Lincoln Middle School", city: Springfield IL}
  sought: full public profile
  indicators (observable, discriminating):
    I1 employer + role + tenure          I5 household / spouse
    I2 professional credential           I6 relatives (parents, children)
    I3 residence per period               I7 accounts / handles
    I4 date of birth                      I8 activities, clubs, events
  kill criterion: no independent record ties "Jane Doe" to Lincoln MS  → stop, report "unverifiable seed"
  stop criterion: every indicator has ≥1 source, all mandatory expected records searched, ≥2 independent
                  sources on I1/I3/I5, no open contradictions, picture stable for 3 actions
```
That's the only free-text-to-structure step. Everything after is objects.

## Tick 1 — seed becomes graph; slots open; Actions raised

**[graph]** Creates candidate nodes: `person:Jane Doe` (grade F6 — unknown source, unconfirmed), `organization:Lincoln Middle School`, `place:Springfield IL`.

**[graph]** Joins the entities against `expected_record(entity_type × jurisdiction)` and the indicator list. Slots open:

| Slot | Expected because | Source | Expectedness |
|---|---|---|---|
| teaching licence | person·US-IL·teacher | ISBE ELIS lookup | mandatory |
| public salary | IL educator | ISBE salary file (cached bulk) | mandatory |
| employment record | I1 | district site, board minutes | usual |
| residence 2013→ | I3, covering predicate | people-search, recorder | usual |
| date of birth | I4 | people-search, race results | usual |
| household / spouse | I5 | recorder co-grantee, marriage index | usual |
| relatives | I6 | obituaries, people-search | usual |
| court records | person·US-IL | Judici | usual |
| voter record | person·US-IL | — IL not public | not obtainable |
| accounts | I7 | email pivots, username enumeration | usual |

**[graph]** Every open slot with a runnable source becomes an Action. Priority = *hardest-fact-first*: an Action that returns a **hard key** (licence #, email, DOB) outranks one that returns prose. Queue:

```
A1  ELIS licence lookup (name, district)          P:High   cost ¢   yields: licence# (hard key), district, endorsements
A2  salary file match (name, district)            P:High   cost ¢   yields: salary, years, degree
A3  district site: staff directory + minutes PDFs P:High   cost $0.05 yields: email (hard key), hire date, roles
A4  people-search (name, city, age?)              P:Med    cost 1 credit  — WAIT: no age band yet; pended until A1/A2 give one
A5  Judici court search                           P:Low    cost ¢
```
**[log]** decision: "A4 pended — a common name without an age band over-matches."

## Tick 2 — A1: licence lookup

**[connector]** ISBE ELIS returns **two** Jane Does with active licences: one employed by Springfield SD 186 (licence 2011, endorsement science 6–8), one in Peoria.

**[graph]** Two candidate entities. Correlation check against the seed: employer matches for #1 only → `same_as(seed, Doe#1)` with justification {employer match, name match}; Doe#2 kept as a **namesake** node with `not_same_as` (different district, different licence #). The namesake stays in the graph on purpose: every later ambiguous hit is checked against her too.

**[graph]** Slot *licence* → found. Hard key harvested: `licence:IL-2011-…`. Timeline anchor: licence issued 2011 → `works_at` lower bound. **Lead derivation** from the new fact: licence number → nothing else to unlock; endorsement "science 6–8" → strengthens I1.

## Tick 3 — A2: salary file (cached bulk)

**[connector]** Local cache hit (the ISBE file was loaded once; TTL a year). Match on name + district: salary $61,400, **13 years experience**, degree MA, FTE 1.0.

**[graph]** Timeline reasoning: 13 years experience (2026) → in-district since ≈2013; licence 2011 → **interval hole 2011–2013**. The `works_at` predicate is declared *covering*, so a hole is a gap → new slot "employment 2011–2013" → Action **A6**: search minutes/news for prior district (P:Low — not an indicator, but cheap). This is the graph noticing, not the model.

## Tick 4 — A3: district PDFs

**[connector]** `site:sps186.org "Doe" filetype:pdf` → 7 PDFs. Fetched, text extracted; board minutes are prose, the staff directory is a table (one claim per row).

**[LLM]** Extraction (the first door). Claims, each with a verbatim quote and span:
- `Jane Doe —works_at→ Lincoln MS {role: science teacher}` — staff directory 2025
- `Jane Doe —uses_account→ jdoe@sps186.org` — staff directory (account node; **hard key**)
- board minutes Aug 2013: "Jane Doe, science, Lincoln MS, **formerly Chatham CUSD 5**" → `works_at{valid_from: 2013-08}` and a new mention `Chatham CUSD 5` with `works_at{valid_to: 2013}`
- athletics page: "Coach Doe — cross country" → `member_of{role: coach}` to the XC team

**[graph]** The 2011–2013 hole is now *partially* filled by a claim, grade B3 (one secondary source). A6 is downgraded to "verify" (one cheap search of Chatham minutes) rather than "find".

**[graph]** Standing patterns fire on the new email: watches keyed on `(person, uses_account:email)` raise **A7** Gravatar, **A8** Holehe, **A9** GHunt (L3 — allowed under this policy; tier logged). Tick 4 cost so far: $0.06.

## Tick 5 — email pivots

**[connector]** Gravatar: avatar found (a photo — stored, used later only for *reuse* matching, never face search). Holehe: accounts exist on Strava, Goodreads, Pinterest. GHunt: Google account → Gaia ID (hard key) → **12 public Maps reviews**, 2018–2025.

**[LLM]** Reads the reviews as documents (dates, places, one sentence each). Claims: reviewed a dentist (2019), a daycare (2019, "great for our little one"), a vet (2021), 8 restaurants — 8 of 12 places within 2 miles of one neighbourhood on Springfield's west side.

**[graph]** Two things happen:
1. Location inference: the review centroid becomes `located_in{kind: residence, inferred: true}` — **derived, grade D3**, and the graph will *not* pivot from it automatically (weak-key ban).
2. A rule fires: `reviews(daycare, t) ⇒ likely parent_of(child, born ≈ t−2..t)`. That is not a fact; it becomes **Hypothesis H1: "has a child born 2017–2019"**, with predicted observations: an obituary listing grandchildren; a school-directory sibling; a birth announcement. No Action yet — H1's predictions will be checked opportunistically by whatever comes back.

**[graph]** A4 (people-search) is un-pended: age band now estimable (licence 2011 + MA ⇒ born ≤ 1988; experience ⇒ ≥ 30).

## Tick 6 — A4: people-search (API, 1 credit)

**[connector]** EnformionGO: one strong match. DOB 1985-03; addresses: 2013–2016 apartment on Monroe St; **2016–present, Y Lane**; relatives: Robert Doe (b. 1983), Margaret Smith (b. 1958), Thomas Smith (b. 1956); associates: two names.

**[graph]** Grade C (aggregator; and per the independence rule *all US people-search sites count as one source*). Creates place nodes; `lives_at` intervals now **cover 2013→present** (I3 satisfied at grade C). Relatives → `related_to{relation: unknown}` candidates. Cross-check: Y Lane is 0.6 mi from the review centroid → the inferred residence and the aggregator address **corroborate each other from independent origins** (Google vs credit-header) → residence rises to C2.

**[graph]** Rules propose hypotheses with predicted observations:
- **H2** "Robert Doe is her spouse" — predicts: co-grantee on the Y Lane deed; a marriage record in Sangamon County 2010–2016; obituary phrasing "Jane (Robert) Doe".
- **H3** "The Smiths are her parents (maiden name Smith)" — predicts: marriage record with bride surname Smith; obituary of a Smith listing "daughter Jane Doe".
- H2 and H3 are consistent with H1.

**[graph]** Attention allocation by **diagnosticity per cost**: the county recorder / assessor answers *residence confirmation (I3 primary) and H2 in one call* → **A10** assessor lookup, P:High. Marriage index → **A11**, P:High (answers H2 and H3). Obituary search "Smith Springfield 'Jane Doe'" → **A12**, P:Med. Court (A5) stays Low.

## Tick 7 — A10: assessor

**[connector]** Sangamon County GIS/assessor open data (the recorder portal has a CAPTCHA — skipped, logged as *not automatable*): parcel on Y Lane, owner **"DOE ROBERT J & JANE M"**, transfer 2016-06, $189,000.

**[graph]** Residence: **primary source** (A) — I3 now A1 (confirmed by independent sources). H2 gains a predicted observation (co-grantee) — but the graph marks it *supports, not proves*: a co-owner can be a sibling. Middle initial "M" harvested as an attribute. Temporal: purchase 2016-06 matches the Enformion interval boundary → consistent.

## Tick 8 — A11 + A12: marriage index, obituaries

**[connector]** County clerk marriage index: "Jane M. **Smith** & Robert J. Doe, 2012-06-16". **[connector]** Obituary search → Thomas Smith, d. 2022-11, Springfield: "survived by his wife Margaret; daughter **Jane (Robert) Doe** of Springfield; grandchildren **Ellie and Sam** Doe."

**[LLM]** Reads both into claims (the obituary's "survived by" clause is exactly the relation grammar the prompt knows).

**[graph]** Now the ripple:
- H2 (spouse): two *independent primary* observations (deed co-grantee, marriage record) + obituary phrasing → **Established**. `spouse_of{valid_from: 2012-06-16}` materializes; `related_to{unknown}` retracted with justification.
- H3 (parents): maiden name Smith + obituary → **Established**. `parent_of` edges materialize.
- H1 (child): obituary grandchildren → **Corroborated**; two `parent_of` edges to minors — **tagged `minor_identity`, restricted class**. Under `unrestricted` they're stored; the tag travels with them so any later policy can redact.
- Thomas Smith's death date **bounds every interval** on his node (truth-maintenance: `end ≤ 2022-11`).
- Timeline coherence check: married 2012 → apartment 2013 → house 2016 → daycare 2019 → grandchildren in 2022. No contradiction.
- Lead derivation from the new facts: Robert Doe is now ring 1 with a full name and DOB → slot "Robert's employer" (I5 wants household context) → **A13** LinkedIn via search dork, P:Low.

## Tick 9 — activities

**[connector]** Strava public profile "Jane D., Springfield": club *Springfield Road Runners*, activities. Athlinks search name + age band → "Abe's Amble 10K 2023, 42:10, **age 38**, Springfield".

**[graph]** Age 38 in 2023 ⇔ born 1985 — **matches DOB from an independent source** (race timing vs credit header) → DOB rises to B1. Race → `participated_in{date}`; club → `member_of`. The XC-coach edge from tick 4 and the running club **cohere** (a rule notes co-thematic edges; no action, just a coherence mark). Strava activity start clusters *would* leak home location — the graph declines to compute it: residence is already A1, so the marginal information is zero. **[log]** "Strava location inference skipped: I3 already established."

## Tick 10 — rings and restraint

**[graph]** Inner ring is no longer silent, so ring-2/3 expansion is *not* triggered by the FAN rule. But two cheap expected-record slots are still open:
- **A5** Judici → **no trace** → `slot(court) = searched_absent(Judici, "Doe, Jane M", 2026-08-30)`. A fact, queryable, refutes nothing (no hypothesis predicted a case).
- Voter → `not_obtainable(IL restricts public access)` — recorded with the *reason*, not guessed.
- **A13** Robert's employer → "Springfield Clinic, IT" (LinkedIn public view via search) — grade B3.
- Neighbours (ring 3): the graph runs **one** reverse-address lookup on Y Lane (cheap, cached): 6 households; prior owners "Harold & June Patterson, 1998–2016" → `preceded_by` edge. It does **not** expand the neighbours further: no indicator asks for them and their meta-path relevance to Q1 is near zero. **[log]** "neighbours recorded, not expanded: relevance to Q1 below floor."

## Tick 11 — review and stop

**[graph]** Stop check against Q1's criterion:
- indicators: I1 A1 · I2 A1 · I3 A1 · I4 B1 · I5 Established · I6 Established · I7 B2 (4 accounts) · I8 B2
- expected records: 14 slots — 11 found, 2 searched-absent (court, second phone), 1 not obtainable (voter)
- hypotheses: H1 Corroborated, H2 Established, H3 Established, "namesake is a different person" Established
- contradictions: none open · picture stable: last 3 actions added no ring-≤1 entity
→ **stop**. Spend: $1.40 + 1 Enformion credit. 27 actions raised, 22 run, 3 referred (low value), 2 pended.

**[LLM]** (third door) drafts the proof argument from the graph — every sentence cites claim IDs; a second, context-isolated pass is asked only "does the evidence support each sentence?" and flags one overreach ("she coaches *the* cross-country team" → the page says *assistant* coach) which is corrected.

**What you see:** a dossier with grades on every line; a timeline 2011→2026; the research log including the nulls; and for any edge, "why did you look there?" answered by a join: Action → slot/hypothesis → rule/indicator → Question.

---

## The same machine on Person A (6 lines)

Question compiles with different indicators (career, funds, boards, investments). Expected-record lists light up different sources: **ADV/CRD** (hard key), EDGAR Form D, Crunchbase-class profiles, press. Hypotheses come from the same rule families ("Acorn Capital Management LP *manages* ACORN" — predicted: ADV lists the brand; SEC filings name the adviser). The *namesake* mechanism handles "Acorn" the brand vs the LP. Nothing in the code knows he's a VC — the Question and the expected-record table do.

---

## Hypotheses — first-class now, or later?

What they buy: (1) **ordering by diagnosticity** — the assessor lookup jumped the queue because it answered two questions at once; (2) **explicit uncertainty** — "Robert is spouse" stayed *supported* not *proven* after the deed, until the marriage record; (3) **a stop rule** — a hypothesis that is disproved closes its branch; (4) **honesty** — the dossier can say "H1 child: corroborated, not established" instead of asserting.

What they cost: schema (hypothesis, evidence links, attacks), rule authoring for predicted observations, and a scorer.

Proposal: **first-class in the schema from M1, but only two hypothesis kinds at first, both rule-generated** — *identity* ("mention X is entity Y") and *relation-kind* ("Robert is spouse | sibling | co-owner"). They arise naturally from resolution and from `related_to{unknown}` edges, their predicted observations are mechanical (a marriage record, a deed, an obituary clause), and they are exactly where investigations go wrong. Free-form hypotheses proposed by the LLM ("she moved for a job") come later, once we have real graphs to form them on.

---

## Graph ↔ LLM: who asks whom

Both directions, and neither sees everything:
- **The graph decides where to go** (gaps, diagnosticity, hard-key priority, rings, stop) — arithmetic over the whole graph, which an LLM cannot hold and would do worse, slower, dearer.
- **The graph asks the LLM** at three doors: read this text into claims; enumerate hypotheses and their expected observations for this node; judge this ambiguous pair. And a fourth, cheap and occasional: *"here are my top three next actions and why — anything you'd add or veto?"* — the answer enters the queue as a scored candidate, never as a command.
- **The LLM asks the graph** for a **subgraph**, never the graph: the ego-network of the focus at 2 hops, filtered to the Question's meta-paths, with grades — small enough to reason on, framed by the question. Sub-graphs are also what hypotheses are evaluated on and what the dossier is rendered from.

## Autonomy

Autonomous by default, as above: every action is *raised with a reason, run, and logged*; nothing waits for a click. Approve-mode remains a switch (the HOLMES "recommend, Action Manager decides" pattern) for when we're calibrating a new connector or a sensitive tier — not the default.
