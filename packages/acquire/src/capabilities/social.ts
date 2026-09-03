// Cluster E — Social. Profiles are corpora, not pages: a handle fans out into bio, posts, captions, tagged
// users, locations and comments. Service-first (research/19): we call Apify actors (one APIFY_TOKEN) rather
// than driving a browser, so no account of the user's is ever involved. Post image URLs are surfaced as
// `image` pivots for the vision tool (look_at) to read — that is how a photo becomes evidence.
// Each runner is a pure parse fn (unit-tested against captured Apify shapes) + an async runner that calls Apify.
import { postJson } from "./http.ts";
import { type CapabilityResult, type CapProvenance, dedupePivots, emptyResult } from "./types.ts";

const now = () => new Date().toISOString();
const APIFY = "https://api.apify.com/v2/acts";
const igToken = () => process.env.APIFY_TOKEN;

/** Run an Apify actor synchronously and return its dataset items. */
async function runActor<T>(actor: string, input: unknown): Promise<T[]> {
  const token = igToken();
  if (!token) throw new Error("social.* needs APIFY_TOKEN (Apify free tier). No token = capability off.");
  const url = `${APIFY}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  // Apify runs can take a while; give it room. It returns the dataset items array directly.
  const items = await postJson<T[]>(url, input, { rateKey: "api.apify.com", minIntervalMs: 1000, timeoutMs: 180_000 });
  return Array.isArray(items) ? items : [];
}

// ---------------------------------------------------------------------------
// E1. Instagram profile (details) — bio, links, counts, latest posts
// ---------------------------------------------------------------------------
export interface IgProfile {
  username?: string; fullName?: string; biography?: string; externalUrl?: string; externalUrls?: { url?: string }[];
  followersCount?: number; followsCount?: number; postsCount?: number; verified?: boolean; private?: boolean;
  profilePicUrl?: string; profilePicUrlHD?: string; businessCategoryName?: string;
  latestPosts?: IgPost[]; relatedProfiles?: { username?: string }[];
}

export function parseIgProfile(items: IgProfile[], username: string): CapabilityResult {
  const prov: CapProvenance = { capability: "social.ig_profile", source: "Instagram (Apify)", fetched_at: now(), grade: "B", tier: "normal" };
  const r = emptyResult(prov);
  r.raw = items?.[0];
  const p = items?.[0];
  if (!p?.username) { prov.note = `no public Instagram profile for @${username}`; return r; }
  const handle = p.username;
  r.entities.push({ type: "instagram", name: handle, hints: p.fullName ? { display_name: p.fullName } : undefined });
  if (p.fullName) { r.attributes.push({ entity: handle, key: "display_name", value: p.fullName }); r.pivots.push({ kind: "name", value: p.fullName }); }
  if (p.biography) r.attributes.push({ entity: handle, key: "bio", value: p.biography.slice(0, 500) });
  if (p.private) r.attributes.push({ entity: handle, key: "private", value: "true" });
  if (p.verified) r.attributes.push({ entity: handle, key: "verified", value: "true" });
  if (p.businessCategoryName) r.attributes.push({ entity: handle, key: "category", value: p.businessCategoryName });
  for (const k of ["followersCount", "followsCount", "postsCount"] as const) if (typeof p[k] === "number") r.attributes.push({ entity: handle, key: k.replace("Count", "").replace("follows", "following"), value: String(p[k]) });
  const links = [p.externalUrl, ...(p.externalUrls ?? []).map((u) => u.url)].filter((x): x is string => !!x);
  for (const l of [...new Set(links)]) { r.edges.push({ subject: handle, predicate: "links_to", object: l }); r.pivots.push({ kind: "url", value: l }); }
  const pic = p.profilePicUrlHD || p.profilePicUrl;
  if (pic) r.pivots.push({ kind: "image", value: pic }); // look_at the profile photo
  // extract handles mentioned in the bio (@someone) as leads
  for (const m of (p.biography ?? "").matchAll(/@([a-zA-Z0-9._]{2,30})/g)) r.pivots.push({ kind: "username", value: m[1]! });
  // latest posts, if the details actor returned them: surface captions + image + tagged as leads
  for (const post of (p.latestPosts ?? []).slice(0, 12)) mergePostLeads(r, handle, post);
  r.pivots = dedupePivots(r.pivots);
  return r;
}

// ---------------------------------------------------------------------------
// E2. Instagram posts — caption, images (→ vision), tagged users, location
// ---------------------------------------------------------------------------
export interface IgPost {
  url?: string; shortCode?: string; caption?: string; timestamp?: string; type?: string;
  likesCount?: number; commentsCount?: number; displayUrl?: string; images?: string[];
  taggedUsers?: { username?: string; full_name?: string }[]; locationName?: string; locationId?: string;
  ownerUsername?: string; mentions?: string[]; hashtags?: string[];
}

/** fold one post's leads (images, tagged users, location, mentions) into a result anchored on `handle`. */
function mergePostLeads(r: CapabilityResult, handle: string, post: IgPost): void {
  const imgs = [post.displayUrl, ...(post.images ?? [])].filter((x): x is string => !!x);
  for (const img of [...new Set(imgs)]) r.pivots.push({ kind: "image", value: img }); // each image is a look_at lead
  for (const t of post.taggedUsers ?? []) if (t.username) {
    r.edges.push({ subject: handle, predicate: "tagged_with", object: t.username, qualifiers: post.url ? { post: post.url } : undefined });
    r.pivots.push({ kind: "username", value: t.username });
    if (t.full_name) r.pivots.push({ kind: "name", value: t.full_name });
  }
  for (const m of post.mentions ?? []) r.pivots.push({ kind: "username", value: m.replace(/^@/, "") });
  if (post.locationName) { r.entities.push({ type: "place", name: post.locationName }); r.edges.push({ subject: handle, predicate: "posted_from", object: post.locationName, at: post.timestamp }); }
}

export function parseIgPosts(items: IgPost[], username: string): CapabilityResult {
  const prov: CapProvenance = { capability: "social.ig_posts", source: "Instagram (Apify)", fetched_at: now(), grade: "B", tier: "normal", note: "captions/tagged users are self-authored; verify before trusting" };
  const r = emptyResult(prov);
  r.raw = { count: items?.length, sample: (items ?? []).slice(0, 2) };
  if (!items?.length) { prov.note = `no posts returned for @${username}`; return r; }
  r.entities.push({ type: "instagram", name: username });
  for (const post of items) {
    mergePostLeads(r, username, post);
    if (post.caption) r.attributes.push({ entity: username, key: "post_caption", value: (post.url ? `[${post.url}] ` : "") + post.caption.slice(0, 400), at: post.timestamp });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

// ---------------------------------------------------------------------------
// E3. Instagram comments — commenter handles (the richest real-name source)
// ---------------------------------------------------------------------------
export interface IgComment { ownerUsername?: string; text?: string; timestamp?: string; likesCount?: number; owner?: { username?: string; full_name?: string } }

export function parseIgComments(items: IgComment[], postUrl: string): CapabilityResult {
  const prov: CapProvenance = { capability: "social.ig_comments", source: "Instagram (Apify)", fetched_at: now(), grade: "C", tier: "normal", note: "commenters are the public; a comment is not an association on its own" };
  const r = emptyResult(prov);
  r.raw = { count: items?.length, sample: (items ?? []).slice(0, 3) };
  if (!items?.length) { prov.note = "no comments returned"; return r; }
  for (const c of items) {
    const u = c.ownerUsername || c.owner?.username;
    if (!u) continue;
    r.pivots.push({ kind: "username", value: u });
    if (c.owner?.full_name) r.pivots.push({ kind: "name", value: c.owner.full_name });
    // surface @-mentions inside comment text — people tagging others by name
    for (const m of (c.text ?? "").matchAll(/@([a-zA-Z0-9._]{2,30})/g)) r.pivots.push({ kind: "username", value: m[1]! });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------
const IG_SCRAPER = "apify~instagram-scraper";

export async function igProfile(username: string): Promise<CapabilityResult> {
  const u = username.replace(/^@/, "").trim();
  const items = await runActor<IgProfile>(IG_SCRAPER, { directUrls: [`https://www.instagram.com/${u}/`], resultsType: "details", resultsLimit: 1 });
  const r = parseIgProfile(items, u);
  r.provenance.url = `https://www.instagram.com/${u}/`;
  return r;
}

export async function igPosts(username: string, limit = 30): Promise<CapabilityResult> {
  const u = username.replace(/^@/, "").trim();
  const items = await runActor<IgPost>(IG_SCRAPER, { directUrls: [`https://www.instagram.com/${u}/`], resultsType: "posts", resultsLimit: limit });
  const r = parseIgPosts(items, u);
  r.provenance.url = `https://www.instagram.com/${u}/`;
  return r;
}

export async function igComments(postUrl: string, limit = 50): Promise<CapabilityResult> {
  const items = await runActor<IgComment>(IG_SCRAPER, { directUrls: [postUrl], resultsType: "comments", resultsLimit: limit });
  const r = parseIgComments(items, postUrl);
  r.provenance.url = postUrl;
  return r;
}
