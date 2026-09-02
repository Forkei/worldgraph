# Research 17 — Capability specs & implementation plan

*2026-09-01. The engineering companion to `research/16` (which is the broad catalog: what exists, tiers, legal
framing). This doc turns the catalog into buildable specs — per capability: exact endpoint, auth, limits, real
output shape, reliability reality, legal/tier, evidence grade, and a build sketch. Every entry marked ✅ was
**verified with a live call** on 2026-09-01 (openai.com as the probe). Built cluster by cluster; this pass
covers **Domain / Infrastructure**. People/Email and Media/Geo are the next passes.*

## How to read an entry
Each capability follows the same shape so the loop can treat them uniformly:
- **Consumes → Emits** — the typed input value and the typed entities/edges/**new pivot-values** it produces.
  Pivot-values are the point: a capability that emits a new `email`/`domain`/`hostname` re-triggers the
  capabilities that consume that kind. That's what makes lookups *chain*.
- **Source table** — endpoint, auth, limit, live status. Primary + fallback where one exists.
- **Output shape** — the real fields (from the live call), and which ones become facts vs. dates vs. pivots.
- **Reliability / caveats** — the traps only live testing reveals (a flaky host, a signal that's noise on CDNs).
- **Legal / tier / grade** — from `16`'s framework, plus the two-axis evidence grade the facts carry.
- **Build sketch** — adapter shape, cache TTL, and the pivots it feeds.

*(This assumes a light adapter contract — `consumes`, `emits`, `grade`, `cache`. The full framework/pivot-engine
design is a separate decision; these specs stand on their own regardless of how it's wired.)*

---

# Cluster A — Domain / Infrastructure

The most self-contained, mostly-free, mostly-legal cluster, and the one that unlocks the
**Trump-scam-domains benchmark** (seed domains → sibling infra → shared registrant → scam network). Ordered
roughly along the natural pivot chain.

## A1. RDAP / WHOIS — registration facts ✅
**What & why:** given a domain, return who registered it, through which registrar, and when. The registration
date anchors a domain's age; the registrar and nameservers are pivots; historical WHOIS (paid) is the real
sibling-finder.

**Consumes:** `domain` → **Emits:** `registration_date`/`expiration_date` (temporal), `registrar` (org edge),
`nameserver` hostnames (→ DNS/CT pivots), and — *when not redacted* — registrant `name`/`email`/`org`.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **RDAP** *(primary, modern)* | `rdap.org/domain/{domain}` (redirects to the authoritative registry) | none | generous | ✅ clean JSON |
| WHOIS (legacy text) | port 43 / library | none | per-registry | fallback for TLDs without RDAP |
| Historical/Reverse WHOIS | WhoisXML API / ViewDNS | **paid key** | tiered | defer (Tier-2) — the sibling-by-registrant pivot |

**Output shape (real):** `events:{registration, expiration, "last changed"}`, `entities[roles=registrar]`,
`nameservers[]`, `status[]`. openai.com → registrar **MarkMonitor Inc.**, registered **2007-01-19**, expires
**2029-01-19**, last changed 2024-10-17.

**Reliability / caveats:** **registrant contact is privacy-redacted for the vast majority of domains** (GDPR +
registrar privacy services like MarkMonitor). So RDAP's durable value is *registrar + dates + nameservers + status*,
**not** the person. Getting a registrant name/email usually needs **historical WHOIS** (pre-2018 snapshots,
paid) or a leak — that's the darker/paid pivot, gated.

**Legal / tier / grade:** easy · legal (public registry data). Grade **A / high** (authoritative registry).

**Build sketch:** `rdap(domain)` → parse events+entities+nameservers → emit dated edges (grade A) → nameservers
enqueue DNS/CT pivots → cache **7d**. Reverse/historical WHOIS is a separate gated adapter.

## A2. DNS records ✅
**What & why:** the live infrastructure backbone. A-records (hosting IP → geo/ASN pivots), MX (email provider —
a real signal), NS (DNS provider), TXT (SPF/DKIM/verification tokens that leak vendors: Google, M365, Atlassian…),
CNAME (SaaS fingerprints).

**Consumes:** `domain`/`hostname` → **Emits:** `ip_address` (→ ASN/reverse-IP/passive-DNS), `mail_provider`,
`dns_provider`, vendor `uses_service` edges from TXT/CNAME.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **Google DoH** *(primary)* | `dns.google/resolve?name={n}&type={T}` | none | generous | ✅ JSON, `Status`+`Answer[]` |
| Cloudflare DoH *(fallback)* | `cloudflare-dns.com/dns-query` (Accept: application/dns-json) | none | generous | mirror |

**Output shape (real):** `{Status:0, Answer:[{name,type,data,TTL}]}`. openai.com MX → `aspmx.l.google.com` etc.
= **runs Google Workspace** (so employee emails are likely `@openai.com` on Google → feeds email/Hunter pivots).

**Reliability / caveats:** DoH is reliable. Interpret TXT carefully — verification tokens are strong vendor
signals but noisy; SPF `include:` lines are a clean way to enumerate a domain's service providers.

**Legal / tier / grade:** easy · legal. Grade **A / high** (live authoritative DNS).

**Build sketch:** `dns(host, types=[A,AAAA,MX,NS,TXT,CNAME,SOA])` → one DoH call per type (parallel) → emit typed
edges → A-records enqueue ASN + reverse-IP + passive-DNS; MX/SPF enqueue email-provider inference → cache **6h**
(DNS changes faster than registration).

## A3. Certificate Transparency — subdomain/asset discovery ✅
*(the calibration sample — kept here in full so the cluster is complete)*

**What & why:** every hostname that's ever had a TLS cert, from public CT logs. Reveals subdomains/infra never
linked from the site (`brand.openai.com`, staging, vendor endpoints). One call explodes a domain into an asset map.

**Consumes:** `domain` → **Emits:** `hostname` entities + `has_subdomain` edges + `hostname` pivot-values
(→ DNS/urlscan/reverse-IP), each with a first-seen date from `not_before`.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **certSpotter** *(primary)* | `api.certspotter.com/v1/issuances?domain={d}&include_subdomains=true&expand=dns_names&expand=issuer` | none (free) | ~100/hr keyless; more w/ free token | ✅ clean JSON, 100 rows |
| crt.sh *(fallback/bulk)* | `crt.sh/?q={d}&output=json` | none | unmetered but **frequently 502s** | ⚠️ 502 at test time |

**Output shape (real):** `[{id, dns_names:[…], issuer, not_before, not_after, revoked}]`. `dns_names` is the
payload; `not_before` → first-seen date; `revoked`/`not_after` age out dead infra. Found `brand.openai.com`.

**Reliability / caveats:** **crt.sh is unreliable (502s)** — certSpotter is the dependable primary; keep crt.sh
only for bulk/historical. certSpotter's keyless tier paginates (`after=` cursor) and caps rows — get a free
token for full history.

**Legal / tier / grade:** easy · legal (public CT logs). Grade **A / high** (cryptographically logged).

**Build sketch:** `certTransparency(domain)` → certSpotter, fall back to crt.sh on empty/error → dedupe hostnames
→ emit entities+edges (grade A, first-seen from `not_before`) → each hostname enqueues DNS/urlscan → cache **24h**.

## A4. Wayback Machine / CDX — history, deleted content, URL inventory ✅
**What & why:** the time machine. Two modes: **CDX** (every archived URL for a host, with timestamps + status =
a full URL inventory and first-seen dates) and **content retrieval** (read a page as it was — recovers *deleted*
bios, prices, staff pages, old domains). Underpins everything; also the cache-first dedupe layer (check the
archive before hitting a live site).

**Consumes:** `domain`/`url` → **Emits:** `url` inventory + first/last-seen dates + archived page *content*
(→ re-extraction of deleted facts).

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **CDX API** | `web.archive.org/cdx/search/cdx?url={d}&output=json&fl=timestamp,original,statuscode` | none | generous | ✅ back to 2001 |
| Content | `web.archive.org/web/{timestamp}/{url}` | none | generous | snapshot fetch |
| archive.today *(fallback)* | `archive.ph` | none | flaky | complements Wayback |

**Output shape (real):** rows `[timestamp, original, statuscode]`. openai.com first snapshot **2001-07-06** — so
CDX gives a domain's *observed* age even when WHOIS is redacted.

**Reliability / caveats:** CDX can be slow on huge hosts — use `limit=` + `collapse=urlkey` to sample. `filter=`
narrows by status/mimetype. Deleted-content retrieval is the highest-value, lowest-cost "grey depth" move.

**Legal / tier / grade:** easy · legal. Grade **B / high** (faithful archive; the *content's* grade inherits
from the original publisher).

**Build sketch:** `wayback(domain, mode)` → CDX for inventory (emit `url`+dates), or nearest-snapshot fetch for
content (→ feed the normal extractor) → cache **inventory 24h, content permanently** (archives are immutable).

## A5. urlscan.io — live scan (screenshot, tech, links, contacted domains) ✅
**What & why:** one call gives a page's screenshot, the domains/IPs it *contacted* (trackers, APIs, CDNs — real
infra relationships), its tech stack, and links. Historical scans mean you often get data without touching the
live site. The contacted-domains graph is a genuine pivot (shared trackers/analytics IDs link sibling sites).

**Consumes:** `domain`/`url` → **Emits:** `contacted_domain`/`ip` edges, `tech`/`tracker` fingerprints
(→ favicon/analytics-ID pivots), screenshot asset.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **Search (existing scans)** | `urlscan.io/api/v1/search/?q=domain:{d}` | none for public | rate-limited | ✅ total+results |
| Submit new scan | `POST urlscan.io/api/v1/scan/` | **free key** | 100–1000/day free | needs signup |

**Output shape (real):** search → `{total, results:[{task, page, stats, …}]}`; a result's `page`/`lists` expose
contacted domains, IPs, ASNs, tech. openai.com → 10000+ existing public scans.

**Reliability / caveats:** default submissions are **public** (don't scan sensitive private URLs on the free
tier — use `visibility:unlisted/private`, paid). Search-only is keyless and covers most needs (someone's usually
already scanned it).

**Legal / tier / grade:** easy · legal (search) · grey-ish for aggressive submission. Grade **A / high** (direct
observation). **Get a free key** — high yield.

**Build sketch:** `urlscan(domain)` → search existing first (keyless); submit only if stale/absent (key) →
emit contacted-domain edges + tech → cache **12h**. Analytics/favicon IDs enqueue the sibling-site pivot.

## A6. Reverse IP / Passive DNS — sibling domains ✅⚠️
**What & why:** "what other domains live here / have pointed here?" The classic sibling-network pivot for the
Trump-domains case. **But the method matters enormously** (see caveat).

**Consumes:** `ip_address`/`domain` → **Emits:** sibling `domain` entities + `co_hosted`/`historically_resolved` edges.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| HackerTarget reverse-IP | `api.hackertarget.com/reverseiplookup/?q={ip}` | none | ~50/day free | ✅ returns list |
| **Passive DNS** *(the right way)* | VirusTotal / Mnemonic PDNS / SecurityTrails | **free/paid key** | tiered | defer — needs key |

**Output shape (real):** HackerTarget → newline list of domains on the IP.

**Reliability / caveats — important:** **reverse-IP is noise on shared/CDN IPs.** My live test on a Cloudflare
IP returned dozens of unrelated domains (`1i2b3c.com`, `4v5ora.com`…) — meaningless. Reverse-IP is only
trustworthy on a **dedicated IP**. For real siblings, prefer **passive DNS** (historical domain↔IP over time)
and **reverse-WHOIS** (same registrant) — both gated/keyed. So: run reverse-IP *only after* checking the IP
isn't CDN/shared (ASN lookup tells you), and label its edges low-confidence.

**Legal / tier / grade:** normal · legal. Grade **C / medium** (aggregator; flag CDN noise). Passive DNS: **B**.

**Build sketch:** `siblings(domain)` → resolve A-record → **ASN-gate**: if Cloudflare/Akamai/Fastly/shared, skip
reverse-IP, note "CDN — siblings not derivable from IP"; else HackerTarget (grade C) → prefer passive DNS when a
key exists → cache **24h**.

## A7. ASN / BGP — infra ownership & the CDN gate ✅ (built)
**What & why:** maps an IP to its network owner (ASN) and prefix. Two jobs: (1) attribute infra ("hosted on AS13335
Cloudflare" vs "AS-SOME-BULLETPROOF-HOST" — the latter is a scam signal), and (2) **gate reverse-IP** (A6) by
telling you whether an IP is shared CDN.

**Consumes:** `ip_address` → **Emits:** `asn`/`network_owner` edge, `prefix`, `is_cdn` flag.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **RIPEstat** *(primary)* | `stat.ripe.net/data/prefix-overview/data.json?resource={ip}` | none | generous | ✅ reliable, keyless |
| IPinfo *(fallback)* | `ipinfo.io/{ip}/json` | none (more w/ free key) | ~50k/mo keyed | ✅ org+ASN+geo keyless |
| BGPView *(last resort)* | `api.bgpview.io/ip/{ip}` | none | rate-limited | ⚠️ **DNS frequently unresolvable** |

**Reliability / caveats:** **BGPView went ENOTFOUND during the build** — do not rely on it. RIPEstat (RIPE-run,
keyless) is the dependable primary; IPinfo keyless gives org+ASN+geo as a clean fallback. The `asn()` runner tries
all three in order. CDN detection is by ASN holder name (Cloudflare/Akamai/Fastly/AWS/Google/…) and sets the
`is_cdn` flag A6 reads.

**Legal / tier / grade:** easy · legal. Grade **A / high**.

**Build sketch (done):** `asn(ip)` → RIPEstat → IPinfo → BGPView → emit owner+prefix(+geo) → set `is_cdn` (feeds
A6's gate) → cache **7d**. Implemented in `acquire/capabilities/domain.ts`.

## A8. Web recon primitives — robots / sitemap / security.txt / .well-known ✅(trivial)
**What & why:** near-free structured hints straight from the site: `sitemap.xml` (full URL inventory, often
exposing hidden sections), `robots.txt` (paths the owner *doesn't* want indexed — frequently the interesting
ones), `security.txt` (a contact email/PGP → people pivot), `.well-known/` (SSO, matrix, apple-app-site → app
pivots).

**Consumes:** `domain` → **Emits:** `url` inventory, `email` (security.txt → people pivot), `uses_service` hints.

**Source:** direct fetch of `/{robots.txt, sitemap.xml, .well-known/security.txt}` — no auth, no limit.

**Legal / tier / grade:** easy · legal. Grade **A / high** (owner-published).

**Build sketch:** part of the fetch layer — pull these alongside the main scrape → sitemap feeds the URL queue,
security.txt email feeds the email/people pivots → cache **24h**.

---

## Tier-2 (build after Tier-1 — needs a key or more effort)
- **Shodan / Censys** — host fingerprinting; **favicon-hash pivot** (same favicon hash across domains = same
  operator — a strong sibling signal that survives CDNs, unlike reverse-IP). Keyed. High value for the scam-net case.
- **SecurityTrails** — clean DNS history + subdomains + reverse-WHOIS in one API. Keyed. The "do it properly"
  upgrade to A6.
- **VirusTotal** — passive DNS + domain reputation + related files/URLs. Free keyed tier.
- **DNSDumpster / Amass / Subfinder** — OSS subdomain enumeration (brute + passive) to complement CT.
- **GreyNoise / AbuseIPDB / OTX** — IP/domain reputation & threat-intel context.

## The domain/infra pivot chain (what makes it OP)
```
domain
 ├─ RDAP ........... registrar, dates, nameservers  (registrant usually redacted → historical WHOIS, gated)
 ├─ DNS ............ A→IP, MX→email-provider, TXT/CNAME→vendors
 │    └─ IP → ASN ... owner + is_cdn  ─┐
 │                                     ├─ if not CDN → reverse-IP → sibling domains
 │                                     └─ passive DNS → historical siblings   (gated/keyed)
 ├─ CertTransparency → subdomains/hostnames → (loop back into DNS/urlscan)
 ├─ Wayback/CDX .... URL inventory + first-seen + DELETED content (re-extract)
 ├─ urlscan ........ contacted domains, tech, trackers → analytics/favicon-ID → siblings (CDN-proof)
 └─ web primitives . sitemap/robots (hidden URLs), security.txt (email → people cluster)
```
Every arrow that emits a `domain`, `hostname`, `ip`, or `email` re-enters the chain. Seed two Trump domains and
this fans out into their shared infrastructure automatically — that's the benchmark.

## Build order for this cluster
1. **Free/verified first (this pass's ✅):** RDAP, DNS, CertTransparency, Wayback/CDX, web primitives, urlscan
   (search) — all keyless or free-key, all live-tested. This alone builds a real infra map + the Trump benchmark's backbone.
2. **One free key each:** urlscan (submit), IPinfo (ASN gate), certSpotter token, VirusTotal (passive DNS).
3. **Paid/gated (darker pivots):** historical/reverse-WHOIS, SecurityTrails, Shodan/Censys favicon-hash.

---

---

# Cluster B — People / Email

The correlation cluster — where a name/email/username fans out into a person's whole digital footprint. This is
the "you have a correlation problem, not a privacy problem" superpower. More of it is keyed or grey/restricted
than Cluster A, but the keyless anchors below are strong and were live-verified.

## B1. Email → breach appearance (HIBP) ⚠️(catalog ✅, check needs key)
**What & why:** does this email appear in known breaches, and which ones? Confirms an account exists, dates the
person's online activity, and each breach *domain* is a service they used (a pivot). **We check appearance only —
never touch the dump** (the `16` hard line).

**Consumes:** `email` → **Emits:** `breached_in` edges to service `domain`s + first-activity dates.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **HIBP breach catalog** | `haveibeenpwned.com/api/v3/breaches` | none | open | ✅ 1033 breaches, dated |
| HIBP account check | `…/api/v3/breachedaccount/{email}` | **paid key** ($4.39/mo) | rate-limited | needs key |
| Hudson Rock (infostealer) | `cavalier.hudsonrock.com` free endpoints | free | limited | infostealer signal |

**Output shape (real):** catalog rows `{Name, Title, Domain, BreachDate, PwnCount, Description}` — so even keyless
we can *describe* any breach; the keyed call maps an email to that list.

**Reliability / caveats:** account check is the value and it's paid — cheap and worth it. Hudson Rock adds
infostealer-infection signals (darker, still appearance-only).

**Legal / tier / grade:** normal · legal (appearance only). Grade **B / medium** (aggregated, but authoritative source).

**Build sketch:** `hibp(email)` → account check (key) → emit `breached_in` service edges + dates → each breach
domain enqueues a "this person used {service}" note → cache **7d**.

## B2. Email → account discovery (Holehe / EmailRep) ⚠️(OSS/keyed)
**What & why:** which sites have an account registered to this email (via password-reset/registration probes).
Holehe covers ~120 sites; EmailRep gives a reputation + profile summary.

**Consumes:** `email` → **Emits:** `has_account_on` edges → site profiles (→ username/name pivots).

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| Holehe | OSS CLI (subprocess, like `ml/score.py`) | none | self-throttled | grey-ToS |
| EmailRep | `emailrep.io` | free key | low | reputation summary |

**Reliability / caveats:** probe-based → **grey-ToS**, throttle + label; some sites rate-limit/false-negative.
Run as a gated subprocess adapter.

**Legal / tier / grade:** normal/grey · civil-risk. Grade **C / medium** (probe inference).

**Build sketch:** `emailAccounts(email)` → Holehe subprocess → parse JSON → emit `has_account_on` (grade C, "grey")
→ cache **3d**.

## B3. Gravatar (email hash → public profile) ✅
**What & why:** the one **keyless, instant** email→identity link. MD5 the email, fetch the profile: display name,
linked social accounts, personal URLs, location, bio.

**Consumes:** `email` → **Emits:** `name`, linked `account`s (→ username pivots), `url`s, `location`.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **Gravatar** | `gravatar.com/{md5(lowercase_email)}.json` | none | open | ✅ works |

**Output shape (real):** `entry[0].{displayName, accounts[], urls[], currentLocation, aboutMe}`. Probe
(someone@example.com) returned a real `displayName`; **caveat: modern profiles are often sparse** (`accounts`/`urls`
empty) — but a 200 still *confirms the email is real and in use*, which is itself signal.

**Legal / tier / grade:** easy · legal (self-published). Grade **B / high** (owner-published; verify freshness).

**Build sketch:** `gravatar(email)` → md5 → fetch → emit whatever's present (grade B) → accounts enqueue username
pivots → cache **7d**.

## B4. Domain → corporate emails + verification (Hunter / Snov) ⚠️(free key)
**What & why:** the email-pattern engine. Given a company domain, get the email format (`{first}.{last}@`) and
known addresses; verify any guessed address. Bridges DNS (A2: "runs Google Workspace") → actual employee emails.

**Consumes:** `domain`/`name+domain` → **Emits:** `email` entities (→ B1/B2/B3 pivots), org `email_pattern`.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| Hunter.io | `api.hunter.io/v2/domain-search` + `/email-verifier` | **free key** (25/mo) | tiered | needs signup |
| Snov / RocketReach | APIs | keyed | tiered | alternates |

**Reliability / caveats:** free tiers are small — cache hard. Verification reduces false emails before we spend
B1/B2 calls on them.

**Legal / tier / grade:** normal · legal. Grade **B / medium**.

**Build sketch:** `hunter(domain)` → pattern + known emails → verify candidates → emit `email` (grade B) → feed
B1/B2/B3 → cache **30d** (patterns are stable).

## B5. Username → account fan-out (WhatsMyName-native) ✅
**What & why:** the username pivot — one handle checked across **716 sites** to find every profile. The biggest
"reused identifier" unlock (a username reused on an obscure 2014 forum is exactly the magic moment).

**Consumes:** `username` → **Emits:** `has_account_on` edges → profile `url`s (→ scrape → new name/email/username).

| Source | Data/endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **WhatsMyName data** | `raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json` | none | open | ✅ 716 sites |
| Sherlock / Maigret | OSS CLI (subprocess) | none | self-throttled | alternates |

**Output shape (real):** each site `{name, uri_check, e_code, e_string, m_string, m_code, cat}` — `uri_check` is
the URL template, `e_code`/`e_string` detect "exists", `m_*` detect "missing", `cat` categorizes (coding, dating,
finance, gaming…). So we can **implement the check natively** (fetch `uri_check`, apply the detection rules) — no
need to shell out to Sherlock, and we control throttling/grading.

**Reliability / caveats:** grey-ToS (automated profile probing) → throttle hard, run in parallel with jitter,
label edges "grey". Detection rules drift; the maintained JSON keeps them current — pull it periodically.

**Legal / tier / grade:** normal/grey · civil-risk. Grade **C / medium** (existence inference; a matched profile
you then scrape upgrades to the publisher's grade).

**Build sketch:** `usernameAccounts(username)` → load cached wmn-data → parallel fetch all `uri_check` (bounded
concurrency, jitter) → apply e/m detection → emit `has_account_on` (grade C) → each hit's profile URL enqueues a
scrape → cache **7d**. Refresh wmn-data weekly.

## B6. Political donations (FEC / OpenSecrets) ✅
**What & why:** a goldmine of *verified* PII — US political contributions are public record with **name, city,
state, ZIP, employer, occupation, amount, date, recipient**. Confirms employer+location+timeline in one call.

**Consumes:** `name` → **Emits:** `donated_to` edges + `employer`, `occupation`, `location`, dated amounts.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **FEC API** | `api.open.fec.gov/v1/schedules/schedule_a/?contributor_name={n}` | free (`DEMO_KEY`, then api.data.gov key) | tiered | ✅ works |
| OpenSecrets | `api.opensecrets.org` | free key | tiered | aggregated view |

**Output shape (real):** `results[].{contributor_name, contributor_employer, contributor_occupation,
contributor_city/state/zip, contribution_receipt_amount, contribution_receipt_date, committee.name}`. Probe:
**"SAMPLE, CASEY N." → $192.31 → "META PLATFORMS, INC. PAC"** (confirms employer + a real datapoint).

**Reliability / caveats:** US-only; name collisions (disambiguate by employer/city/ZIP). DEMO_KEY is heavily
rate-limited — grab a free api.data.gov key.

**Legal / tier / grade:** easy · legal (public record). Grade **A / high** (government filing).

**Build sketch:** `fecDonations(name)` → schedule_a search → group by contributor identity (employer+ZIP) → emit
dated `donated_to` + employer/occupation/location (grade A) → cache **30d**.

## B7. Academic footprint (OpenAlex / ORCID / Semantic Scholar) ✅
**What & why:** for anyone who's published — papers, coauthors (a real relationship network), institutions over
time, topics, citations. Coauthorship is one of the cleanest, most reliable graphs available.

**Consumes:** `name`/`orcid` → **Emits:** `authored` works, `coauthor_of` edges, `affiliated_with` (dated), topics.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **OpenAlex** | `api.openalex.org/authors?search={n}` | none | 100k/day (polite pool w/ email) | ✅ works |
| ORCID | `pub.orcid.org/v3.0/expanded-search/?q={n}` | none | open | ✅ works |
| Semantic Scholar | `api.semanticscholar.org` | free key optional | tiered | alt |

**Output shape (real):** OpenAlex author → `{display_name, works_count, last_known_institutions[], orcid, x_concepts}`.
Probe: Lee Example → 477 works, Courant Institute. ORCID "Casey Sample" → 1633 fuzzy matches (disambiguate).

**Reliability / caveats:** name disambiguation is the work (use ORCID/institution to pin). Rich coauthor graph
via each work's `authorships[]`.

**Legal / tier / grade:** easy · legal. Grade **A / high**.

**Build sketch:** `academic(name)` → OpenAlex author resolve → pull works → emit coauthor + affiliation edges
(grade A, dated) → cache **14d**.

## B8. Phone lookup (Twilio Lookup / PhoneInfoga) ⚠️(keyed/OSS)
**What & why:** number → carrier, line type, country, and (keyed) caller-name/spam signals. Confirms/links a phone.

**Consumes:** `phone` → **Emits:** `carrier`, `line_type`, `country`, name hints.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| Twilio Lookup | `lookups.twilio.com/v2/PhoneNumbers/{e164}` | keyed (paid per-lookup) | pay-go | authoritative |
| PhoneInfoga | OSS CLI (subprocess) | none | — | grey enrichment |

**Legal / tier / grade:** normal · legal (carrier lookup). Grade **B / high** (Twilio) / **C** (PhoneInfoga).

**Build sketch:** `phone(e164)` → Twilio (if key) else PhoneInfoga → emit carrier/type (grade per source) → cache **30d**.

## B9. Relatives / genealogy (WikiTree / FamilySearch) ⚠️
**What & why:** family relationships — the `parent_of Willow`/`spouse_of` edges, corroborated and extended.
**Consumes:** `name` → **Emits:** `parent_of`/`sibling_of`/`spouse_of` edges + relatives as new person-seeds.
| Source | Endpoint | Auth | Status |
|---|---|---|---|
| WikiTree API | `api.wikitree.com` | free | public trees |
| FamilySearch | API | keyed (free acct) | broad |
**Legal / tier / grade:** normal · legal (public trees). Grade **C / medium** (user-contributed). Cache **30d**.

## Restricted / darker (build behind your gate)
Per the "push into darker" call — build these as **gated** data-access capabilities (on by default for private
use, spiciest ones opt-in per run). All are *reading data*, not intrusion.
- **People-search brokers** — TruePeopleSearch / Spokeo / BeenVerified / TLO / whitepages: name/phone/email →
  addresses, relatives, age, past addresses. **Restricted** (FCRA/GLBA/DPPA — lawful for permitted purposes;
  gate on purpose+jurisdiction). Mostly scraped or paid API. Grade **C**, labeled restricted.
- **Breach-record aggregators** — DeHashed / IntelX / Snusbase: email/username → *records* across breaches.
  Darker than HIBP (returns data, not just appearance). Keyed/paid. Gate hard; label restricted. Grade **C**.
  *(Still not the raw-dump-hosting the `16` line forbids — these are query services.)*
- **Data enrichment** — PeopleDataLabs / FullContact: identifier → unified person profile. Keyed, restricted.
- **Face search** — PimEyes / FaceCheck.ID: photo → other appearances of the face. **Spicy/biometric** (BIPA);
  opt-in per run, human-confirm. Grade **low** (predictive). *(Bridges into Cluster C.)*

## The people/email pivot chain
```
name
 ├─ search/social ...... username, email, employer-domain, location, photo
 ├─ FEC/OpenSecrets .... employer + occupation + city/ZIP + dated donations   ✅A
 ├─ OpenAlex/ORCID ..... papers + COAUTHOR network + affiliations             ✅A
 └─ WikiTree ........... relatives (new person-seeds)
email
 ├─ Gravatar ........... name + linked accounts + urls                        ✅B
 ├─ HIBP ............... breach appearance → services used (dates)             (key)
 ├─ Holehe ............. accounts registered                                   (OSS, grey)
 ├─ Hunter ............. verify / find more org emails                         (key)
 └─ [gated] DeHashed ... breach records                                        (darker)
username
 └─ WhatsMyName(716) ... accounts everywhere → scrape profiles → new name/email/username  ✅C(grey)
employer-domain → Hunter → email pattern → guess+verify emails → (back to email chain)
photo → [gated] PimEyes / reverse-image (Cluster C)
```
Every emitted `email`/`username`/`name`/`domain`/`photo` re-enters the graph. **Name → email → username →
accounts → new emails** is the loop that produces the "how did it find *that*" moments.

## Build order for this cluster
1. **Free/verified first (✅):** Gravatar, FEC (donations), OpenAlex/ORCID (academic), WhatsMyName (username
   fan-out, native). Strong footprint from zero keys.
2. **One free/cheap key each:** Hunter (emails), HIBP (breach appearance, $4.39/mo — worth it), EmailRep, Twilio.
3. **Gated/darker (your call):** people-search brokers, breach-record aggregators, enrichment, face search.

---

---

# Cluster C — Media / Geo

Turns a photo or a place into evidence: where/when/what-device a photo is, where else that image (or that face)
appears, and whether a claimed time+place actually holds up. Several strong keyless anchors + reverse-image on
our existing SerpAPI key.

## C1. EXIF / metadata extraction (ExifTool) ⚠️(OSS, local)
**What & why:** the first thing to do with any image/document — pull embedded metadata: **GPS coordinates**,
capture timestamp, camera make/model/serial, editing software, author fields. GPS + timestamp alone often
answers "where and when" outright.

**Consumes:** `image`/`file` → **Emits:** `taken_at` (temporal), `location` (GPS → C4), `device`, `software`, `author`.

| Source | Endpoint | Auth | Status |
|---|---|---|---|
| **ExifTool** | local binary (subprocess, `-json`) | none | canonical |

**Reliability / caveats:** social platforms (Instagram/X/FB) **strip EXIF on upload** — so EXIF pays off on
files from personal sites, email, cloud shares, or originals, rarely on social. Camera serial numbers can link
multiple photos to one device (a strong pivot).

**Legal / tier / grade:** easy · legal (reading file metadata). Grade **A / high** (embedded by the device).

**Build sketch:** `exif(file)` → ExifTool `-json` subprocess → emit GPS→location, timestamp, device (grade A) →
GPS enqueues C4/C5, device serial enqueues "same-device" clustering → cache by file hash **permanently**.

## C2. Reverse image search (SerpAPI Lens / Yandex / Bing) ✅
**What & why:** where else does this image appear? Finds the person's other profiles, the original source of a
photo, stock/Getty origins, and re-uses. **Yandex is the OSINT favorite for faces/places;** Google Lens is
strongest for objects/landmarks.

**Consumes:** `image` (URL) → **Emits:** `appears_on` `url`s (→ scrape → profiles/context), source attributions.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **SerpAPI** | `serpapi.com/search.json?engine=google_lens\|yandex_images\|bing_images&url={img}` | **our key** | 790/1000 this mo | ✅ 59 matches on probe |
| TinEye | `tineye.com` API | keyed | tiered | best for exact-dupe + first-seen date |

**Output shape (real):** `visual_matches[].{title, link, source, thumbnail}`. Einstein probe → 59 matches
(Wikipedia, Getty, **Instagram** — i.e. straight to social profiles).

**Reliability / caveats:** needs a **publicly-fetchable image URL** (my thumbnail probe returned 0; the full-size
URL returned 59 — host the image or use a stable URL). Run multiple engines (Google+Yandex+Bing) and union —
they surface different results. No new key needed.

**Legal / tier / grade:** easy · legal. Grade **B / medium** (match is a lead; the matched page's grade applies
once scraped).

**Build sketch:** `reverseImage(imgUrl)` → SerpAPI across engines (parallel) → union `appears_on` (grade B) →
each URL enqueues scrape → cache by image hash **7d**.

## C3. Face search (PimEyes / FaceCheck.ID) 🔒(spicy/biometric, gated)
**What & why:** photo of a face → *other photos of the same person* across the web, even where the name isn't
attached. The single most powerful people-media pivot — and the most sensitive.

**Consumes:** `face image` → **Emits:** `depicts` matches → `url`s (→ context/identification).

| Source | Auth | Status |
|---|---|---|
| PimEyes / FaceCheck.ID | paid/keyed | biometric |

**Reliability / caveats & legal:** **biometric** — BIPA/GDPR Art.9; lawful only for permitted purposes.
**Gate: opt-in per run, human-confirm every match.** Grade **low** (predictive; confirm before asserting `depicts`).

**Build sketch:** `faceSearch(img)` — gated adapter, off by default → returns candidates for human confirmation →
only confirmed matches enter the graph (grade low → upgraded on confirmation).

## C4. Geocoding (Nominatim / OSM) ✅
**What & why:** address ↔ coordinates ↔ place name. The glue between textual locations and everything spatial.
**Consumes:** `address`/`place` ↔ `coordinates` → **Emits:** `located_at` lat/lon, normalized place, admin hierarchy.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **Nominatim** | `nominatim.openstreetmap.org/search?q={q}&format=json` | none (UA required) | 1 req/s | ✅ resolved GBuilding 41 |

**Output shape (real):** `[{display_name, lat, lon, boundingbox, type}]`. Probe: "1600 Amphitheatre Parkway" →
Google Building 41, 37.4225/-122.0856.

**Reliability / caveats:** **1 req/sec** hard limit + required User-Agent (self-host for volume). Grade **A / high**.
Cache **permanently** (geo is stable). Build: `geocode(q)` → Nominatim → emit `located_at`.

## C5. Map query (Overpass / OSM) ⚠️
**What & why:** "what's near these coordinates / find a place matching this description" — reverse the photo-geo
process (a photo shows a church + a specific tower → query OSM for that combination nearby). The core
**chronolocation/geolocation** tool.
**Consumes:** `coordinates`+features → **Emits:** nearby `place`/POI entities.
| Source | Endpoint | Auth | Status |
|---|---|---|---|
| Overpass API | `overpass-api.de/api/interpreter` (Overpass QL) | none | powerful, rate-limited |
**Legal / tier / grade:** normal · legal. Grade **A / high** (OSM data). Cache **7d**.

## C6. Chronolocation cross-ref (SunCalc + Open-Meteo) ✅
**What & why:** *verify or refute* a claimed time+place. Sun position (shadow direction/length via SunCalc) and
**historical weather** (was it 32°C and clear that day, matching the photo?) turn a photo into a checkable claim.

**Consumes:** `coordinates`+`datetime` → **Emits:** sun azimuth/elevation, historical weather → a
`consistent_with`/`contradicts` verdict on a claimed time+place.

| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| SunCalc | computation (library, no API) | none | — | deterministic |
| **Open-Meteo archive** | `archive-api.open-meteo.com/v1/archive?latitude=&longitude=&start_date=&end_date=&daily=…` | none | generous | ✅ tmax 32°C on probe |

**Output shape (real):** `daily.{time, weather_code, temperature_2m_max}`. Keyless historical weather back decades.

**Legal / tier / grade:** easy · legal. Grade **A / high** (physics + gov weather). Build: `chronocheck(lat,lon,dt)`
→ SunCalc + Open-Meteo → emit a corroboration/contradiction fact → cache **permanently**.

## C7. Aircraft tracking (OpenSky) ✅
**What & why:** who/what was flying — track a tail number or see aircraft over a place/time. Private-jet tracking
is a classic OSINT move (whose plane, where, when).
**Consumes:** `bbox`/`icao24`/`callsign` → **Emits:** flight tracks, `operated_by` hints.
| Source | Endpoint | Auth | Limit | Status |
|---|---|---|---|---|
| **OpenSky** | `opensky-network.org/api/states/all?lamin=&lomin=&lamax=&lomax=` | none (more w/ free acct) | **heavily rate-limited** | ✅ 8 aircraft in bbox |
**Output shape (real):** `states[]` = `[icao24, callsign, origin_country, …, lon, lat, alt, …]`. Probe: N174EM.
**Reliability / caveats:** free tier is very rate-limited (credits); live only (historical needs account). Grade **A**.

## C8–C10. Keyed / spicy geo (build after the free set)
- **Street-level imagery — Mapillary** (free key) / Google Street View (keyed): visual ground-truth of an address
  or a geolocated photo. Grade **A**.
- **Satellite/aerial — Sentinel Hub** (free tier) / Google Earth: overhead confirmation, change-over-time. Grade **A**.
- **Vessel tracking — MarineTraffic / AISHub** (keyed): ships by name/MMSI. Grade **A**.
- **AI geolocation — GeoSpy / Picarta** 🔒 (spicy): photo → predicted location by scene. Gate opt-in; grade **low**
  (predictive, human-confirm). Powerful when EXIF is stripped and no landmark is nameable.
- **Image/video forensics — FotoForensics / InVID / deepfake detectors:** is the media manipulated? Grade **C**
  (analytical signal).
- **WiGLE** (BSSID/SSID → location, grey): only if a network name/MAC ever surfaces.

## The media/geo pivot chain
```
photo
 ├─ EXIF ............. GPS→place, timestamp, device(serial→same-device cluster)   ✅A  (stripped by socials)
 ├─ reverse image .... other appearances → profiles/source (Google+Yandex+Bing)  ✅B  (our SerpAPI key)
 ├─ [gated] face ..... other photos of the SAME person → identification          🔒low
 └─ [gated] AI geo ... predicted location when no EXIF/landmark                   🔒low
coordinates (from EXIF / text / geocode)
 ├─ Nominatim ........ address↔coords↔place                                       ✅A
 ├─ Overpass ......... what's nearby / match a described scene                    ✅A
 ├─ Street/Satellite . visual ground-truth                                        (key)
 └─ + datetime → SunCalc + Open-Meteo → CORROBORATE/CONTRADICT the claim          ✅A
```
The magic here is **verification**, not just collection: a photo's claimed time+place becomes a physics-and-weather
check, and a face/username becomes another appearance to pull. Every emitted `url`/`location`/`person` re-enters
the wider graph.

## Build order for this cluster
1. **Free/verified first (✅):** EXIF (ExifTool), reverse image (SerpAPI — our key), Nominatim, Overpass,
   chronolocation (SunCalc + Open-Meteo), OpenSky. A full media-forensics + geo-verification kit with no new paid keys.
2. **One free key each:** Mapillary, Sentinel Hub.
3. **Spicy/gated (your call):** face search (PimEyes/FaceCheck), AI geolocation (GeoSpy/Picarta), MarineTraffic.

---

# Overall plan (across A / B / C)

**Sequencing** — build the free/verified backbone of all three clusters first (it's the bulk of the value and
needs no keys), then the one-free-key upgrades, then the gated/darker set behind your control:

1. **Wave 1 — free/keyless, live-verified (do first):** RDAP, DNS, CertTransparency, Wayback, urlscan(search),
   web-primitives · Gravatar, FEC, OpenAlex/ORCID, WhatsMyName · EXIF, reverse-image (SerpAPI), Nominatim,
   Overpass, chronolocation, OpenSky. → already a genuinely OP data-in layer, and the **Trump-domains benchmark**
   backbone.
2. **Wave 2 — one free/cheap key each:** urlscan(submit), IPinfo, VirusTotal(passive-DNS), certSpotter token ·
   Hunter, HIBP($4.39/mo), EmailRep, Twilio · Mapillary, Sentinel Hub.
3. **Wave 3 — gated / darker (your call, on-by-default for private use except the spiciest):** historical/reverse
   WHOIS, SecurityTrails, Shodan/Censys favicon-hash · people-search brokers, breach-record aggregators,
   enrichment · face search, AI geolocation, MarineTraffic.

**Cross-cutting infrastructure every adapter shares** (build once): per-source **rate-limit + throttle**,
**cache-first** (dedupe against Wayback/urlscan/our own cache before any live hit), **cost + tier + grade** stamped
on every fact, **gate** flag for restricted/spicy, and **pivot emission** (new typed values re-enter the queue).
This shared substrate is what turns 30 adapters into one chaining engine rather than 30 scripts.

**Build status (Wave 1 — done):** all keyless/our-key capabilities in the three clusters are **implemented and
tested** in `packages/acquire/src/capabilities/` (`domain.ts`, `people.ts`, `media.ts`), registered in the
`capabilities` table, and runnable via `wg cap <id> <input>`. Uniform `CapabilityResult` (entities/edges/
attributes/pivots + graded provenance). 46 parse tests + live smoke pass; keyed/gated adapters are scaffolded
(parse-tested) and light up when their key is added. Not yet wired: the auto-pivot chaining + graph write (the
processing phase).

**Honest open items / TODO surfaced during research (resolved ones struck):**
- ~~BGPView shape fix~~ → **resolved**: BGPView's DNS went unresolvable; A7 now uses RIPEstat (primary) + IPinfo.
- crt.sh unreliable → certSpotter primary (A3); reverse-IP CDN-gated (A6/A7 dependency).
- Free-tier quotas are the real constraint (Hunter 25/mo, HIBP paid, OpenSky credits, Nominatim 1/s, SerpAPI
  1000/mo) → aggressive caching is not optional, it's core.
- Name disambiguation (B6/B7) and CDN-sibling noise (A6) need explicit handling, not naive trust.

*All entries marked ✅ were verified with a live API call on 2026-09-01. This completes the first full pass across
the three clusters; refinement and the shared-adapter framework design come after review.*

---

# Cluster D — Organizations (built 2026-09-02)

The org backbone the arsenal lacked. Code: `packages/acquire/src/capabilities/org.ts`; tests:
`test/capabilities/org.test.ts`. Six keyless sources verified live; three keyed sources parse-tested against their
documented shapes and light up when the key is present. Input kind `org` (a company name, or a native id — CIK /
LEI / Q-id / EIN / company number); Wikidata, court, sanctions and OpenCorporates also take `name` (a person).

| Id | Source | Auth | Consumes → Emits | Grade | Verified |
|---|---|---|---|---|---|
| `org.edgar` | SEC EDGAR (`data.sec.gov/submissions`, `company_tickers.json`, company browser HTML) | none (UA with contact: `SEC_CONTACT_EMAIL`) | org → profile (CIK/EIN/SIC/state/HQ/tickers), `formerly_known_as`, notable `filed` edges (10-K/8-K/S-1/DEF 14A/13D/D…) + per-form counts, `domain` pivot | A | ✅ live |
| `org.gleif` | GLEIF LEI API (`api.gleif.org/api/v1`) | none | org/LEI → LEI, jurisdiction, registry number, legal form, addresses, `subsidiary_of` / `ultimately_owned_by` (parents), children (first 50) → `org` pivots | A | ✅ live |
| `org.wikidata` | Wikidata (`wbsearchentities`, `wbgetentities`, SPARQL for label + instance-of) | none | org **or person** → `founded_by`, `led_by`, `chaired_by`, `board_member`, `subsidiary_of`, `owned_by`, `owns`, `works_at`, `educated_at`, `spouse_of`, `member_of`, `headquartered_in`… with P580/P582 dates; attributes (founded, website, employees, revenue, ids: LEI/CIK/EIN/Companies House/ORCID, socials) → `name`/`org`/`domain`/`username` pivots | B | ✅ live |
| `org.nonprofit` | ProPublica Nonprofit Explorer (IRS 990) | none | org/EIN → EIN, 501(c) status, NTEE, ruling date, per-year revenue/expenses/assets/officer comp, 990 PDF `url` pivots | A | ✅ live |
| `org.usaspending` | USAspending.gov (`spending_by_award`, contracts + grants fetched separately) | none | org → `awarded_contract_by` per agency (aggregated count/total/span), top-5 `holds_contract` with award ids + URLs, agency `part_of` tree, sibling recipients | A | ✅ live |
| `org.court` | CourtListener v4 search (RECAP dockets + opinions) | none (`COURTLISTENER_TOKEN` lifts limits) | org/name → `party_to` legal cases (court/docket/nature/url), `co_litigant` (sides unknown — RECAP lists parties flat), `counsel_in` (firms) | A | ✅ live |
| `org.companies_house` | Companies House (UK) | free key `COMPANIES_HOUSE_API_KEY` | org/number → profile, `officer_of` (role/dates/DOB-month/nationality), `controls` (PSC + nature), `formerly_known_as` → `name`/`org` pivots | A | parse-tested |
| `org.opencorporates` | OpenCorporates v0.4 | `OPENCORPORATES_API_TOKEN` | org → registry profile + officers; `--mode officer`: **person → every company they officer** (the shell-network pivot) | A | parse-tested |
| `org.sanctions` | OpenSanctions `/search/default` | `OPENSANCTIONS_API_KEY` (free non-commercial) | org/name → `listed_in` datasets, `risk_topic` (sanction / role.pep / crime…), DOB / nationality / position | A | parse-tested |

**Findings from the live probe:** EDGAR full-text search (`efts.sec.gov`) is 403 for non-browser clients and the
Atom company feed returns `ARRAY(0x…)` for names (server bug) — the HTML company browser works and covers private
filers/funds/insiders. `cik_lookup` returns 0 hits for everything. OpenCorporates and OpenSanctions both now
require an API key even for search. GLEIF's `filter[fulltext]` is the right search (legalName filter is loose).
USAspending refuses mixed award groups in one request. CourtListener's `q` is full-text — the parser keeps only
cases whose caption or party list names the subject.

**Decisions taken while building (override if you disagree):**
- **Recurring-identical aggregation (HANDOFF §5.4) implemented** as `aggregateRecurring()` in `types.ts`: ≥3
  dated numeric edges with the same subject/predicate/object collapse into one edge (from→to, value = total,
  qualifiers count/total/first/last). Applied to FEC donations and USAspending task orders. Singletons verbatim.
- **Vocabulary (HANDOFF §5.3)** — new predicates: `formerly_known_as`, `filed`, `subsidiary_of`,
  `ultimately_owned_by`, `founded_by`, `led_by`, `chaired_by`, `board_member`, `owned_by`, `owns`,
  `headquartered_in`, `awarded_contract_by`, `holds_contract`, `part_of`, `party_to`, `co_litigant`,
  `counsel_in`, `officer_of`, `controls`, `listed_in`. New entity types/kinds: `legal_case`,
  `organization/public_company|nonprofit|government_agency|law_firm`, `place`, `concept`.
- **Pivot kind `org`** added (an organization name to look up), distinct from `name` (a person).
- Wikidata entity types follow the *item* (P31 human → person) not the property, via one SPARQL call per lookup.

**Not built (declared for later):** OpenOwnership (bulk only, no search API), OCCRP Aleph (keyed), INSEE Sirene
(FR registry, keyed), LittleSis, Crunchbase (paid), EDGAR insider → issuer resolution (Form 4 XML per filing).
