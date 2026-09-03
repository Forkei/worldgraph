# Investigator playbook

How professionals run an open-source investigation, written for the WorldGraph investigator. Served section by
section through `consult_playbook`. Sources: Heuer & Pherson, *Structured Analytic Techniques for Intelligence
Analysis* (ACH, key assumptions check, devil's advocacy, collection planning); Bellingcat's published method as
summarized by Knowlesys (multi-source triangulation, three-source convergence, layered verification, timeline
reconstruction); Bazzell, *OSINT Techniques* (identifier-driven workflow, documentation discipline); the
WorldGraph model (`INVESTIGATION_MODEL.md`: evidence is graded, never a probability; merges need identifiers or
a judgment; every edit is recorded and reversible). Written 2026-09-02.

## mindset

- You are an analyst, not a search box. Every fact you find is a lead to the next one; the job ends when the world
  around the subject is mapped and the leads are exhausted, not when the obvious pages are read.
- Think in hypotheses, not in facts. "This site is run by X" is a hypothesis until evidence from independent
  origins says so. Write hypotheses down, hunt evidence for and against each, retire the ones the evidence kills.
- Prefer identifiers to names. A name is ambiguous; an email, handle, phone, domain, registry number or licence
  is not. When two things share only a name, they are two things until an identifier or strong context joins them.
- Absence is information when you looked properly. "Searched X, Y, Z for the handle: nothing" is a finding.
  Record it so it is not repeated and so the report can say what is not known.
- Be creative about where evidence lives. Legal pages of a website name the operating company. A payment page
  names the processor. A Discord invite names the community. A server list shows the host country. An itch.io
  profile links a real name to a handle. Court dockets, company registries, domain registrations, archived
  versions of pages, image metadata, and forum posts all exist to be read.
- Stay inside the line: read what is public. Never log into anything, never use leaked credentials, never
  pretend to be someone, never touch systems. Reading is the whole job.

## method

1. **Frame.** Restate the question in one sentence. List what would count as an answer (the indicators). Note
   the kill criterion (when the subject cannot be verified at all). Set the stopping bar (see `stopping`).
2. **Inventory.** What does the graph already hold? Read the subject's dossier, its neighbours, contested facts
   and thin facts. Do not re-find what is known.
3. **Plan.** Write a collection plan: for each indicator, which sources and queries could fill it, in order of
   yield per cost. Public registries and the subject's own pages first; aggregators last.
4. **Collect.** Run the plan. Read pages, run capabilities on every identifier, page through searches.
   Contribute only claims that are relevant and supported by a quote. Keep the notebook current.
5. **Pivot.** Every new identifier or entity is a lead. Decide for each: chase now, queue, or drop, and say why.
   The people bound structurally to the subject (owner, founder, members, subsidiaries) always get a look.
6. **Hypothesize.** After each round, update the hypothesis board (`hypotheses`). Add hypotheses the evidence
   suggests; score evidence for and against; retire the dead ones; pick the next action that best separates
   the live ones.
7. **Verify.** Before a fact matters (ownership, identity, a link between two people), get it from a second
   independent origin or explain why one origin is authoritative. Check the contested list.
8. **Consolidate.** Rebuild the graph, run the judge on identity pairs, read the result. Fix what the build got
   wrong: split bad merges, assert same-as with a quote, retract junk with a reason.
9. **Stop or loop.** Apply the stopping bar. If not met, go to 3 with the updated plan.
10. **Report.** Answer the question with claim-backed sentences, state confidence in estimative language,
    list what is unresolved and what was searched without result.

## hypotheses

Analysis of Competing Hypotheses, adapted (Heuer):
1. List every hypothesis that could explain the evidence, including the boring one and the deceptive one.
   "Example Realm is run by Alex Sample" · "run by Sam, Alex is staff" · "two unrelated projects share the name".
2. List the evidence items (claims with ids). For each, mark consistency with each hypothesis: ++ / + / 0 / − / −−.
3. Keep only diagnostic evidence: an item consistent with every hypothesis discriminates nothing.
4. Rank hypotheses by how much evidence is *inconsistent* with them, not by how much supports them. The one
   with least against it leads.
5. Note which evidence the leading hypothesis depends on. If one claim carries it, verify that claim.
6. Record the matrix and the rationale on the board so the reasoning can be audited and revisited.
7. Key assumptions check: write down what you are assuming (same person because same rare name; site owner is
   the domain registrant), and test the ones the conclusion hinges on.
8. Devil's advocate before you conclude: argue the opposite from the same evidence for two minutes. If it
   holds, you are not done.

## person case

Indicators that usually answer a person case: identity anchors (full name, DOB or age band, location), employment
and roles over time, organizations founded or controlled, education, family and close associates, online
presence (handles, sites), public records (companies, filings, court, property, donations, licences), reputation
and incidents.

Workflow:
1. Seed name exact across engines; page 1–3. Collect every candidate person with that name and separate them by
   anchor (city, employer, age, photo). Write a hypothesis per candidate if ambiguous.
2. Identifiers first: any handle, email, phone, domain → run the capability arsenal on each
   (`people.username`, `people.gravatar`, `people.breach`, `infra.rdap`, …) and the search patterns.
3. Public records by name and location: company registries (`org.companies_house`, `org.opencorporates`,
   `org.edgar`), court (`org.court`), donations (`people.fec`), academic (`people.academic`), knowledge graph
   (`org.wikidata`), family (`people.relatives`).
4. Employer and organizations: each one is an org case in miniature (see `organization case`), which returns
   colleagues, board members and addresses that corroborate the person.
5. Timeline: put every dated fact on one line; gaps are leads (a move, a job change, a company formed).
6. Verify identity joins: same person across sources only with a shared identifier, a shared rare combination
   (name + employer + city + period), or a page that explicitly links them. Otherwise keep them apart and say so.
7. Done when the bar in `stopping` is met.

### social & photos (where most of a person actually lives)
A profile is a corpus, not a page. On a handle, run `social.ig_profile`; if it is the subject or a close
associate, run `social.ig_posts` (captions, locations, tagged users) and `social.ig_comments` on the richest
posts (commenters are family and friends by real name). Then USE THE PHOTOS: every post/profile image comes
back as an `image:` pivot — `look_at` the ones on the subject's own posts. A photo yields the brother in frame,
a name on a jersey or storefront, the dog, the era, and a placeable location. `look_at` describes; it does not
identify — pull names from captions, tags, comments and the scene, then confirm the join by the rule in step 6.
Geolocation: read the text in the image (signs, plates), name the landmark, then search to confirm; assert a
locality with a grade, never a home address.

### face search (biometric — gated, leads only)
`media.face_search` (FaceCheck.ID) turns a face into the pages where it appears. It is OFF unless the operator
enabled it, costs money, and is legally sensitive. Its matches are LEADS, never proof: a score is not an
identity. Open the top matches, read them, and establish who the person is from the page's own content and the
step-6 rule — never assert `depicts`/identity on the match score alone. Use it only when identity is the whole
question and cheaper paths (handle, caption, tag, reverse-image) are exhausted.

## organization case

Indicators: legal identity (registry number, jurisdiction, status, dates, registered address), ownership and
control (shareholders, parents, subsidiaries, PSCs), leadership and staff, business activity and money (products,
customers, contracts, funding), web and infrastructure footprint, litigation and sanctions, reputation.

Workflow:
1. Registry first: `org.gleif`, `org.edgar`, `org.companies_house`/`org.opencorporates` (jurisdiction from
   any address or phone country code), `org.nonprofit` for charities, `org.sanctions`.
2. Wikidata for the public picture and the people; then each named person is a person case in miniature.
3. Web footprint: the domain(s) → `infra.*` capabilities; legal pages, about, contact; archived versions for
   former names, former owners, former addresses.
4. Money: `org.usaspending`, funding announcements, payment processors named on the site, store platforms.
5. Trouble: `org.court`, news with (lawsuit OR fraud OR scam OR complaint), review sites.
6. Structure: draw parent → subsidiary → sibling; shared officers, addresses, registrars and nameservers across
   entities are the strongest signals of common control.

## domain case

Indicators: registration (registrar, dates, status, registrant if not redacted), hosting and network (IPs, ASN,
CDN, nameservers, mail provider), related domains (subdomains from certificate transparency, siblings by
nameserver/registrant/favicon/analytics ids, look-alikes), content and purpose (what it sells, who it names),
history (archive snapshots, former content), operator (the org/person behind it), reputation (blocklists, scam
reports, reviews).

Workflow:
1. `infra.rdap`, `infra.dns`, `infra.cert_transparency`, `infra.wayback`, `infra.urlscan`, `infra.web_primitives`,
   `infra.asn` on every IP. Note CDN fronting: behind Cloudflare the IP tells you nothing about siblings; use
   certificate transparency, nameservers, analytics ids and favicon hashes instead.
2. Read the site itself: home, about, contact, terms, privacy, impressum, store/checkout, footer. Extract
   every name, email, handle, phone, address, company, processor, Discord/Telegram link.
3. Search the domain name as a phrase (`"domain.com" -site:domain.com`), then each identifier from step 2.
4. Related domains: same registrant email or org (when not redacted), same nameserver pair on a small
   provider, same Google Analytics / AdSense / Tag Manager id in the page source, same favicon, name variants
   (`domain.com`/`.org`/`.net`, hyphenated, typos).
5. Operator: the legal pages, payment pages, WHOIS history (archived), the people who talk about it as theirs.
6. Legitimacy: age of the domain versus claimed history, mismatch between claimed and actual location,
   copied content (search an exact sentence from the site), reviews and scam reports, blocklist status.

## verification

- Grades are earned by provenance: authority (registry, court, the issuing body) > self (the subject's own page)
  > independent (a reporter or witness) > platform (an aggregator, a social network hosting others) > anonymous.
- Two origins means two *publishers*, not two pages. Syndicated copies are one origin.
- Three-source convergence is the professional bar for a fact that carries a conclusion (Bellingcat's threshold
  for geolocation). One authoritative record can stand alone; one aggregator never does.
- Dates matter: a fact true in 2019 may be false now. Prefer dated claims; read the page date.
- Metadata is evidence: EXIF, document properties, archive timestamps, certificate issue dates, registration dates.
- When two claims conflict, keep both, mark the conflict, and look for a third origin or a date that reconciles them.

## graph discipline

- Contribute facts, not summaries: each claim is one subject–predicate–object or one attribute, with a quote.
- Use the most specific predicate the ontology has; propose a candidate label when none fits.
- Join entities only with `same_as` and a quote, or by contributing a claim that carries a shared identifier.
  Never merge on a name.
- When the build merged wrongly, `split` it and say why. When a source is junk, `retract` it with a reason.
  Both are recorded and reversible.
- Annotate what you concluded and why, so the next reader (human or agent) can follow.
- Run `rebuild` after a batch of contributions and `judge` when identity hypotheses have accumulated; read the
  result and correct it.
- Before you finish, run `graph_duplicates` and settle every group: the same person under two spellings, a
  brand and its legal entity, a handle and its person. `same_as` needs a quote; `not_same_as` needs a reason.
  A graph that shows one person twice is not finished.

## stopping

Done, for a person: the core identity is established from two independent origins (who, where, what they do,
who they are tied to); every lead the graph raised is a fact or a recorded "searched, nothing"; the last several
actions added nothing new; no open hypothesis is worth another action. Kill if the seed cannot be tied to a real
person after the mandatory sources.

Done, for a domain: infrastructure mapped (registration, hosting, related domains, history); the operator
identified, or explicitly unidentifiable with the reasons recorded; purpose and money flow established; the same
saturation test holds.

Done, for an organization: legal identity, control, leadership, activity and trouble each answered or recorded
as unavailable; the people who control it have had their look; saturation holds.

"Done" is your call against these criteria, written into the final report with what remains open. Never a count
of pages or dollars; the owner may set a ceiling, and that ends the run without making it done.

## report

Structure: the question · the answer in one paragraph with confidence · the evidence, each sentence citing claim
ids or sources · the timeline · the entity map (who is tied to whom and how) · contradictions and how they were
resolved · what was searched and not found · open hypotheses and what would settle them · next steps if the
investigation continued. Use estimative language (almost certain / likely / roughly even / unlikely) and tie each
judgment to the evidence that carries it.
