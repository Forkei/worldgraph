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
