// Markdown is the canonical text (model v0.3 §1.2): exactly what the reading agent sees. We do NOT convert to
// plain text. The only transform is footnoting inline links — `[anchor](url)` → `[anchor][n]` — so the text a
// model reads is compact while the navigable link table is kept beside the source. Deterministic; loss-free
// (every URL survives in the table). Everything else about the markdown (tables, headings, lists) is untouched.

export interface LinkRef { n: number; anchor: string; url: string }
export interface Footnoted { text: string; links: LinkRef[] }

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Rewrite inline and reference links to numbered footnote refs, returning the rewritten markdown and the link
 * table. Image links (`![alt](url)`) are dropped to a bare alt. Bare autolinks `<http…>` and `[ref]: url`
 * definition lines are folded into the table too. URLs are de-duplicated: the same URL always gets one number.
 */
export function footnoteLinks(md: string): Footnoted {
  let t = md.replace(/\r\n?/g, "\n");
  const byUrl = new Map<string, number>();
  const links: LinkRef[] = [];
  const ref = (anchor: string, url: string): number => {
    const u = url.trim();
    let n = byUrl.get(u);
    if (n === undefined) { n = links.length + 1; byUrl.set(u, n); links.push({ n, anchor: clean(anchor) || u, url: u }); }
    return n;
  };
  // images first: keep the alt text, drop the link
  t = t.replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (_m, alt) => (clean(alt) ? clean(alt) + " " : ""));
  // collect reference definitions ([id]: url) so [text][id] can resolve, then strip the definition lines
  const defs = new Map<string, string>();
  t = t.replace(/^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(\S+).*$/gm, (_m, id, url) => { defs.set(String(id).toLowerCase(), url); return ""; });
  // inline links [text](url "title")
  t = t.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text, url) => `[${text}][${ref(text, url)}]`);
  // reference links [text][id] and shortcut [text][]
  t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text, id) => {
    const url = defs.get(String(id || text).toLowerCase());
    return url ? `[${text}][${ref(text, url)}]` : m;
  });
  // bare autolinks <https://…>
  t = t.replace(/<((?:https?|mailto):[^>\s]+)>/gi, (_m, url) => `[${url}][${ref(url, url)}]`);
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return { text: t, links };
}

// Boilerplate trimming (cost + quality): strip page chrome that survives Firecrawl's onlyMainContent — nav
// menus, "related/recommended" blocks, reference/see-also/external-links sections, newsletter/cookie/share
// CTAs, comment sections. Conservative: only clear boilerplate; real content is never touched. Cuts extraction
// input tokens (and removes noise that produces junk entities like headlines/related-article titles).
const SKIP_HEADING = /^\s{0,3}#{1,6}\s*(references?|see also|external links?|further reading|related( (articles?|stories|posts|content|reading))?|recommended|more (from|stories|articles|on)|you (might|may)( also)? (like|enjoy)|newsletter|subscribe|sign ?up|advertisements?|sponsored|comments?|footer|navigation|share (this|article)?|follow us|trending|most (read|popular)|popular (now|posts|stories)|latest (news|posts|stories)|categories|tags|archives?|sitemap|legal|privacy( policy)?|terms( of (use|service))?|contact us|about us|explore|discover|read more|editor'?s picks?|top stories|around the web|from around the web|promoted( stories| links| content)?|elsewhere on|in this (article|section)|table of contents|cite this)\b/i;
const LINE_JUNK = /^\s*(cookies?|we use cookies|accept( all)? cookies|manage (cookies|preferences)|sign up (for|to)|subscribe to|get the (newsletter|app)|download the app|follow us on|share (on|this)|©|copyright|all rights reserved|advertisement|sponsored|skip to (content|main)|menu|log ?in|sign ?in|register|created with|powered by|back to top)\b/i;
const isLinkOnly = (l: string) => /^\s*[-*+]?\s*\[[^\]]*\](\[[^\]]*\]|\([^)]*\))\s*$/.test(l);

export function trimBoilerplate(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let skipDepth = 0;                 // >0 = inside a skip section, value = the heading level to break out of
  let linkRun = 0;
  for (const line of lines) {
    const h = /^(\s{0,3})(#{1,6})\s/.exec(line);
    if (h) {                          // a heading ends any active skip section and may start a new one
      skipDepth = 0;
      if (SKIP_HEADING.test(line)) { skipDepth = h[2]!.length; continue; }
    } else if (skipDepth > 0) {
      continue;                       // inside a skip section (until the next heading)
    }
    if (LINE_JUNK.test(line)) continue;
    // collapse runs of 4+ consecutive link-only lines (nav/menus/related lists) to nothing
    if (isLinkOnly(line)) { linkRun++; if (linkRun >= 4) continue; } else { if (linkRun > 0 && linkRun < 4) { /* keep */ } linkRun = 0; }
    out.push(line);
  }
  // drop the tail of accumulated link-only lines if it's a long nav run
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
