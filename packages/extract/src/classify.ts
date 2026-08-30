// Source classification (X2 pre-pass): what KIND of document is this, and WHO publishes it — from the
// page's own content, never from its domain. Cheap model, ~1,500 tokens, one call per source.
import { callModel, getModel, type ModelSpec } from "./providers.ts";

export const DOC_KINDS = ["record", "filing", "minutes", "roster", "directory", "article", "paper", "transcript", "profile", "page", "post", "listing", "forum", "unknown"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface Classification {
  doc_kind: DocKind;
  publisher_name: string;          // the organization or person that publishes the page, as the page itself indicates
  publisher_type: "organization" | "person" | "platform" | "unknown";
  about: string;                   // the main subject of the page (entity name) if it has one, else ""
  self_published: boolean;         // the page is published by the entity it is mainly about (own site, own profile)
  summary: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    doc_kind: { type: "string", enum: [...DOC_KINDS], description: "record = official register/court/licence/filing index; filing = a document filed with an authority; minutes = minutes of a public body; roster = results/staff/member list (tabular); directory = a directory of people or organizations; article = reported news; paper = academic/technical; transcript = speech transcript; profile = a person's or organization's profile page (own site, LinkedIn-like, aggregator); page = general web page; post = social/blog post; listing = classified/marketplace; forum = discussion thread" },
    publisher_name: { type: "string" },
    publisher_type: { type: "string", enum: ["organization", "person", "platform", "unknown"], description: "platform = a site that hosts others' content (LinkedIn, X, Reddit, a people-search aggregator)" },
    about: { type: "string" },
    self_published: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["doc_kind", "publisher_name", "publisher_type", "about", "self_published", "summary"],
  additionalProperties: false,
};

const SYSTEM = `Classify one web page for an investigation tool. Decide from the page's own content and structure — headers, footers, bylines, "about", the shape of the text — never from what you assume about the website's name.
- doc_kind: the kind of document this is.
- publisher_name: who publishes it (the organization or person whose page it is). For a hosted profile on a platform, the publisher is the platform; the profile's owner goes in "about".
- about: the main subject of the page, if it has one.
- self_published: true only if the publisher IS the subject (a company's own site about itself or its team; a person's own site or own profile written by them). A news article about a company is not self-published; an aggregator's profile is not self-published.
Keep the summary to one sentence.`;

export async function classifySource(input: { url: string; title: string | null; text: string }, model: ModelSpec = getModel("gemini-3.5-flash-lite")): Promise<{ c: Classification; usd: number }> {
  const head = input.text.slice(0, 6000);
  const tail = input.text.length > 8000 ? "\n…\n" + input.text.slice(-1500) : "";
  const r = await callModel(model, { system: [SYSTEM], user: `URL: ${input.url}\nTITLE: ${input.title ?? ""}\n\n<text>\n${head}${tail}\n</text>`, schema: SCHEMA, maxOutputTokens: 2000 });
  const c = JSON.parse(r.text) as Classification;
  if (!DOC_KINDS.includes(c.doc_kind)) c.doc_kind = "unknown";
  return { c, usd: r.usd };
}
