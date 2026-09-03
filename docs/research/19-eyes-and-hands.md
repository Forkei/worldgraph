# 19 — Eyes and hands: what the investigator needs to do a human-grade social dive

Trigger: a manual Instagram pass on a Minecraft acquaintance yielded brother + name, surname confirmation,
great-grandmother, dog, passions, events, a placeable photo of a real location. The agent's run: 19 entities,
20 links, 9 sources. Diagnosis (chat of 2026-09-03): the agent is text-only, anonymous, and treats a profile
as one page. Reasoning is not the bottleneck yet. Below are the concrete fixes, in build order.

Status: DESIGN. Nothing here is built. Estimates are autonomous agent-work days.

---

## F1. Driven browser (hands) — packages/acquire/src/browser.ts

Playwright (chromium) with a **persistent context** at `~/.worldgraph/browser/<profile>`. The maintainer logs in once
per platform with `wg browser login <platform>` (opens headed, waits, saves cookies). Use a separate browsing
account per platform for the agent; never the personal one.

Agent tools (all return one `BrowsePage` shape: current url, title, trimmed visible text, numbered link table,
`images[]` {url, alt, w, h}, `shot` = screenshot source id):

| tool | input | notes |
|---|---|---|
| `browse_open` | url | navigates; waits network-idle; dismisses common cookie/login modals |
| `browse_act` | action ∈ scroll/click/type/back/wait, target (link number, visible text, or css), text?, n? | scroll n screens; click by visible text first |
| `browse_shot` | region? | screenshot → stored as an image source; feeds `look_at` (F2) |
| `browse_find` | text | scroll until text visible (feeds, long pages) |

Every `browse_*` call upserts a **source row** (kind `browser`, url = current url, raw = DOM snapshot,
rendered = screenshot blob) so `contribute`, citations and `why` work unchanged. Text goes through the same
`extractClaimsOnly` staging as `read_url`.

`fetchUrl` gains a 4th cascade step: if the host is in `WALLED_HOSTS` (instagram, facebook, tiktok, x, linkedin,
threads, discord, snapchat) or text < MIN_TEXT after archive, use the browser (headless) with the persistent
profile. `read_url` then just works on a public IG post.

Hygiene: per-host `minIntervalMs` 3–6 s with jitter, per-host daily cap (env `BROWSER_DAILY_CAP`, default 300
navigations), human-ish scroll pacing, one tab at a time. Every navigation logged in `actions` for dedupe and
audit.

Deps: `playwright` in packages/acquire; `pnpm exec playwright install chromium`. Effort: 2–3 days.

## F2. Vision (eyes) — packages/acquire/src/vision.ts + look_at tool

1. **Surface images.** `FetchResult.images: ImageRef[]` (src, alt, caption from nearest figcaption/aria, w×h,
   og:image flagged). Populated by `viaHttp` (linkedom), Firecrawl (markdown image refs), and the browser
   (visible `<img>` ≥ 200 px). `read_url` summary appends `images: 12 (look_at to see one)` and lists the first
   8 with alt text.
2. **`look_at(image | shot, question?)`** downloads (or reuses the screenshot blob), stores the blob, sends it
   to the vision model, returns a structured description:
   `{scene, text_in_image[], people[{apparent_age, apparent_sex, role_guess, description}], animals[],
   objects[], place_cues[], time_cues[], relationships_guess, answer_to_question}`.
   Description + page caption then run through `extractClaimsOnly` as a **source of kind `image`**, so the
   agent gets numbered candidate claims and contributes them like any page. The photo is the evidence; the UI
   evidence sheet shows the thumbnail (F7).
3. **`look_at_many(images[], question)`** batched, cheap model, one line per image; for triaging a feed of 200
   thumbnails before choosing which to open.
4. Auto-chain: on download, run `media.exif` on the original when the host doesn't strip metadata (most sites
   other than the big social apps); offer `media.reverse_image` as a pivot on the result.

Model: Gemini Flash by default (cheap, good OCR); `deps.models.vision` overridable. Cost ≈ $0.001–0.003 per
image. Effort: 1 day (0.5 images-in-read_url, 0.5 look_at + source kind).

## F3. Feed enumeration — packages/acquire/src/capabilities/social.ts (Cluster E)

Profiles are corpora. **Service-first** (decided 2026-09-03): a provider layer behind each capability, the
browser (F1) only as fallback for private accounts the agent's own account follows.

| platform | primary | notes |
|---|---|---|
| Instagram | **HikerAPI** (private-API-as-a-service; profile, posts, comments, followers/following ×100 per call, stories, highlights, tagged; ~$0.001/req) | alt: **Apify** actors (profile/posts/comments/followers/tagged; ~$2–3 per 1k items, ~$5–10 per full dive) |
| LinkedIn | **Bright Data** profile + company scrapers/datasets (~$1.5 per 1k records; won Meta v. Bright Data on logged-out scraping) | enrichment without touching LinkedIn: **People Data Labs** (already on the keys list). Proxycurl is gone (2025). |
| TikTok / X | Apify actors | |
| long tail | ScrapingBee / Zyte / Bright Data Web Unlocker (JS render + residential proxies) | public post pages, occasional logged-out LinkedIn profile |
| last resort | public mirrors (Picuki/Imginn) | blocked often; never the plan |

No service reaches a **private** account: its posts, followers and tagged photos show only to an account that
follows it. That is the one case for F1's logged-in profile. All providers return `CapabilityResult`, so
pivots and provenance flow through `capabilityToExtraction` unchanged; provider name and cost go in provenance.

| capability | consumes | yields |
|---|---|---|
| `social.profile` | username + platform | bio, external link, counts, profile pic (image ref), post list (id, date, caption head, first image, like/comment counts) |
| `social.post` | post url | caption, all images, tagged users (→ username pivots), location tag (→ place entity), top-N comments {handle, text} (→ username pivots) |
| `social.followers` / `social.following` | username, limit | handles + display names (display names → name pivots) |
| `social.mutuals` | a, b | intersection of two follower sets: the family/friend confirmation move |
| `social.tagged` | username | posts by others tagging the subject (richest source of real names) |
| `social.highlights` | username | story highlight titles + covers |

Instagram first, then TikTok and X. Each capability records navigations as actions and respects F1's caps.
Effort: 2 days for IG, 1 day per additional platform.

## F4. Gamer-persona sources — packages/acquire/src/capabilities/gaming.ts

Minecraft handles are the seed here. Keyless or easy: **NameMC** (name history, skins, server list, linked
accounts), **Mojang API** (uuid ↔ name), **Hypixel API** (free key) for stats, guild, social links,
**Steam** (free key; profile, friends list if public, groups), **Twitch/YouTube** about pages (links, emails),
**Discord** invite/server lookup (public servers only; user-id resolution stays gated). Each yields
`username`/`name`/`url` pivots. Effort: 1 day.

## F5. Playbooks — docs/playbooks/

Four new consultable topics, written like `search.md` (steps, what to look for, what counts as confirmation,
traps):

- `persona/gamer-handle`: NameMC → Discord servers → YouTube/Twitch → Instagram/TikTok → real name.
- `social/instagram-dive`: profile → highlights → tagged → last 50 posts → comments → mutuals → family tree.
- `media/photo-geolocation`: text in image, signage, plates, storefronts, vegetation, sun, architecture →
  search to confirm → never assert a home address; assert a locality with a grade.
- `people/family-map`: sibling from tagged photos → surname confirmation → parents → hometown → school.

Effort: 0.5 day.

## F6. Curiosity policy and the stopping bar

Symptom: the agent stops when *queries* dry up; a human stops when *unopened entities* dry up.

1. **Lead ledger** (`leads` table: investigation_id, kind ∈ entity/url/query, ref, why, value ∈ H/M/L, cost,
   status ∈ open/done/dropped, added_by, note). Tools: `lead_add`, `leads`, `lead_done(reason)`. The ASSESS
   step of the chat rhythm must end with an explicit ledger update.
2. **`graph_gaps` gains "unopened"**: entities with ≥1 link and 0 sources about them directly (never searched,
   never read), ranked by degree and proximity to the seed. Accounts with a profile but no posts read are
   listed separately.
3. **Stopping bar rewritten** (`investigator/stopping`): no open H lead; every person within one hop of the
   subject opened; every account has profile + tagged + a page of posts read; every image on the subject's
   own posts looked at or triaged with `look_at_many`. The dollar ceiling stays the only hard cap.
4. Prompt nudge in `chatSystem`: before finishing, list the three most valuable unopened leads; finish only if
   each is worth less than its cost.

Effort: 1 day.

## F7. Model tiering and graph/UI additions

- `deps.models = { planner, reader, vision, judge }`. Planner (ASSESS + chat replies) on a stronger model
  (Sonnet high / Opus); reader (per-page extraction, look_at_many) on Flash/Haiku. `wg eval` gains a social
  case. Effort: 1 day incl. eval.
- Source kind `image` with thumbnail in the evidence sheet and the export page; `place` entities carry
  lat/lon and a map link; claims contributed from a `look_at` carry support `vision`, so grades discount them
  until corroborated.

## F8. Gated (the maintainer's call, off by default)

Face search (PimEyes, FaceCheck) is declared in `GATED_MEDIA`. It is the single largest unlock for family and
friends and the single largest legal exposure (BIPA, GDPR biometric rules). Not wired until explicitly enabled.

---

## Build order and totals

| step | unlocks | days |
|---|---|---|
| F1 browser + F2 vision | anything walled; photos as evidence | 3–4 |
| F3 social (Instagram) | posts, comments, tagged, mutuals | 2 |
| F5 playbooks | the human's method, consultable | 0.5 |
| F6 leads + stopping | agent stops on unopened leads, not dry queries | 1 |
| F4 gaming sources | the Minecraft seed path | 1 |
| F7 tiering + eval | better planning at the same cost | 1 |

≈ 9 agent-days. Needs from the maintainer: keys for HikerAPI (or Apify) and Bright Data; People Data Labs key
(already listed); optional Hypixel/Steam keys; a logged-in browser profile only if private accounts matter;
decision on F8.
