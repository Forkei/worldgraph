// Playbooks: the investigator's knowledge, served a section at a time so the agent reads what it needs instead of
// carrying 10,000 tokens of method in every prompt. Files live in docs/playbooks/*.md; every `## heading` is a topic.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = [path.resolve(here, "../../../docs/playbooks"), path.resolve(process.cwd(), "docs/playbooks")].find((d) => existsSync(d)) ?? path.resolve(here, "../../../docs/playbooks");

interface Section { book: string; topic: string; text: string }
let cache: Section[] | null = null;

export function loadPlaybooks(dir = DIR): Section[] {
  if (cache) return cache;
  const out: Section[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const book = f.replace(/\.md$/, "");
    const lines = readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
    let topic = "intro", buf: string[] = [];
    const flush = () => { const text = buf.join("\n").trim(); if (text) out.push({ book, topic, text }); buf = []; };
    for (const l of lines) {
      const m = /^## (.+)$/.exec(l);
      if (m) { flush(); topic = m[1]!.trim().toLowerCase(); continue; }
      if (/^# /.test(l)) continue;
      buf.push(l);
    }
    flush();
  }
  cache = out;
  return out;
}

/** Topics as "book/topic", for the tool description and for `consult_playbook` with no argument. */
export function playbookTopics(): string[] { return loadPlaybooks().map((s) => `${s.book}/${s.topic}`); }

/** Fetch a section. Accepts "search/patterns by target", "patterns by target", or a loose substring match. */
export function consultPlaybook(topic: string): string {
  const all = loadPlaybooks();
  const q = topic.trim().toLowerCase();
  if (!q) return `Topics:\n${playbookTopics().map((t) => "- " + t).join("\n")}`;
  const [book, t] = q.includes("/") ? (q.split("/", 2) as [string, string]) : [null, q];
  const exact = all.find((s) => (!book || s.book === book) && s.topic === t);
  const loose = exact ?? all.find((s) => (!book || s.book === book) && s.topic.includes(t)) ?? all.find((s) => s.topic.includes(t) || s.book.includes(t));
  if (!loose) return `No playbook section matches "${topic}". Topics:\n${playbookTopics().map((x) => "- " + x).join("\n")}`;
  return `# ${loose.book} / ${loose.topic}\n\n${loose.text}`;
}
