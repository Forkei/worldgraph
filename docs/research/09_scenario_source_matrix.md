# Research 09 — Scenario → sources & pivots matrix (40 scenarios)

*Research agent report, 2026-08-30. Access: A=API · B=bulk · S=scrape · M=manual. Cost 0/$. Geo US/FR/G. Verified this session: INSEE deaths file bulk on data.gouv; DVF bulk but **no buyer/seller names**; PagesJaunes 403s non-browser fetches; CourtListener API still free (docs at wiki.free.law).*

## Recurring source clusters
- **People-search (US)**: TruePeopleSearch / FastPeopleSearch / Whitepages / Spokeo / BeenVerified — name → age, addresses, phones, relatives, associates. No FR equivalent; FR uses **PagesBlanches** (M) and 118 712 / annuaire inversé.
- **Local news**: US paper archives (newspapers.com $, GenealogyBank $, Google News archive); FR regional dailies (Ouest-France, La Voix du Nord, Le Progrès, Sud Ouest, Midi Libre, La Dépêche, Nice-Matin); Retronews/BnF pre-1950.
- **Obituaries**: Legacy.com, funeral homes (US); Libra Memoria, Dans Nos Coeurs, avis-de-deces.net, Carnet du Figaro (FR).
- **Genealogy**: FamilySearch (0), Ancestry ($), Geneanet (FR-strong), Filae ($), Find a Grave, BillionGraves.
- **Courts**: PACER / CourtListener-RECAP (A,0), UniCourt ($), state portals (NY eCourts, MD Case Search, FL clerks), Judyrecords (S); FR: Judilibre (anonymised), Pappers Justice, BODACC.
- **Property**: US assessor/recorder, Regrid/ATTOM ($), Zillow/Redfin; FR: DVF (no names) → **Service de publicité foncière** request (~€12/doc, names), cadastre, BAN, copropriété registre.
- **Social**: Facebook, Instagram, LinkedIn, X, TikTok, Strava, Reddit (A), YouTube (A), Google Maps reviews.
- **Username/email tools**: Sherlock / Maigret / WhatsMyName, Holehe, HIBP, Epieos, Google-account lookups.
- **Archives**: Wayback (A), archive.today, Common Crawl (B).

## The 34 scenarios (condensed; ⭐ = ordinary-person / local)
1. **Counterparty due diligence** — OpenCorporates · Infogreffe/Pappers/INPI · SoS · BODACC · courts · OpenSanctions · Sirene. Pivot: company→officers→other companies→shared addresses/agents→cases→news. Unfindable: bank balances, nominee-hidden UBO.
2. **Journalist on a politician** — FEC/OpenSecrets · HATVP · votes (Congress.gov / NosDéputés) · lobbying registers · property · courts · Wayback · family employers. Pivot: donors→employers→contracts→family. Unfindable: dark money, gifts.
3. **Opposition research** — §2 + old posts (Wayback, archive.today), yearbooks, liens, BODACC/bankruptcy, prior residences, speeches. Unfindable: sealed/expunged, medical.
4. **Shell company / AML** — OpenCorporates · ICIJ · Companies House PSC · Sirene/INPI · DE/WY/NM SoS · UBO registers still open · WHOIS history · Street View of registered address. Pivot: address→co-located entities→shared officers→WHOIS→email→person.
5. **Missing person** ⭐ — NamUs · friends' social (last posts, tags) · Strava/Garmin · Venmo · local FB groups · people-search · protective orders/evictions · jail & hospital rosters · local news; FR: préfecture avis, "Disparu" groups, INSEE deaths (decisive). Unfindable: phone location, card use — police only; **the tool must say so**.
6. **Self-audit** ⭐ — dorks · people-search · HIBP/Dehashed · Maigret · Epieos · Wayback · reverse image · property/DVF · FR: PagesBlanches, Geneanet, Copains d'avant, societe.com · salary DBs · race results. Pivot: name→handles→emails→breaches→photos→addresses→relatives (who leak your address).
7. **Genealogy / lost relative** ⭐ — FamilySearch · Geneanet · Filae · **INSEE deaths** · **archives départementales** (>75y) · Find a Grave · obituaries · SSDI/census · manifests · people-search (living) · PagesBlanches. Pivot: deceased→obituary survivors→living names→people-search→city→social. Unfindable: FR births <75y, adoption, unlisted FR addresses.
8. **Academic collaboration** — OpenAlex · ORCID · Semantic Scholar · Crossref · HAL · theses.fr · NIH/NSF · ANR/CORDIS.
9. **Supply chain** — ImportGenius/Panjiva ($ bills of lading) · UFLPA/OFAC/BIS · SAM.gov · BOAMP/PLACE · Sayari ($$). Unfindable: tier-2+ suppliers.
10. **Real-estate ownership** ⭐ — US assessor/recorder · Regrid · Zillow history · people-search "address" tab (prior occupants) · Street View timeline · permits · LLC→SoS; FR: DVF → SPF (names) · cadastre · PagesBlanches by address · PLU/permis in bulletins · listing archives · copropriété registre. Unfindable: FR owner names without SPF; trust/LLC beneficiaries.
11. **Threat-actor attribution** — VirusTotal · Shodan/Censys · passive DNS · WHOIS history · GitHub · forum archives · crypto explorers · Maigret · PGP keyservers. Pivot: handle→email→WHOIS→domain→IP→GitHub commits→name.
12. **Art provenance** — Art Loss Register · Getty Provenance Index · auction archives (Christie's/Sotheby's/Drouot/Interencheres) · Lost Art · probate inventories.
13. **Nonprofit funding** — ProPublica 990 · Candid · USAspending; FR: JOAFL, data.gouv subventions, mairie délibérations. Unfindable: US Schedule B donors.
14. **Procurement corruption** — USAspending/FPDS/SAM · checkbook portals · **BOAMP/PLACE/DECP** · TED · registries→officers · campaign finance/HATVP · council minutes · Chambre régionale des comptes. Pivot: award→vendor→officers→relatives→officials (name match)→donations.
15. **Crypto → person** — Etherscan/Blockchair · Arkham/Nansen labels · ENS/Lens · OpenSea · bios with addresses · GitHub · OFAC wallets.
16. **Influencer / brand** ⭐ — #ad posts · ARPP certificate (FR) · Linktree · agency rosters + Wayback · affiliate link IDs · LTK/ShopMy · creator's LLC/SASU on Pappers · Social Blade. Pivot: handle→link-in-bio→affiliate IDs→brand→agency→stablemates; handle→company→address.
17. **Litigation history of a person** ⭐ — CourtListener/RECAP · PACER · UniCourt · state portals · county indexes · Judyrecords · bankruptcy · NSOPW · DOC locators; FR: Judilibre useless for names, Pappers Justice (commercial), BODACC, **local press is the only named criminal source**; casier judiciaire NOT public. Pivot: name+DOB/middle→portal→parties→attorneys→co-defendants→addresses in filings.
18. **Event attendance** ⭐ — Eventbrite/Meetup/Luma lists · agenda/speaker pages + Wayback · IG location/hashtag feeds · FB "going" · race results (Athlinks, RunSignup, Chronorace, athle.fr, Strava segments) · photographer galleries · news captions · club bulletins. Pivot: event→hashtag→posters→tagged people→their other events; race→bib→name→club.
19. **Dating-safety** ⭐ — reverse image · people-search (age, co-residents = marital) · courts (protective orders, DV, divorce) · NSOPW · LinkedIn job check · phone reverse · username tools · marriage/divorce indexes · Maps reviews · romance-scam DBs. Unfindable: FR criminal record; current relationship status.
20. **Landlord / tenant** ⭐ — recorder→LLC→SoS · eviction dockets · Eviction Lab · 311/code-violation portals (NYC HPD, Chicago) · reviews · JustFix "Who Owns What"; FR: copropriété registre, DVF, **Pappers for SCI (officers = landlords)**, local press. Pivot: address→LLC/SCI→officers→other buildings→violations.
21. **Corporate interlocks** — DEF 14A · OpenCorporates · Pappers · BoardEx ($$$) · Wikidata.
22. **Sanctions / PEP** — OpenSanctions · OFAC · EU/UK/UN · HATVP · Wikidata positions · GDELT adverse media. Pivot: name variants/transliterations→DOB→relatives (RCA)→companies.
23. **Sports careers** ⭐ — Athlinks · RunSignup/UltraSignup · **athle.fr** · Chronorace/KMS/Protiming/Sportips · Strava · MaxPreps/Hudl · federation licence lookups · college rosters + Wayback · FIDE/USCF/FFE. Pivot: name→results (age band, town!)→club→teammates→Strava→routes near home.
24. **Medical practitioner** ⭐ — NPPES NPI · state boards · OpenPayments · OIG exclusions · courts · Healthgrades; FR: annuaire.sante.fr / **RPPS on data.gouv** · Ordre · **Transparence Santé (industry payments)** · Ameli · Doctolib. Unfindable: NPDB, most FR disciplinary outcomes.
25. **Local government** ⭐ — city/county sites · Legistar API / BoardDocs minutes · salary DBs · county campaign finance · assessor · local news · FB groups; FR: **Répertoire National des Élus** · bulletin municipal / PV de conseil · HATVP (>20k) · JORF · BOAMP/DECP local · Pappers for élus' companies/SCIs · JOAFL associations chaired by councillors. Pivot: office→holder→company→contracts→family (name-match same commune)→property.
26. **Religious / club** ⭐ — parish bulletins (PDF) · messes.info · Rotary/Lions/Kiwanis rosters · lodge lists · Elks/K of C · **JOAFL** · FB groups · Meetup · alumni associations. Pivot: person→bulletin→role→co-officers→other associations (JOAFL name search).
27. **Military** ⭐ — NARA (<62y restricted) · SCRA lookup · Together We Served · VA gravesite · unit FB groups · DVIDS photos · obituaries · Fold3; FR: Mémoire des Hommes · **JO décorations** · Base Léonore · SHD · anciens combattants associations.
28. **Immigration** — H-1B/LCA/PERM disclosure data · EOIR · naturalisation indexes · **JO naturalisations (FR)**.
29. **Vehicles / vessels / aircraft** ⭐ — FAA registry · DGAC registre · USCG documentation · Equasis (>100GT) · ADS-B Exchange · plates: closed both countries (NYC parking tickets open data, dealer listing archives, histovec needs owner data). Unfindable: plate→owner legally.
30. **IP portfolios** — PatentsView · Google Patents · Espacenet/INPI · WIPO Brand DB · TSDR · EUIPO.
31. **Disinformation networks** — X/Telegram/TikTok · Wayback · WHOIS/DNS history · **Google Analytics/AdSense ID matching** (Wayback + BuiltWith) · shared images · EUvsDisinfo/DFRLab.
32. **Probate / guardianship** — county probate dockets · wills indexes · obituaries · assessor transfers; FR: notarial acts not public, JO successions vacantes, Geneanet, avis de décès; tutelles closed.
33. **Career history of an ordinary person** ⭐ — LinkedIn + Wayback · résumé PDFs via dork · company staff pages via Wayback · salary DBs · Pappers/Infogreffe mandates (even SASU) · **JORF** (civil-service nominations, concours results) · annuaire éducation + school sites · conference bios · alumni notes · Copains d'avant · Les Echos Nominations · GitHub/Behance. Pivot: name→LinkedIn→employer→Wayback team page→colleagues→next employer.
34. **Insurance fraud** — courts · social activity vs claimed injury · property · registries (staged-accident rings share addresses) · fire-department news.

## Owner-specific scenarios
- **O1 Random middle-school teacher** ⭐ — US: state licence lookup (all 50) · district payroll DBs · staff directory + Wayback · board minutes (BoardDocs) · RateMyTeachers/Niche · PTA newsletters · yearbooks · people-search · FB parent groups · race results/Strava · **DonorsChoose** · **TeachersPayTeachers store (handle!)** · local news. FR: collège "équipe pédagogique" · **JORF CAPES/agrégation lists (concours year, discipline, académie)** · bulletins académiques/mutations · ENT public pages · mairie bulletin · Copains d'avant · PagesBlanches · JOAFL · athle.fr · Geneanet. Pivot: name+school→licence/JORF→salary band→address→relatives→handles (TpT, Strava, IG)→timeline. Unfindable: evaluations, disciplinary files, FR salary (échelon only), FR home address if unlisted.
- **O2 Neighbors at an address + who lived there before** ⭐ — US: people-search "address"/"neighbors" tabs (best single source) · chain of title · voter files (OH/FL/NC bulk) · historical city directories · Street View history · obituaries "of [street]" · permits. FR: PagesBlanches by address · DVF sale dates (occupancy changes) · SPF (names) · syndic · **recensements nominatifs >75y street-by-street** · listes électorales (consultable in mairie, not online) · Geneanet lieux · avis de décès · listing archives. Unfindable: FR renters, unlisted, minors.
- **O3 Timeline from social posts** ⭐ — post timestamps/geotags/tags · Strava/Garmin GPS+time · Maps reviews · Untappd/Letterboxd/Goodreads/Spotify · LinkedIn dates · Wayback · EXIF (Flickr keeps it) · YouTube upload dates · Reddit mirrors · race results. Pivot: handle→all platforms→per-post (time, place, co-tagged)→merge→co-tagged people's posts for the same dates.
- **O4 Every account tied to a username / email / phone** ⭐ — Sherlock/Maigret/WhatsMyName · Holehe + Epieos · HIBP/Dehashed/IntelX (email↔username↔phone reuse) · Gravatar · Google account ID/Maps · Keybase, GitHub commit emails · Steam/Discord ID · phone: Truecaller/Sync.me, WhatsApp/Telegram/Signal probes, people-search reverse (US), annuaire inversé (FR landlines) · WHOIS history · Pastebin/Doxbin mirrors. Pivot loop: username→sites→bio→email→breaches→other usernames/phones→Gravatar→real name→people-search→loop.
- **O5 Small-town power structure** ⭐ — US: city/county site · Legistar/BoardDocs · assessor bulk (top landowners) · SoS by city · 990s by ZIP · chamber directory · local paper + obituaries (family ties) · salary DB · county campaign finance · FB groups. FR: **RNE** · mairie site/bulletin/PV · DVF + SPF top parcels · **Pappers by commune (all companies + dirigeants + SCIs)** · **JOAFL by commune (every association + président)** · messes.info · HATVP · BOAMP/DECP · avis de décès · Geneanet (old families) · athle.fr/FFF clubs. **Surname clustering is the killer technique in small towns.**
- **O6 Who was at this event / race** ⭐ — timing sites (full name, age, city, club, bib) · agenda + speaker pages + Wayback · Sched/Whova · Eventbrite/Luma/Meetup · hashtag/location scraping · **bib-tagged photo galleries (MarathonFoto, Sportograf, FinisherPix)** · FB event lists · Strava segment leaderboards for the race date · livestream chats · exhibitor PDFs. Pivot: event→results/agenda→names→city+age→people-search/PagesBlanches→Strava→co-attendees.

## Cross-scenario source frequency → connector priority
| Rank | Source / connector | Scenarios /40 | Access | Notes |
|---|---|---|---|---|
| 1 | Social platforms (FB/IG/LinkedIn/X/TikTok) | 30 | M/S | headless browser + session; LinkedIn is the career backbone |
| 2 | Local news + obituaries | 24 | S | obituaries = free relative graph |
| 3 | Wayback / archive.today | 22 | A | auto-archive and diff every profile/site |
| 4 | Court portals (CourtListener, state; FR BODACC/Pappers Justice) | 20 | A/M | FR names only via BODACC/press |
| 5 | US people-search / FR PagesBlanches | 19 | S/M | US: address+relatives; FR: listed phone only |
| 6 | Company registries (OpenCorporates, SoS, Pappers/Sirene/INPI) | 19 | A | Pappers is the FR workhorse (SCIs, SASU side gigs) |
| 7 | Property (assessor/recorder; DVF + SPF + cadastre) | 15 | M/B | DVF has no names — plan the SPF paid step |
| 8 | Username/email tools (Maigret/Holehe/Epieos/HIBP) | 14 | S/A | core of the pivot engine |
| 9 | Race results / federation DBs | 12 | S | name+age+city+club for ordinary people |
| 10 | Government gazettes (JORF/JOAFL, BOAMP/DECP, Federal Register, RNE, HATVP) | 12 | A/B | the FR JO family is hugely underrated |
| 11 | Genealogy stack (FamilySearch, Geneanet, INSEE deaths, archives dép., Find a Grave) | 11 | A/B/M | bulk-load INSEE deaths once |
| 12 | Meeting minutes / bulletins (Legistar, BoardDocs, bulletin municipal, PV, PTA, parish) | 10 | S (PDF) | needs a PDF + NER pipeline |
| 13 | Public-salary / licence lookups | 9 | B/M | per-state adapters |
| 14 | Reverse image | 8 | M/$ | |
| 15 | Sanctions/PEP (OpenSanctions) | 7 | A | cheap to always run |
| 16 | Domain/WHOIS/DNS history | 7 | A$ | |
| 17 | Campaign finance | 6 | A | |
| 18 | Google Maps reviews / Street View | 6 | M/S | timeline + neighbourhood |
| 19 | Academic | 3 | A | |
| 20 | Blockchain explorers | 2 | A | |

## Pivot-technique frequency → planner priority
| Rank | Pivot | Scenarios | Why |
|---|---|---|---|
| 1 | **name (+city/age) → social / LinkedIn** | 34 | universal entry; disambiguate by city+age from results/people-search |
| 2 | **person → relatives / household** (obits, people-search, co-residence, surname clustering) | 26 | ordinary people are found through family; small towns are surname networks |
| 3 | **address → occupants (current/past) → owners → entities** | 20 | the hinge between physical and corporate worlds |
| 4 | **person ↔ company officer (registry name match)** | 20 | side businesses, SCIs, landlord roles |
| 5 | **username → platforms → email → breaches → more usernames** (loop) | 18 | the only fully automatable pivot |
| 6 | **person → court parties → co-parties, attorneys, addresses in filings** | 17 | filings leak addresses, employers, relatives |
| 7 | **event/race/meeting → participants → co-membership** | 15 | dense co-attendance edges for local networks |
| 8 | **Wayback snapshot diff → former roles, deleted posts, old addresses** | 15 | the time dimension for every other pivot |
| 9 | **photo → reverse image → other accounts / co-appearances** | 11 | |
| 10 | **role/office/licence → gazette → seniority, discipline, nominations** | 11 | FR civil servants / teachers / doctors are gazette-visible |
| 11 | **money edge → counterparty** | 10 | |
| 12 | **phone → name/address** | 7 | strong US, weak FR (mobiles) |
| 13 | **domain / tracker ID → sister sites → registrant** | 6 | |
| 14 | **deceased → INSEE/SSDI → birthplace → archives → living descendants** | 5 | |

## Planner takeaways
(a) Build the pivot loop {name, username, email, phone, address, photo} as a first-class cycle with per-country weights (FR: phone/address weak, gazettes/registries strong; US: people-search/courts strong). (b) A **PDF-ingest + entity-extraction connector** (minutes, bulletins, race results, parish newsletters, JO) covers more ordinary-people scenarios than any single API. (c) **Bulk-load once**: INSEE deaths, DVF, Sirene, RNE, JOAFL, OpenSanctions, NPI/RPPS, FEC, voter files where legal. (d) **Hard-code "unfindable" declarations per country** (FR criminal records, FR plates, FR owner names without SPF, US sealed/family courts, phone location, bank data) so the tool refuses honestly instead of hallucinating.
