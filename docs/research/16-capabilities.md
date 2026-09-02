# Research 16 — Capability catalog (data sources & pivots to build)

*2026-09-01. Full enumeration produced by a research subagent (real web research where quota allowed). This
doc keeps the actionable essence: the legal/tier framework, the build-first shortlist, per-category coverage,
and adapter design notes. Per the maintainer: capabilities are pre-built by us (clean, robust) — the agent does NOT
spend time acquiring them; it just uses whatever is enabled. Go wide, up to borderline-legal (grey), never
clearly-illegal.*

## Framework
**Tiers:** easy (public page / free API) · normal (needs key/parsing/correlation) · expert (multi-step pivots)
· spicy (grey-area: aggressive scraping, privacy-sensitive aggregators, biometric face search, paid brokers).
**Legal:** legal (public/official API) · grey-ToS (scraping vs ToS; usually civil-only; throttle + user-gate)
· restricted (regulated: US GLBA/DPPA/FCRA, EU GDPR Art.9, biometric laws like BIPA — lawful only for
permitted purposes; gate behind explicit purpose + jurisdiction).
**Out of scope (never build):** unauthorized access, credential stuffing/theft, ingesting/hosting/querying
raw stolen dumps, malware/C2, active exploitation, auth bypass. (We may check *whether* an id appears in a
breach via HIBP/Hudson Rock — never touch the dump itself.)

## Build-first shortlist (effort-weighted, safe/legal first)
**Tier 1 — do immediately (free/legal, high yield):**
1. **Wayback / CDX** (free) — historical content + URL inventory; underpins everything.
2. **crt.sh** certificate transparency (free) — instant subdomain/asset discovery.
3. **DNS + RDAP/WHOIS** (free) — the infrastructure backbone.
4. **SEC EDGAR + Companies House + OpenCorporates + GLEIF** — the org backbone (free/freemium official).
5. **HaveIBeenPwned** ($4.39/mo) — authoritative email→breach signal, no raw dumps.
6. **Hunter.io** (free tier) — domain→email + verification; drives people pivots.
7. **urlscan.io** (free tier) — screenshot + tech + links + historical scans in one call.
8. **Sherlock / Maigret** (free OSS) — username→accounts fan-out (grey-ToS: throttle, label).
9. **Google Programmable Search / SerpAPI** — the general dorking primitive (we have SerpAPI + Exa).
10. **ExifTool + Yandex reverse image** — media→geo/device; image→web.

**Tier 2 — high value, key or more effort:** 11. **Shodan + Censys** (favicon/fingerprint pivots) · 12.
**SecurityTrails** (DNS history/subdomains) · 13. **OpenSanctions + OCCRP Aleph** (risk/investigative
enrichment) · 14. **GDELT** (global news/events for any entity) · 15. **GitHub Search + TruffleHog** (dev
footprint, public-repo secrets).

**Defer + gate (grey/restricted):** breach-search aggregators (DeHashed/IntelX), people-search brokers
(Spokeo/BeenVerified/TLO), **face search** (PimEyes/FaceCheck), AI geolocation (GeoSpy) — legal status turns
on the user & purpose, not the tool; off by default, human review.

## Coverage by subject type (names; full detail in the session catalog)
- **People:** Gravatar · HIBP · Hudson Rock (infostealer) · Holehe/EmailRep (account-by-email) · Epieos/GHunt
  (email→Google) · Hunter/Snov/RocketReach (corp email) · Sherlock/Maigret/WhatsMyName (username) · Twilio
  Lookup/PhoneInfoga (phone) · TruePeopleSearch/Spokeo/BeenVerified (people-search, FCRA-restricted) ·
  FEC/OpenSecrets (donations) · property/assessor · FamilySearch/WikiTree (relatives) · OpenAlex/Semantic
  Scholar/ORCID (academic) · X/Reddit/Instagram/TikTok/Telegram/LinkedIn public data · PDL/FullContact
  (enrichment, restricted) · reverse-image · PimEyes/FaceCheck (face, spicy/restricted).
- **Orgs:** OpenCorporates · SEC EDGAR · Companies House · INSEE Sirene · GLEIF · OpenOwnership (UBO) ·
  OpenSanctions/OFAC (PEP/sanctions) · OCCRP Aleph/ICIJ (leaks) · LittleSis/Wikidata (relationships) ·
  Crunchbase/PitchBook (funding) · ProPublica 990s · CourtListener/PACER (litigation) · PatentsView/USPTO ·
  USAspending (contracts) · NIH RePORTER (grants) · ImportGenius/Panjiva (trade) · BuiltWith (tech stack) ·
  theHarvester (employees) · Glassdoor/Trustpilot (reviews).
- **Domains/Infra:** RDAP/WHOIS + history + reverse-WHOIS · DNS + DNSDumpster · crt.sh/Censys certs · Amass/
  Subfinder (subdomains) · VirusTotal/DNSDB (passive DNS) · reverse-IP/HackerTarget · Shodan/Censys/FOFA/Netlas
  (host scan DBs) · favicon-hash & tracking-ID pivots · urlscan · bgp.he.net/BGPView/PeeringDB (ASN) · MaxMind/
  IPinfo (geo) · AbuseIPDB/GreyNoise (reputation) · OTX/ThreatFox (TI) · GrayHatWarfare (open buckets, grey) ·
  GitHub/grep.app/Sourcegraph + TruffleHog (code/secrets) · robots/sitemap/security.txt/.well-known.
- **Media/Geo:** ExifTool · reverse image (Yandex/Lens/Bing/TinEye) · FotoForensics (forensics) · InVID
  (video) · deepfake detectors · Sentinel Hub/Google Earth (satellite) · Street View/Mapillary · Overpass
  (map query) · SunCalc (chronolocation) · weather cross-ref · WiGLE (BSSID, grey) · ADS-B/OpenSky (aircraft)
  · MarineTraffic (vessels) · Snap Map (social geo) · GeoSpy/Picarta (AI geo, spicy).
- **Cross-cutting:** web search + dorking (SerpAPI/Exa/Google CSE) · alternative engines (Yandex/Brave/
  SearXNG) · PublicWWW (source-code search) · **Firecrawl's own suite: scrape (have), search, map (site URL
  inventory), crawl (whole-site), interact/actions (click/scroll/fill for JS pages)** · Wayback + archive.today
  + Memento · Common Crawl · GDELT/MediaCloud (news) · Etherscan/Arkham (crypto tracing) · Wikidata/DBpedia
  (KB) · SpiderFoot/Maltego/Recon-ng (aggregators) · Hunchly (evidence capture).

## Capability adapter design notes (for the build phase)
- **Legal tier → grade:** official API = high-confidence; scraped/aggregator = medium (flag ToS); predictive/
  biometric = low (require human confirmation). Every fact carries source URL + fetch time + tier.
- **Gate restricted/spicy** behind explicit purpose + jurisdiction; face search & paid brokers off by default.
- **ToS hygiene:** per-source throttle, robots awareness, cache-first (dedupe vs Wayback/urlscan before hitting
  live), clear "grey" labeling in the UI.
- **Pivot chains are the power:** e.g. `domain → crt.sh subdomains → Shodan hosts → favicon hash → sibling
  domains → reverse-WHOIS → registrant email → HIBP/Holehe → username enum → social profiles`. Adapters emit
  **typed edges**, not just facts. This is what turns the Trump-domains test into a real scam-network map.
- **Firecrawl map/crawl/interact** are near-free upgrades to the fetch layer (site inventory, JS pages) —
  worth wiring early.

## Implementation specs
The buildable, live-verified specs (exact endpoints, auth, limits, real output shapes, evidence grades, build
sketches) live in the companion **`research/17-capability-specs.md`**, written cluster by cluster. This doc stays
the broad catalog; 17 is the engineering plan.

## Relation to the roadmap
This is the "capabilities" content for the vision phase. Per the maintainer the agent won't acquire capabilities — we
build them as clean adapters and the agent uses whatever's enabled (the capability→tool binding). Build order:
the Tier-1 shortlist (all legal), wired as capability rows + adapters + agent tools, starting with the domain/
infra set (which also unlocks the Trump-domains benchmark).
