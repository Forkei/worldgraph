# Search playbook

How to search like a professional investigator. Served to the agent section by section through `consult_playbook`.
Sources: Google's operator documentation as summarized by Google Guide; SE Ranking, Kinsta and Symphonic operator
references (2025–2026); SEOSLY's Yandex and Bing operator lists; the Compass Security OSINT cheat sheet;
X-Ray's OSINT dork guide; SerpApi's pagination reference. Written 2026-09-02.

## principles

- A search is an experiment. Decide what a hit would look like before you run it, then judge the results against
  that. If page 1 has nothing, that is a result too: record it and change the query, don't repeat it.
- Go past page 1. Investigators live on pages 2–5, where the noise of big sites thins out. The `search` tool takes
  a `page` argument; walk pages until two consecutive pages add nothing new.
- Narrow with operators, widen with synonyms. An exact name in quotes plus one discriminating term beats a long
  natural-language query. When a person has a common name, add the anchor you already know (city, employer,
  handle, year) rather than more words.
- Rotate engines. Google, Bing, DuckDuckGo, Yandex and Yahoo index different things and rank differently. Yandex
  is strong for images, Russian/CIS content and for names Google suppresses; Bing indexes forums and older
  pages Google has dropped; Exa is semantic and finds pages that never contain your exact words.
- Every identifier is a new query: a handle, an email, a phone, a domain, an address, a licence number, a
  registry id. Search each one alone, in quotes, across engines.
- Log what you tried. A query that returned nothing is evidence of absence only if it was the right query.

## google operators

Syntax rules: no space after the colon (`site:example.com`, not `site: example.com`). `OR` and `AROUND` must be
uppercase. Combine freely except `allintitle:`, `allinurl:`, `allintext:`, `allinanchor:` which must stand alone.
Deprecated and no longer working: `link:`, `info:`, `+`, `~`, and `cache:` (gone 2024). `num=100` was disabled
in September 2025, so page through instead.

| operator | meaning | example |
|---|---|---|
| `"exact phrase"` | the words in that order | `"Alex Sample"` |
| `-term` / `-site:` | exclude | `"Example Realm" -minecraft` |
| `OR` / `|` | either | `"J. Doe" OR "John Doe"` |
| `*` | wildcard word | `"John * Doe"` |
| `site:` | one domain or TLD | `site:linkedin.com/in "Jane Doe"` |
| `inurl:` / `allinurl:` | word in the URL | `inurl:profile "jdoe"` |
| `intitle:` / `allintitle:` | word in the title | `intitle:"curriculum vitae" "Jane Doe"` |
| `intext:` / `allintext:` | word in the body | `intext:"jane.doe@"` |
| `inanchor:` | word in link text pointing at the page | `inanchor:"jane doe"` |
| `filetype:` / `ext:` | document type | `"Jane Doe" filetype:pdf` |
| `AROUND(n)` | words within n of each other | `"Doe" AROUND(3) "Acme"` |
| `before:` / `after:` | date bounds (YYYY-MM-DD) | `"Acme Corp" after:2024-01-01` |
| `related:` | similar sites | `related:example.com` |
| `define:` | definitions | `define:mime` |
| `source:` / `location:` | Google News only | `"Acme" source:reuters` |

## other engines

- **Bing**: `contains:pdf` (pages linking to a file type), `ip:1.2.3.4` (sites hosted on an IP — a reverse-IP
  lookup Google does not have), `inbody:`, `inanchor:`, `intitle:`, `url:` (is this exact URL indexed),
  `loc:gb` (country), `language:fr`, `prefer:`, `feed:` / `hasfeed:`. `NOT` and `OR` uppercase, no space after
  the colon.
- **Yandex**: `"exact"`, `|` for OR, `*` wildcard, `+word` mandatory, `site:`, `host:` (exact host), `rhost:`
  (reverse host, e.g. `rhost:com.example.*` for all subdomains), `url:`, `title:`, `mime:pdf` (= filetype),
  `lang:en`, `date:20240101..20241231`. Best for images, Cyrillic content, and names de-ranked elsewhere.
- **DuckDuckGo**: `"exact"`, `-`, `site:`, `intitle:`, `inurl:`, `filetype:`, region via `region:` in the UI;
  `!bangs` jump to another site's own search (`!gh jdoe` = GitHub search). Little personalization, useful
  second opinion.
- **Yahoo**: Bing's index with its own ranking; the same operators mostly work.
- **Exa**: describe the page you want in a sentence ("personal blog of a Minecraft server admin in the UK who
  mentions Example Realm"); it embeds the query and returns pages by meaning. Use `includeDomains` to scope.

## patterns by target

**Person by name**
- `"First Last"` alone, then with each anchor: `"First Last" "City"`, `"First Last" "Employer"`, `"First Last" "handle"`.
- Documents: `"First Last" filetype:pdf OR filetype:docx OR filetype:xlsx` (rosters, minutes, CVs, court exhibits).
- Profiles: `site:linkedin.com/in "First Last"`, `site:facebook.com "First Last"`, `site:instagram.com "First Last"`,
  `site:github.com "First Last"`, `site:x.com OR site:twitter.com "First Last"`.
- Name variants: initials (`"F. Last"`), reversed (`"Last, First"`), maiden/married, transliterations.
  Search each; a hit on one variant is a lead for the others.
- Negative space: `"First Last" -site:linkedin.com -site:facebook.com` to see what remains once the big
  platforms are removed.

**Username / handle**
- `"handle"` in quotes across all engines; `"@handle"`; `inurl:handle`; `site:github.com "handle"`,
  `site:reddit.com/user/handle`, `site:youtube.com "@handle"`, `site:twitch.tv/handle`, `site:itch.io "handle"`,
  `site:namemc.com handle` (Minecraft), `site:steamcommunity.com "handle"`.
- Variants: handle + digits, handle with/without underscore or dot, handle + "s". People reuse handles with
  small changes; the `people.username` capability probes 700+ sites but only for the exact string.

**Email**
- `"user@domain.com"`; `"user@domain"` without the TLD; `"user" "@domain.com"`; `intext:"user@domain.com"`.
- Pattern discovery: `"@domain.com" filetype:pdf`, `"@domain.com" -site:domain.com` to see who else publishes
  addresses at that domain (the `people.email_pattern` capability does this with Hunter when keyed).
- Pastes and leaks: `"user@domain.com" site:pastebin.com OR site:ghostbin.com OR site:throwbin.io`.

**Phone**
- All formats: `"+44 7700 900123"`, `"07700 900123"`, `"07700900123"`, `"7700900123"`. Phones appear on
  classifieds, business listings, PDFs, and WHOIS history.

**Company / organization**
- `"Acme Ltd"`, `"Acme Limited"`, `"Acme"` + the registry number; `site:find-and-update.company-information.service.gov.uk "Acme"`
  (UK), `site:sec.gov "Acme"` (US filings), `site:opencorporates.com "Acme"`.
- People: `"Acme" ("director" OR "founder" OR "CEO" OR "owner")`, `site:linkedin.com "Acme" "director"`.
- Documents: `"Acme" filetype:pdf (annual OR report OR accounts OR contract OR invoice)`.
- Money and trouble: `"Acme" (lawsuit OR "v." OR complaint OR fraud OR scam OR "trustpilot" OR "reviews")`.

**Domain / website**
- `site:domain.com` (what is indexed), `site:domain.com filetype:pdf`, `site:*.domain.com -site:www.domain.com`
  (subdomains), `"domain.com" -site:domain.com` (who mentions it), `inurl:domain.com`, `intext:"domain.com"`.
- History: search the domain with `before:` bounds; use the `infra.wayback` capability for actual snapshots.
- Bing `ip:` for co-hosted sites; Yandex `rhost:` for subdomains.
- Ownership: `"domain.com" ("registrant" OR "whois" OR "owner" OR "admin")`, and the site's own
  `/about`, `/contact`, `/terms`, `/privacy`, `/impressum` pages (legal pages name the operating entity).

**Gaming / community sites** (server lists, Discord, forums)
- `"Server Name" site:minecraft-server-list.com OR site:minecraftservers.org OR site:minecraft.buzz OR site:topminecraftservers.org OR site:minelist.io`
- `"Server Name" site:reddit.com`, `"Server Name" discord`, `"Server Name" "owner" OR "admin" OR "staff"`.
- Discord invites resolve to a server id and name; the invite page names the community and sometimes the owner.

**Documents and leaks**
- `filetype:pdf OR filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx OR filetype:ppt OR filetype:csv OR filetype:txt`
- `intitle:"index of"` + a name for open directories; `filetype:sql` / `filetype:log` / `filetype:env` for
  exposed data (reading only — never act on credentials).

## strategy

1. Start with the seed alone, exact, across Google, Bing and DuckDuckGo. Read page 1 and 2.
2. Harvest identifiers from what you read: handles, emails, phones, domains, names of people and orgs. Each
   becomes its own query set.
3. For each new identifier, run the pattern set above. Prefer the identifier over the name: an email or handle is
   unambiguous, a name is not.
4. When results are dominated by one big site, exclude it and look again.
5. When Google is silent, try Yandex and Bing before concluding absence.
6. Use Exa when you can describe the page you want but not its words.
7. Record every query and its yield in your notebook; the next investigator (or you, later) must know what was
   already tried.

## judging results

- The snippet is not the page. Read pages that look relevant; don't cite snippets.
- Rank by publisher: an official registry or the subject's own page over a news article over an aggregator over a
  people-search site. The graph grades by exactly this ladder.
- A directory or aggregator page (people-search, business listing) is a lead to the primary source, not a source.
- Two different pages copying the same sentence are one origin, not two.
