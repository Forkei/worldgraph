// Vision — look at an image and turn it into structured, graph-ready observations. Runs on Gemini (multimodal,
// cheap, strong OCR). This is the "eyes" half of research/19: a photo becomes evidence — text in the image,
// people (apparent age/role, NOT identity — that is face search, a separate gated capability), animals, objects,
// place cues, time cues, and a relationship guess. The caller feeds the description through the normal claim
// pipeline so every fact still cites the image as its source.
import { GoogleGenAI } from "@google/genai";
import { env, requireEnv } from "@worldgraph/core";
import { getModel, type ModelSpec } from "./providers.ts";

let client: GoogleGenAI | null = null;

export interface VisionPerson {
  apparent_age?: string;      // a range, e.g. "20s", "60s+"; never a birthdate
  apparent_sex?: string;      // visual guess only
  role_guess?: string;        // "the subject", "a child", "an older relative", "a friend"
  description?: string;       // clothing, hair, what they are doing — NOT an identification
}
export interface VisionResult {
  scene: string;                 // one-line description of the whole image
  text_in_image: string[];       // OCR: signage, captions, jerseys, screens, plates
  people: VisionPerson[];
  animals: string[];
  objects: string[];             // notable objects that carry information (a graduation gown, a team jersey)
  place_cues: string[];          // landmarks, architecture, signage language, vegetation, plates → geolocation leads
  time_cues: string[];           // season, decor, device era, clothing era → when
  relationships_guess?: string;  // e.g. "two brothers and an older woman, likely family"
  answer?: string;               // answer to the caller's question, if one was asked
  caveats?: string;              // low-confidence flags
}

const VISION_SCHEMA = {
  type: "object",
  properties: {
    scene: { type: "string" },
    text_in_image: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "object", properties: {
      apparent_age: { type: "string" }, apparent_sex: { type: "string" }, role_guess: { type: "string" }, description: { type: "string" },
    } } },
    animals: { type: "array", items: { type: "string" } },
    objects: { type: "array", items: { type: "string" } },
    place_cues: { type: "array", items: { type: "string" } },
    time_cues: { type: "array", items: { type: "string" } },
    relationships_guess: { type: "string" },
    answer: { type: "string" },
    caveats: { type: "string" },
  },
  required: ["scene", "text_in_image", "people", "animals", "objects", "place_cues", "time_cues"],
} as const;

const SYSTEM = [
  "You are an OSINT image analyst. Describe exactly what is visible and infer only what the pixels support.",
  "Report every piece of readable text verbatim (signs, captions, jerseys, screens, licence plates, book spines) — these are the strongest leads.",
  "Note place cues (landmarks, architecture, plate format, signage language, vegetation, sun position) and time cues (season, decor, device/clothing era) that could locate or date the photo.",
  "Describe people by apparent age range, apparent sex, likely role and what they are doing. Do NOT attempt to identify who anyone is, name them, or guess an exact birthdate — identification is a separate tool. Guess relationships only when the scene clearly supports it, and say it is a guess.",
  "Prefer empty arrays to speculation. Put anything uncertain in caveats.",
].join(" ");

export interface LookAtInput {
  /** raw image bytes + mime, or a URL to fetch */
  bytes?: Buffer;
  mime?: string;
  url?: string;
  /** an optional question to answer about the image */
  question?: string;
  model?: ModelSpec;
}

/** Fetch (if needed) and analyse one image. Returns the structured observation plus token cost. */
export async function lookAt(input: LookAtInput): Promise<{ result: VisionResult; usd: number; bytes: number }> {
  client ??= new GoogleGenAI({ apiKey: requireEnv("geminiKey") });
  const m = input.model ?? getModel("gemini-3.7-flash");

  let bytes = input.bytes, mime = input.mime;
  if (!bytes) {
    if (!input.url) throw new Error("lookAt needs bytes or url");
    const { buf, contentType } = await fetchImage(input.url);
    bytes = buf; mime = mime ?? contentType;
  }
  if (bytes.length > 18 * 1024 * 1024) throw new Error("image too large (>18MB)");
  mime = mime ?? "image/jpeg";

  const prompt = input.question
    ? `Question to answer from the image: ${input.question}\nAlso fill in the full structured description.`
    : "Describe this image in full using the schema.";

  const res = await client.models.generateContent({
    model: m.id,
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: bytes.toString("base64") } }] }],
    config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: VISION_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 8192 },
  });
  const u = res.usageMetadata ?? {};
  const inTok = u.promptTokenCount ?? 0, outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const usd = (inTok * m.price[0] + outTok * m.price[1]) / 1e6;
  const text = res.text ?? "";
  if (!text) throw new Error(`vision returned no text (finish=${res.candidates?.[0]?.finishReason})`);
  return { result: JSON.parse(text) as VisionResult, usd, bytes: bytes.length };
}

/** Render a VisionResult as a compact evidence block: the text the claim extractor reads. */
export function visionToText(v: VisionResult, source: string): string {
  const lines: string[] = [`Image (${source}): ${v.scene}`];
  if (v.text_in_image?.length) lines.push(`Text in image: ${v.text_in_image.map((t) => `"${t}"`).join("; ")}`);
  if (v.people?.length) lines.push(`People: ${v.people.map((p) => [p.role_guess, p.apparent_sex, p.apparent_age, p.description].filter(Boolean).join(", ")).join(" | ")}`);
  if (v.animals?.length) lines.push(`Animals: ${v.animals.join(", ")}`);
  if (v.objects?.length) lines.push(`Objects: ${v.objects.join(", ")}`);
  if (v.place_cues?.length) lines.push(`Place cues: ${v.place_cues.join("; ")}`);
  if (v.time_cues?.length) lines.push(`Time cues: ${v.time_cues.join("; ")}`);
  if (v.relationships_guess) lines.push(`Relationship (guess): ${v.relationships_guess}`);
  if (v.answer) lines.push(`Answer: ${v.answer}`);
  if (v.caveats) lines.push(`Caveats: ${v.caveats}`);
  return lines.join("\n");
}

const IMG_UA = "worldgraph-research/1.0 (+https://github.com/worldgraph)";
export async function fetchImage(url: string): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(url, { headers: { "User-Agent": IMG_UA, Accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`image fetch ${res.status} for ${url.slice(0, 120)}`);
  const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!/^image\//.test(ct)) throw new Error(`not an image (content-type ${ct})`);
  return { buf: Buffer.from(await res.arrayBuffer()), contentType: ct };
}

export const hasVisionKey = (): boolean => !!env.geminiKey;
