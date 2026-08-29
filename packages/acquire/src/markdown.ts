// Markdown → reader-visible plain text. Deterministic; this is the text quotes are validated against
// and that is stored as `sources.text`. Keeps link text, drops URLs, images, and formatting chrome.
export function markdownToText(md: string): string {
  let t = md.replace(/\r\n?/g, "\n");
  t = t.replace(/```[\s\S]*?```/g, (b) => b.replace(/```[^\n]*\n?/g, ""));   // fenced code → contents
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");                                 // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");                               // [text](url) → text
  t = t.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");                              // [text][ref] → text
  t = t.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "");                             // [ref]: url definitions
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");               // html tags
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");                                     // headings
  t = t.replace(/^\s{0,3}>\s?/gm, "");                                          // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, "");                                          // bullets
  t = t.replace(/^\s*\d+\.\s+/gm, "");                                          // numbered lists
  t = t.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "");     // table separator rows
  t = t.replace(/\|/g, "  ");                                                   // table cells
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2"); // emphasis
  t = t.replace(/`([^`]*)`/g, "$1");                                            // inline code
  t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");                          // escapes
  t = t.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
