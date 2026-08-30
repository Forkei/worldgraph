# Research 07 — Data-source catalog (free and paid), verified Aug 2026

*Research agent report, 2026-08-30. US + France focus; owner-operated; build budget ≤ $300/mo. Prices published unless ⚠ (third-party/unverified).*

## 1. Web discovery / search
- **Brave Search API** — $5/mo credit ≈ 1k queries, then **$5/1k**, 50 QPS. Storing results needs a separate storage-rights plan. Best general SERP; can't legally persist results on base plan. https://brave.com/search/api/
- **Bing Web/News/Visual Search** — retired Aug 2025; replacement returns LLM answers only. Skip.
- **Google Custom Search JSON** — closed to new customers, sunset 1 Jan 2027. Skip.
- **SerpAPI** — Google/Bing/DDG/Scholar/Lens/Yandex SERPs as JSON. 250 free/mo; **$25/1k → $10/1k → $5.90/1k**; "legal shield" on Production+. Google sued SerpApi (Dec 2025). Only practical way to get Google, Scholar, Lens. https://serpapi.com/pricing
- **Exa** — neural search + contents. $7/1k search, deep $12/1k, contents $1/1k pages; storable. Semantic "pages about X person + Y org". https://exa.ai/pricing
- **Tavily** — 1k free credits/mo; $8/1k PAYG → $5/1k. Storable. https://tavily.com/pricing
- **Firecrawl** — scrape/crawl/map → markdown + search. Free 1k credits; Hobby $16/mo (5k); Standard $83/mo (100k). The fetch layer for every scrape-only source. https://www.firecrawl.dev/pricing
- **Jina Reader** — `r.jina.ai/<url>`; 10M free tokens/key. Cheap fallback fetcher.
- **Common Crawl** — 2.1B pages/crawl, free WARC + CDX on S3; index API strictly rate-limited. Historical snapshots, domain→page enumeration at $0.
- **Wayback CDX / Availability** — free, ~60 req/min. Dated snapshots = temporal edges (who was on a team page when).
- **archive.today** — no API, CAPTCHA. Best-effort only.

## 2. People / profiles
Legal frame: none of these is an FCRA CRA; the FTC says *use* controls. CNIL fined Kaspr €240k (2025), Garante fined Lusha €2M (Aug 2026) for enrichment without a legal basis — keep a legitimate-interest assessment per investigation and an Art. 14 notice plan.
- **LinkedIn** — official APIs only for consenting members; hiQ ended in a consent judgment; Proxycurl shut down Jul 2025; ProAPIs settled Feb 2026. **Scrape-only and litigated; manual/verification source.**
- **Bright Data** — LinkedIn-derived datasets ~$2.50/1k records ($250 min), 5k free/mo; won Meta v. Bright Data on logged-out scraping; corporate KYC. Most legally insulated route to profile fields.
- **Pipl** — enterprise only, ~$0.10/query, $3k–130k/yr ⚠. **Ekata** — merchants only. **Spokeo / BeenVerified** — consumer subs ~$37/mo, no API.
- **TruePeopleSearch** — free US name/address/phone/relatives; scrape-only behind Cloudflare. Best free US "relatives + prior addresses"; grey.
- **EnformionGO (ex-Endato)** — US identity/addresses/phones/relatives; self-serve API, **100 free matches/mo, then $0.25/match**. Best PI-grade source an individual can buy. https://go.enformion.com/pricing/
- **Tracers / TLOxp / IDI / IRBsearch** — skip-trace gold standard; licensed business + permissible purpose required.
- **People Data Labs** — 3B profiles, 200+ countries; 100 free credits/mo, Pro ~$98/mo ≈ $0.28/record; prohibits FCRA uses. Best global person→employer→school enrichment for a solo dev.
- Apollo ($49–119/user/mo), RocketReach (API only ~$1,699/yr), Lusha (API from $69.90/mo), **Hunter.io** (free 50/mo; €34/mo 2k; API on all plans — domain→email pattern; worth wiring early), Clearbit→HubSpot Breeze, FullContact (quote).

## 3. Corporate / ownership
- **OpenCorporates** — 200M companies, 140 jurisdictions, officers. API from **£2,250/yr**; free keys for journalists/NGOs on application. Weak on shareholders.
- **SEC EDGAR** — free; 10 req/s with `User-Agent: name email`. Submissions JSON, full-text search (2001→), Form D (issuer + related persons), 13F, Forms 3/4, bulk. Officers/directors/insider/investor-network edges.
- **IAPD / Form ADV bulk** — free monthly CSV of all RIAs incl. owners (Schedule A/B), control persons, private funds. Fund→adviser→owner edges; better than BrokerCheck (ToS bans scraping).
- **GLEIF LEI** — free, 60/min; Level 2 parent/ultimate-parent; daily bulk.
- **UK Companies House** — free API (600 req/5 min); officers, **PSC register** (UBO gold standard); daily PSC snapshot.
- **France**: **INPI RNE** (free after INPI Connect; dirigeants, sièges, actes, comptes; bénéficiaires effectifs only via legitimate-interest request, no API) · **Infogreffe/DataInfogreffe** (Kbis €3.06; open-data API free tier; statuts reveal shareholders) · **INSEE Sirene** (free, 30/min, monthly bulk; no officers) · **API Recherche d'Entreprises** (free, no auth, 7 req/s, dirigeants) · **BODACC/JOAFE** (free Opendatasoft APIs, daily: dirigeant changes, cessions, insolvencies, association officers) · **Pappers** (API credits from ~€20/mo ⚠; fastest bulk French officers/BE) · **Societe.com API** (500 free credits).
- **EU BORIS/AMLD6** — 17/30 registers interconnected; PDF-per-query; from Nov 2026 registers must answer legitimate-interest requests in 12 working days.
- **FinCEN BOI** — permanently eliminated for US-formed companies (Aug 2026); never public.
- **US Secretaries of State** — no uniform API. FL Sunbiz free SFTP bulk; CO open-data API; DE/CA/NY/TX web-only (DE bans automation). Aggregators: Cobalt Intelligence (~$0.50–5/lookup ⚠), Middesk (enterprise).
- **OpenSanctions / yente** — PEPs, sanctions, ICIJ, crime lists in FollowTheMoney schema; free non-commercial bulk; commercial €0.10/match or self-host + licence. **Schema maps almost 1:1 onto ours.**
- **ICIJ Offshore Leaks** — 810k entities, officers, intermediaries; free CSV + Neo4j dumps (ODbL).
- Crunchbase (Enterprise ~$50k+/yr ⚠), PitchBook ($12–20k/seat ⚠), Dealroom (€12.5–17k/yr ⚠), Orbis (tens of $k), D&B Hoovers ($49/mo SMB). None viable under $300/mo.

## 4. Courts / legal
- **CourtListener / RECAP** — opinions, federal dockets/parties/attorneys, judges, financial disclosures; REST v4 + free quarterly bulk. Tiers (May 2026): free 125/day; $10/mo 300/day; $100/mo 1,400/day. Bulk is graph-ready party↔attorney↔judge.
- **PACER** — $0.10/page, $3/doc cap, free under $30/quarter; no API; use RECAP extension.
- Justia (web only, bot-blocked). State portals: NY eCourts/NYSCEF free (no API); re:SearchTX free; California fragmented and paid.
- UniCourt ($49–299/mo web; API ~$2,250/user/mo ⚠), another court-records vendor ($70–200/mo), judyrecords (770M cases free web; scraping prohibited).
- **DOJ press releases** — JSON/RSS, free. Indictment/settlement text naming people and companies.
- **France** — Légifrance (PISTE) free OAuth; **Judilibre** free — Cass. 2021→, CA 2022→, tribunaux de commerce 2024→, TJ 2025→; individuals pseudonymised, **companies named**.
- **EUR-Lex/CELLAR** — free SPARQL; sanctions regs, CJEU cases.

## 5. Government / public records
- **OpenFEC** — free key, 1,000/hr; contributor name/employer/occupation/address. Strongest free person↔employer↔PAC edges.
- **OpenSecrets** — API discontinued Apr 2025; bulk free non-commercial.
- **USAspending** — free, nightly; awardee↔agency↔parent↔subcontractor, exec compensation.
- **SAM.gov** — public key 10 req/day; use monthly extract + daily exclusions.
- **Property** — **Regrid** (free 25/day; Pro $10/mo 1,000/day; API $375/mo) cheapest owner-mailing-address graph; ATTOM (~$500–1k+/mo ⚠); county ArcGIS Hub free GeoJSON.
- **Voter files** — NC free weekly bulk; FL/OH free on request; **CA/TX/NY restricted to political/scholarly/journalistic use — private OSINT excluded.**
- **Licensing** — NPPES NPI API free (provider↔org↔authorized official); CA DCA monthly rosters; FINRA BrokerCheck bans scraping (use Form ADV).
- **Aircraft/vessels** — FAA registry free daily CSV (owner, address, Mode-S); USCG documented vessels via NOAA monthly + PSIX; MarineTraffic self-serve API ended Jan 2025 (Datalastic ~$49/mo); ADS-B Exchange ~$10/mo non-commercial.
- **Patents/trademarks** — PatentsView API offline since Mar 2026 (bulk remains, disambiguated inventor IDs); USPTO ODP free but ID.me-gated; EPO OPS free 4 GB/wk; Google Patents BigQuery (~1 TiB/mo free); TSDR free; EUIPO API free with Persons endpoint; INPI marques/brevets CSV.
- **Nonprofits** — ProPublica Nonprofit Explorer API free (officers, compensation from 990s); IRS 990 XML monthly; Candid $219/mo. France: RNA monthly ZIP (no officers) + JOAFE API (officers in notices).

## 6. Academic
- **OpenAlex** — key required since Feb 2026, usage-priced: $1/day free, ID lookups $0, list $0.10/1k, search $1/1k; full snapshot free CC0. Best author↔institution↔coauthor↔funder graph.
- **ORCID** — free public API + annual dump; authoritative affiliation timelines.
- **Semantic Scholar** — free; keys not issued to free-email domains; some data CC BY-NC. **Crossref** — free (polite rates); Plus $550/yr. **Google Scholar** — SerpAPI only. **arXiv** — free. **HAL** — free Solr API; structId/authIdHal give French lab↔researcher edges. **theses.fr** — free JSON: advisor→student→jury.

## 7. News / media
- **GDELT** — free; DOC 2.0 full-text (2017→, 65 languages, 15-min updates); GKG on BigQuery. Co-mention edges at scale, low precision.
- NewsAPI.org (dev non-commercial; Business $449/mo; no body). **Media Cloud** — free, 4k req/week; FR/US collections. **Event Registry** — 2k free tokens; $90/mo 5k; built-in person/org entity extraction. Nexis/Factiva — enterprise; out of budget. Google News RSS — grey (ToS forbids automation).
- **PR Newswire / Business Wire / GlobeNewswire RSS** — free; appointments/M&A/board changes = high-precision org↔person edges, but **down-weight**: self-authored, promotional, duplicated across hundreds of outlets → inflate co-mention counts.

## 8. Social / web presence
- **X** — pay-per-use since Feb 2026: $0.005/post read; free tier effectively gone. **Reddit** — free 100 QPM non-commercial; ToS bans user profiling. **Mastodon** — per-instance ToS often bans indexing. **Bluesky/AT Protocol** — free, fully public follow graph via Jetstream. Cheapest social graph available.
- **YouTube Data API** — free 10k units/day. **GitHub** — 5k req/hr; org↔member↔repo, free. **Instagram/Facebook Graph** — only own accounts / Business Discovery. **TikTok** — academic only. **Telegram** — public channels via TDLib; bulk scraping bans accounts.
- **Sherlock / Maigret / WhatsMyName** — free username→platform enumeration. Hits ToS; output is personal data. Store hits as "unverified" edges.

## 9. Domains / infrastructure
- **RDAP/WHOIS** — free; registrant redacted post-GDPR (AFNIC shows company + SIREN for company-held .fr — a free domain→company key).
- **WhoisXML** — WHOIS API 500 free, $30/mo 2k; history/reverse via DRS credits. Pre-2018 registrant records = strongest domain→person edges.
- **DomainTools** — Personal $99/mo web-only. **crt.sh** — free JSON + public Postgres. **SecurityTrails** — free tier ⚠. **Shodan** — $49 one-time. **Censys** — 100 free credits/mo. **HIBP** — $4.39/mo (breach presence only).

## 10. Geo / places
Nominatim (1 req/s public; self-host for volume) · Overture Maps (free bulk Parquet) · Foursquare OS Places (100M POIs free; API $15/1k after 500 free from Jun 2026) · Mapbox (100k/mo free, $5/1k if storing) · Google Geocoding/Places (10k/mo free; caching forbidden > 30 days) · **Geoapify** (3k credits/day free, commercial OK) · Wikidata coordinates.

## 11. Knowledge bases / identity backbones
- **Wikidata** — CC0; SPARQL, REST, dumps; aliases + 8,000+ external-ID properties (ORCID, LEI, SIREN, VIAF, LinkedIn, X handle). **The identity spine for public figures/orgs/places.**
- Wikipedia API (free) · DBpedia · Google KG Search (100k/day free, "not for production") · VIAF/ISNI (free authority IDs) · **Diffbot KG** (free 10k credits/mo; Startup $299/mo; sourced person→employment triples) · YAGO 4.5 (free dump).

## 12. Images / media
Google Lens via SerpAPI only · Bing Visual Search retired · **TinEye** 5k searches $200 · Yandex via scrape/SerpAPI · EXIF (exiftool; most platforms strip) · **PimEyes / FaceCheck — out of scope by default**: Art. 9 biometrics; Clearview fined €20M (CNIL), €30.5M (NL), £7.5M (UK).

## 13. Aggregated OSINT platforms (what they bundle)
- **Maltego** — CE free (200 credits/mo); Pro €7,500/yr/seat. Hub partners: Shodan, Censys, WhoisXML, HIBP, Pipl, DomainTools, OpenCorporates, Social Links. Everything worth having is integrable directly at lower cost.
- **SpiderFoot** (MIT; 200+ modules, BYO keys), **Recon-ng**, **IntelTechniques tools** (free browser query builders — a good spec for search-URL templates).
- Social Links / ShadowDragon / Skopenow / Babel Street / Palantir — quote-only (~$10k+/seat ⚠); they resell the sources above plus social scraping we shouldn't replicate.

---

## (a) Connect-first shortlist (US + FR, value per dollar; light-use monthly cost)
1. **Wikidata + Wikipedia** — identity spine, external IDs — $0
2. **SEC EDGAR + Form ADV/D bulk** — officers, insiders, funds — $0
3. **French open-company stack**: API Recherche d'Entreprises + Sirene + INPI RNE + BODACC/JOAFE — dirigeants, dated changes, associations — $0
4. **Firecrawl (Hobby)** as universal fetcher — $16
5. **CourtListener/RECAP** ($10 tier) + PACER under the $30/quarter waiver — $10
6. **OpenFEC + USAspending + ProPublica Nonprofit + NPI** — donor/contract/nonprofit edges — $0
7. **OpenSanctions + ICIJ Offshore Leaks** (self-hosted yente, non-commercial) — $0
8. **Companies House PSC + GLEIF** — UBO/parent trees — $0
9. **OpenAlex (free daily) + ORCID + HAL + theses.fr** — academic edges — $0–10
10. **Exa or Tavily** for semantic discovery (~2k queries) — $15–20
11. **Wayback CDX + Common Crawl index** — temporal snapshots — $0
12. **People Data Labs Free + EnformionGO Free + Hunter Free** — person enrichment — $0 (scale to ~$125 later)

**Total at light use ≈ $50–60/mo.**

## (b) Worth paying for (when a case justifies it)
SerpAPI Production $10/1k (Google, Scholar, Lens, Yandex; ~$50–150/mo) · People Data Labs Pro ~$98/mo · EnformionGO $0.25/match · Regrid Pro $10/mo (API $375/mo) · Pappers API ~€20+/mo · WhoisXML DRS credits ~$50–100 · Shodan $49 once · HIBP $4.39/mo · TinEye $200/5k · Event Registry $90/mo · Diffbot $299/mo · CourtListener $100/mo tier. Enterprise-only: OpenCorporates £2,250/yr, Crunchbase/PitchBook/Orbis/Nexis/Factiva $10k–50k+/yr, UniCourt API ~$27k/yr.

## (c) Do not touch by default
PimEyes / FaceCheck / any face search (Art. 9, BIPA) · LinkedIn scraping (active litigation; Bright Data datasets only) · Grounding with Bing, Google CSE · BrokerCheck scraping, OpenSky commercial, SAM.gov hammering, Google News RSS / DDG automation · CA/NY/TX voter files · X API at volume, Reddit profiling, Telegram MTProto bulk · Pipl/TLO/Tracers-class (credentialing) · Brave result persistence without a storage plan.

## (d) French/EU sources US-centric OSINT misses
BODACC as an *event stream* (dirigeant changes, cessions, procédures collectives → dated edges) · JOAFE + RNA for associations; Infogreffe statuts/PVs expose shareholders RNE omits · Judilibre names companies in commercial-court rulings · Légifrance JO for décrets naming appointees, Légion d'honneur, naturalisations (published but sensitive) · HAL + theses.fr for researcher↔lab↔advisor lineage (HAL structId ↔ Sirene) · AFNIC .fr WHOIS shows SIREN · INPI legitimate-interest BE access (free formal request); from Nov 2026, 12-working-day answer obligations EU-wide · EUIPO Persons API, INPI marques CSV · GDPR posture: per-investigation LIA, retention limits, Art. 14 notice plan (Kaspr/Lusha decisions are the enforcement benchmark).
