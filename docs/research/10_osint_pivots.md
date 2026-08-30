# Research 10 — OSINT pivot catalog (the craft, as executable rules)

*Research agent report, 2026-08-30. Rule format: INPUT → OUTPUT | technique | traps | cost | legality tier | graph product. Tiers: **L0** public web/search; **L1** public records/open data; **L2** commercial aggregators (paid, ToS restricts automation); **L3** touches a platform's auth/recovery endpoints (passive but grey); **L4** prohibited (facial recognition, breach *content*, credential use). Cost: ¢ free · $ metered · $$ subscription/heavy human time. Sources fetched this session are listed at the end; items marked "practitioner-standard" could not be re-verified (site blocked).*

## 1. Name pivots
| Rule | Technique | Traps |
|---|---|---|
| Name+City → mentions | `"First Last" "City"` · `"First Last" ("Employer" OR "School")` · `"Last, First"` · `"F. Last"` | common-name explosion; always attach ≥ 1 disambiguator; grade C3 until corroborated |
| Name → variants | diminutives (Bob/Robert), initials, hyphenated/maiden↔married (check obituaries/wedding notices for "née"), diacritics both ways, name order (`NOM Prénom` in FR docs) | each variant is a query fan-out, not a new entity — merge under one candidate with `alias` |
| Name → social | `site:linkedin.com/in`, `site:facebook.com`, `site:instagram.com`, `site:x.com`, `site:tiktok.com/@`, `site:*.edu OR site:*.k12.*.us` + `"First Last"` | LinkedIn stale; vanity slug = **username candidate** |
| Name → address/phone | `"First Last" intext:"Main St"` · `"First Last" "555-"` | `intext:` reliable; `AROUND(n)` unreliable |
| Name → documents | `"First Last" filetype:pdf (minutes OR roster OR newsletter OR agenda)` · `site:*.gov "First Last" filetype:pdf` | PDFs (rosters, minutes, race results, bulletins) are high-value and often hold phone/email/address. `cache:` is dead → Wayback / archive.today |
| Name → local news | `"First Last" site:<localpaper>` · `"First Last" (obituary OR "survived by" OR wedding OR engaged)` | obituaries = richest relative source |
| Common-name disambiguation | require **two independent attributes co-occurring in one document** (name+employer, name+city+age band, name+middle initial) before merging | "same name, different person" is the #1 false-merge cause |

## 2. Username pivots
- **Username → accounts**: WhatsMyName (700+ sites, JSON with `uri_check`, `e_string`, `m_string` — best precision) · **Maigret** (3,000+ sites, extracts profile info, **recurses on newly found IDs**, exports JSON/CSV/Neo4j) · Sherlock (400+). Trap: common handles (`jsmith`) → grade each hit D3 until avatar/bio/location corroborates. ¢, L0.
- **Name/email → username candidates**: `first.last`, `flast`, `firstl`, `first_last`, `first+birthyear`, `lastfirst`; vanity slugs; local-part of any known email. ≤ 10 candidates; prune 0-hit ones.
- **Avatar reuse** → reverse image (Yandex > Bing > Google; TinEye exact only). Pixel/near-dup matching only — **never face ID**.
- **Bio-link chains** (Linktree/beacons): follow one hop. High yield, ¢, L0 → `owns(Account)`.
- **Gaming/chat IDs**: `steamcommunity.com/id/<handle>` → SteamID64 (hard key; profile often lists real name, location, friends). Discord needs ID not handle.
- **Email → Gravatar**: lowercase, SHA-256 (legacy MD5) → `gravatar.com/avatar/<hash>?d=404`, `gravatar.com/<hash>.json`. ¢, L0, fully automatable.
- **Email → Google account** (GHunt/Epieos): Gaia ID (hard key), profile photo, **Maps contributions (reviews/photos with dates and places)**, YouTube, public Calendar. Needs an authenticated Google cookie → **L3**. Best location+timeline leak.
- Email/phone → Skype/Microsoft/Apple presence: L3, existence + display name only; don't automate against Apple.

## 3. Email pivots
- **Holehe**: 120+ sites via registration/reset endpoints **without notifying the target**; returns existence + masked hints (`ex****e@gmail.com`, `0*******78`) → constraints for later verification. L3, ¢, semi-auto (rate limits, false positives).
- **Employer → pattern → email**: Hunter (domain format + confidence; free 50/mo) or infer from 2 colleague emails found in PDFs/press. Never "verify" by sending mail.
- **HIBP** `/breachedaccount/{email}`: breach names + data classes, never passwords. $, L1. Breach names leak interests/era. Breach *content* = L4.
- **PGP / GitHub**: keys.openpgp.org search by email; `api.github.com/search/commits?q=author-email:`; `.patch` views expose author emails. L0, ¢, automatable.
- **WHOIS history** by registrant email (pre-2018 rich). L2 $.
- **Public Calendar / Drive**: `calendar.google.com/calendar/embed?src=<email>`. Rare, decisive.
- **Social recovery hints** (masked phone/email): L3, manual only, confirmation use.

## 4. Phone pivots
- Parse (libphonenumber, offline) → carrier/line type (Twilio Lookup/numverify $) — burner vs mobile.
- **Number → name**: US people-search, Sync.me/Truecaller (crowdsourced — nicknames as saved by others; grade C); FR annuaire inversé (fixed lines; mobiles/liste rouge absent). L2/L1.
- **Messenger presence + photo**: `wa.me/<number>` / contact add → WhatsApp photo & about; Telegram username/photo; Signal registration only. L3, manual, sock-puppet device.
- Payment handles: Venmo/Cash App/PayPal in-app search (L3); `cash.app/$tag` pages public (L0).
- **Number → documents**: all formats (`555-123-4567` / `(555) 123-4567` / FR `06 12 34 56 78` / `+33612345678`) + `filetype:pdf`; classified-ad reuse links numbers to items and cities. L0.

## 5. Address pivots
- **Address → residents / prior residents / neighbors**: US people-search reverse-address; "associates" there = shared address/phone over time, often **former roommates or landlords**, not relatives → C3. Household = shared address in ≥ 2 sources.
- **Address → owner → co-owner**: county assessor/recorder (deeds, mortgages list co-borrowers); FR: cadastre public but owner names need a *relevé de propriété* (offline); DVF = price/date/parcel per mutation, no names, excludes Alsace-Moselle. L1. Sale dates feed the timeline.
- **Imagery**: Street View history slider (dated), Zillow/Redfin listing photos (interior + sale history), Bing Birds-Eye. Manual: cars, plates, family size.
- **Community**: Nextdoor (local account), HOA minutes (`site:` + `filetype:pdf`), building/solar permits (owner + contractor + date), voter file (state-dependent).
- **Short-term rental**: Airbnb/VRBO around coordinates, match exterior photos → host profile → name/photo/other listings.
- **FR name → address**: Pages Blanches (opt-out common; mobile-only households absent). L1, automatable by fetch.

## 6. Photo pivots (no facial recognition)
- **Reuse**: Yandex, Bing, Google Lens, TinEye; **crop to the distinctive object**, upscale ≥ 200 px, **blur faces** so engines match background/logos/architecture. Weak outside EU/US/RU. L0, semi-auto.
- **EXIF**: exiftool; GPS/time survive only on originals/direct uploads (Flickr keeps it; social strips). ¢, automatable.
- **Geolocation** (Bellingcat method): landmarks, signage language/phone prefixes, road geometry, then satellite/Street View; verify by a second feature. **Chronolocation**: shadow direction/length via SunCalc. Manual; LLM pre-extracts text/signage.
- **Identity via objects**: race bibs → results sites (bib + event = name, age, city); uniforms/badges → employer; jerseys → club rosters; plates → region only.

## 7. Employer / affiliation pivots
- Employer → staff directory → colleagues (`colleague_of`); co-mentions in press add weight.
- LinkedIn "People also viewed" → weak `associated_with` (L3 if scraped).
- School district / municipal minutes: `site:*.k12.*.us OR site:*.gov filetype:pdf "First Last"` → hiring lists, salaries, resignations (dated). FR: bulletins municipaux, académie sites.
- Conference programs, newsletters, press releases, alumni magazines (class year → birth-year band).
- Salary databases (exact employer + title + year). L1.
- **Professional licences** (teacher cert, Nursys, bar, real estate, NPI; FR RPPS, ordre des avocats, sports federations): **licence number = hard key (A1-class)**. L1, automatable.
- **FR side businesses**: societe.com "Un dirigeant ?" → mandates, companies, **birth month/year**, siège. Journal Officiel: décorations, associations (JOAFE), name changes. L1.

## 8. Relative / social pivots
- **Obituaries**: parse "survived by / preceded in death by" → `parent_of`, `spouse_of`, `sibling_of`, grandchildren, cities, married names ("née"). Grade B2. Query `"Last" obituary "City" ("survived by")`.
- Wedding/engagement/birth announcements; marriage indexes → `spouse_of{date}`.
- People-search "relatives/associates": same surname + same address ≈ reliable; "associates" ≈ noise. C3, L2.
- Facebook public friends / tagged photos; **Instagram follower-list intersection of two candidates = strong `knows`**. L3 if automated.
- Shared address → household (same period, ≥ 2 sources).
- Genealogy: Geneanet/Ancestry/FamilySearch trees, Find a Grave (links spouses/parents/children), **INSEE deaths file** (name, sex, birth date/place, death date/place, 1970→, monthly) — birth commune = geographic anchor. L1, bulk + local index.
- Venmo public transactions, GoFundMe organizers/beneficiaries → `transacted_with`, `organized_for`. L0.

## 9. Timeline reconstruction
Every fact carries `observed_at` + `valid_from/to`. Reliable dates: Wayback CDX (`web.archive.org/cdx/search/cdx?url=…&output=json`), post timestamps, EXIF, Strava/Garmin, Maps review dates, event/race results, dockets, DVF/assessor sale dates, LinkedIn job dates (self-reported, C), press (B). **Date inconsistency is itself a same-name-different-person signal.**

## 10. Location pivots
- **Strava**: public activities, segment leaderboards, global heatmap → routine start/end clusters = home even with privacy zones. Segment near suspected area → leaderboard → profiles → activity maps. L0/L3, semi-auto.
- **Maps Local Guide contributions** (from Gaia ID): reviewed places cluster around home/work; photos carry dates. L3.
- Geotagged posts, Instagram location pages (partly public), Facebook check-ins, Snap Map, Flickr geotags (API, L0), Swarm, Untappd.
- Event pages: Eventbrite/Meetup attendees, race results (name+city+age public in nearly all running/tri results) → `attended(Event, date, city)`.

## 11. Verification & confidence
- **Triangulation**: confirmed only with 2 *independent* sources — **all US people-search sites count as one** (same credit-header feed).
- **Primary > secondary > tertiary**: registry/licence board/employer page/self-published (primary) > aggregator/news > forum/crowdsourced name.
- **Same-name checks**: age band, middle initial, city history, employer, spouse must not conflict; conflict → split.
- **Loop consistency**: phone → name → address → reverse address includes same name = closed loop = strong.
- **Admiralty code**: source A (official registry/licence/INSEE) · B (employer site, newspaper, self-authored profile) · C (people-search, Truecaller) · D (anonymous forum) · F (unknown) × info 1 (independently confirmed) · 2 (consistent, single good source) · 3 (plausible, single weak) · 4–5 (doubtful/contradicted). Suggested grades: **Gold** A1/A2/B1 · **Silver** B2/C1/C2 · **Bronze** C3/D3 · **Lead** 4–6 (keep, never auto-pivot from).

## 12. Search-engine craft
- Reliable operators: `""`, `-`, `OR`, `*`, `site:`, `inurl:`, `intitle:`, `intext:`, `filetype:`/`ext:`, `before:`/`after:`. Unreliable: `AROUND(n)`, `daterange:`, `loc:`. Dead: `link:`, `+`, `~`, `phonebook:`, `cache:`.
- Engines: Google (deepest; `&num=100&filter=0&pws=0`; caps ~300–400 results) · Bing (different crawl; `contains:pdf`, `inbody:`, `ip:`) · Yandex (best reverse image, EU/RU content) · DuckDuckGo (Bing index, `region:`, no personalization) · Brave/Mojeek (independent indexes).
- Expansion: seed × name variants × disambiguators × engines; dedupe by URL; **stop a branch when two consecutive expansions add 0 new URLs**.
- SERP APIs (SerpAPI, Serper) needed beyond a few dozen queries/hour. Google Alerts / Talkwalker for monitoring (free).

## 13. France-specific craft
Pages Blanches (name→address/phone) · annuaire inversé (fixed lines) · **Geneanet surname pages: geographic distribution by département and period — surname geography as a disambiguator and birth-region prior** · INSEE deaths · archives départementales (>75–100y, manual) · avis de décès · bulletins municipaux (`site:<commune>.fr filetype:pdf "Nom"`) · federation results (club, age category) · Copains d'avant (school + years) · societe.com dirigeants (birth month/year, siège) · Journal Officiel (décorations, associations) · annuaire santé/Doctolib (RPPS) · DVF + cadastre. GDPR: public directories/open data are L1; aggregation for a private investigation still creates a processing record — **purpose logging on every node**.

---

## (a) Ordered playbook from Name + City / Name + Employer
1. **Normalize & expand** name (variants, diacritics, initials); attach the known disambiguator.
2. **Anchor search** (L0): exact-phrase + disambiguator across Google/Bing/DDG + `filetype:pdf`. Goal: one document co-locating name with a second attribute.
3. **Employer/affiliation branch**: staff page, licence lookup, minutes/press → role, **email pattern**, colleagues.
4. **Social anchor**: LinkedIn/Facebook/Instagram via `site:`; harvest **username slugs** and **avatar**.
5. **Username enumeration** (WMN/Maigret); reverse-image avatars; bio-link chains.
6. **Email**: pattern → Gravatar → GHunt/Epieos (Gaia ID, Maps) → Holehe (services + masked hints) → HIBP → GitHub/PGP.
7. **Phone**: documents/ads/recovery hints → carrier type → reverse directories → messenger photo.
8. **Address & household**: reverse address (US) / Pages Blanches (FR) → property records → co-owners; Street View.
9. **Relatives**: obituaries first, then announcements, genealogy, INSEE.
10. **Location/timeline**: Maps reviews, Strava, event results, Wayback → dated place list.
11. **Verify**: close loops, split on conflicts, grade every edge; **re-run 2–5 on every new hard key** (licence #, Gaia ID, SteamID, email).

(Matches Bazzell's chapter order Email → Usernames → Telephone + Methodology; IntelTechniques tool categories; Trace Labs' escalation basic info → employment → friends/family → last-seen.)

## (b) Stop conditions & dead-end heuristics
- **Name too common**: > ~5 distinct same-name candidates with no disambiguator hit in 2 pages → stop name search; pivot to attribute-first (directory, licence board, results) for a hard key.
- **Zero-delta rule**: a pivot adding no new URL/entity after 2 expansions is closed for this seed.
- **Weak-key ban**: never auto-pivot from a Bronze/Lead edge; human promotion required.
- **Loop-closure stop**: phone↔address↔name↔employer closed with ≥ 2 primary sources = identity resolved; further expansion is enrichment, budgeted separately.
- **Contradiction stop**: hard-key conflict (two birth years, two licence numbers) halts merging, forks the candidate.
- **Cost stop**: paid lookups only after free L0/L1 branches are exhausted and the candidate is ≥ Silver.
- **Platform-signal stop**: anything that would notify the subject (mail, friend requests, calls) is out of scope; back off on 429.

## (c) Pivot → planner action map
| Pivot | Planner action | Cost | Tier | Auto |
|---|---|---|---|---|
| Name exact-phrase / dorks | `search(template, engine)` | ¢/$ | L0 | Full |
| filetype:pdf documents | `search` → `fetch(pdf)` → extract | ¢ | L0 | Full |
| Wayback/archive | `fetch(cdx)` → `fetch(snapshot)` | ¢ | L0 | Full |
| Username enumeration | `connector(whatsmyname|maigret)` | ¢ | L0 | Full (D3 until corroborated) |
| Gravatar | `fetch(hash)` | ¢ | L0 | Full |
| GHunt / Epieos | `connector(ghunt)` | ¢/$ | L3 | Semi (cookie; human review) |
| Holehe | `connector(holehe)` | ¢ | L3 | Semi (rate limits, FP review) |
| HIBP | `connector(hibp)` | $ | L1 | Full |
| GitHub/PGP | `fetch(api)` | ¢ | L0 | Full |
| Hunter pattern | `connector(hunter)` | $ | L2 | Full |
| Phone parse/carrier | `connector(libphonenumber, twilio)` | ¢/$ | L0/L1 | Full |
| Reverse phone/address (US aggregators) | `connector(people-search)` | $$ | L2 | Semi (single-source rule) |
| Pages Blanches / annuaire inversé | `fetch` | ¢ | L1 | Full |
| Messenger profile photo | manual task | — | L3 | Manual |
| Property / DVF / assessor | `fetch(portal)` | ¢ | L1 | Full |
| Street View / listing photos | `fetch(image)` + human | ¢ | L0 | Manual review |
| Reverse image | `connector(yandex|bing|tineye)` | ¢/$ | L0 | Semi |
| EXIF | `extract` | ¢ | L0 | Full |
| Geolocation / shadows | human + LLM pre-extraction | $$ | L0 | Manual |
| Staff directory / licence lookup | `fetch` → `expand(colleagues)` | ¢ | L1 | Full |
| Obituary parse | `search` → `fetch` → LLM relation extraction | ¢ | L0 | Semi |
| INSEE deaths | local index query | ¢ | L1 | Full |
| Strava / Maps location | `connector` + human | ¢ | L3 | Semi |
| Event/race results | `search` → `fetch` | ¢ | L0 | Full |
| Recovery-hint checks | manual task | — | L3 | Manual |
| Facial recognition | — | — | L4 | Forbidden |

## (d) Automation summary
**Fully automatable**: search templates, PDF harvest, Wayback, username enumeration, Gravatar, HIBP metadata, GitHub/PGP, phone parsing, FR directories, DVF/assessor, EXIF, licence lookups, INSEE, event results. **Semi (human check before promotion above Bronze)**: GHunt/Epieos, Holehe, people-search, reverse image, obituary relation extraction, Strava/Maps location inference. **Manual-only**: messenger/recovery probes, photo geolocation/chronolocation, Street View interpretation, anything needing a sock-puppet or that could alert the subject.

### Sources fetched
Bellingcat (sun & shadows; reverse image; beginner's geolocation) · GHunt · Holehe · Maigret · WhatsMyName · Sherlock · Admiralty code · SANS SEC497 · IntelTechniques tools + book · Ahrefs Google operators · OSINT Dojo · Nixintel · Sector035 · INSEE deaths (data.gouv) · DVF · HIBP API v3 · Gravatar hash docs · Hunter · societe.com. Blocked this session: Trace Labs, Epieos, Pages Jaunes/118712, Geneanet, Journal Officiel, cadastre.gouv.fr, annuaire.education.gouv.fr, OSINT Curious, Bellingcat Strava article.
