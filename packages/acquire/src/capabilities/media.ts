// Cluster C — Media / Geo capabilities. Turns a photo or a place into evidence: where/when/what-device a photo
// is, where else an image appears, and whether a claimed time+place holds up. Same pattern as Cluster A: each
// capability is a pure parse fn (unit-tested against real shapes) + an async runner that fetches then parses.
// Endpoints, grades and caveats: research/17 §Cluster C. Reverse-image uses our SerpAPI key; the rest are keyless
// (plus ExifTool, a local binary). Spicy/biometric sources are declared in GATED_MEDIA, not called live.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@worldgraph/core";
import { getJson, postJson } from "./http.ts";
import { type CapabilityResult, type CapProvenance, type GatedCapability, dedupePivots, emptyResult } from "./types.ts";

const execFileP = promisify(execFile);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// C1. EXIF / metadata extraction (ExifTool, local binary)
// ---------------------------------------------------------------------------
interface ExifRecord {
  GPSLatitude?: number | string; GPSLongitude?: number | string; GPSPosition?: string;
  DateTimeOriginal?: string; CreateDate?: string;
  Make?: string; Model?: string; SerialNumber?: string; Software?: string; Artist?: string;
}
/** exiftool timestamps look like "2024:07:04 12:30:00" — normalise the date half to ISO. */
const exifDateToIso = (s: string): string => s.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");

export function parseExif(records: ExifRecord[], label = "image"): CapabilityResult {
  const prov: CapProvenance = { capability: "media.exif", source: "ExifTool", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = records;
  const m = records[0];
  if (!m) { prov.note = "no EXIF metadata (stripped, or non-media file)"; return r; }
  r.entities.push({ type: "image", name: label });

  const taken = m.DateTimeOriginal ?? m.CreateDate;
  if (taken) r.attributes.push({ entity: label, key: "taken_at", value: exifDateToIso(taken), at: exifDateToIso(taken) });
  const device = [m.Make, m.Model].filter(Boolean).join(" ").trim();
  if (device) r.attributes.push({ entity: label, key: "device", value: device });
  if (m.SerialNumber) r.attributes.push({ entity: label, key: "device_serial", value: String(m.SerialNumber) }); // links photos to one camera
  if (m.Software) r.attributes.push({ entity: label, key: "software", value: m.Software });
  if (m.Artist) { r.attributes.push({ entity: label, key: "author", value: m.Artist }); r.pivots.push({ kind: "name", value: m.Artist }); }

  // GPS: with `-n` exiftool yields decimals; fall back to a "lat, lon" GPSPosition string
  let lat: number | undefined, lon: number | undefined;
  if (typeof m.GPSLatitude === "number" && typeof m.GPSLongitude === "number") { lat = m.GPSLatitude; lon = m.GPSLongitude; }
  else if (m.GPSPosition) { const p = m.GPSPosition.split(/[, ]+/).map(Number).filter((n) => !Number.isNaN(n)); if (p.length >= 2) { lat = p[0]; lon = p[1]; } }
  if (lat !== undefined && lon !== undefined) {
    const coords = `${lat},${lon}`;
    r.attributes.push({ entity: label, key: "location", value: coords });
    r.edges.push({ subject: label, predicate: "taken_at_location", object: coords, at: taken ? exifDateToIso(taken) : undefined });
    r.pivots.push({ kind: "coordinates", value: coords });
  } else {
    prov.note = "no GPS in EXIF (common — most social uploads strip it)";
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function exif(filePath: string): Promise<CapabilityResult> {
  try {
    const { stdout } = await execFileP("exiftool", ["-json", "-n", filePath], { maxBuffer: 8 * 1024 * 1024 });
    return parseExif(JSON.parse(stdout) as ExifRecord[], filePath);
  } catch (e) {
    const msg = String((e as Error).message);
    const missing = /ENOENT|not recognized|not found/i.test(msg);
    const r = emptyResult({ capability: "media.exif", source: "ExifTool", fetched_at: now(), grade: "A", tier: "easy", note: missing ? "exiftool not installed — install ExifTool to enable EXIF extraction" : `exiftool failed: ${msg.slice(0, 120)}` });
    return r;
  }
}

// ---------------------------------------------------------------------------
// C2. Reverse image search (SerpAPI: google_lens / yandex_images / bing_images)
// ---------------------------------------------------------------------------
type LensEngine = "google_lens" | "yandex_images" | "bing_images";
interface LensResponse { visual_matches?: { title?: string; link?: string; source?: string; thumbnail?: string }[]; error?: string }

export function parseReverseImage(j: LensResponse, imgUrl: string, engine: LensEngine): CapabilityResult {
  const prov: CapProvenance = { capability: "media.reverse_image", source: `SerpAPI/${engine}`, fetched_at: now(), grade: "B", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  r.entities.push({ type: "image", name: imgUrl });
  const matches = j.visual_matches ?? [];
  if (!matches.length) prov.note = "no visual matches — reverse image needs a full-size, publicly-fetchable URL (thumbnails return 0)";
  for (const mtch of matches) {
    if (!mtch.link) continue;
    r.entities.push({ type: "url", name: mtch.link, hints: { ...(mtch.title ? { title: mtch.title } : {}), ...(mtch.source ? { source: mtch.source } : {}) } });
    r.edges.push({ subject: imgUrl, predicate: "appears_on", object: mtch.link, qualifiers: mtch.source ? { source: mtch.source } : undefined });
    r.pivots.push({ kind: "url", value: mtch.link });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function reverseImage(imgUrl: string, opts: { engine?: LensEngine } = {}): Promise<CapabilityResult> {
  if (!env.serpApiKey) throw new Error("no SERPAPI_KEY in .env (reverse image uses SerpAPI)");
  const engine = opts.engine ?? "google_lens";
  const url = `https://serpapi.com/search.json?engine=${engine}&url=${encodeURIComponent(imgUrl)}&api_key=${env.serpApiKey}`;
  const j = await getJson<LensResponse>(url, { rateKey: "serpapi", minIntervalMs: 1200 });
  if (j.error) throw new Error(`serpapi ${engine}: ${j.error}`);
  const r = parseReverseImage(j, imgUrl, engine);
  r.provenance.url = `https://serpapi.com/search.json?engine=${engine}&url=${imgUrl}`; // key omitted from audit trail
  return r;
}

// ---------------------------------------------------------------------------
// C4. Geocoding (Nominatim / OSM) — 1 req/sec
// ---------------------------------------------------------------------------
interface NominatimHit { display_name?: string; lat?: string; lon?: string; type?: string; boundingbox?: string[] }
export function parseNominatim(hits: NominatimHit[], query: string): CapabilityResult {
  const prov: CapProvenance = { capability: "geo.geocode", source: "Nominatim/OSM", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = hits;
  const top = hits[0];
  if (!top?.lat || !top?.lon) { prov.note = `no geocoding result for "${query}"`; return r; }
  const name = top.display_name ?? query;
  const coords = `${top.lat},${top.lon}`;
  r.entities.push({ type: "place", kind: top.type, name });
  r.attributes.push({ entity: name, key: "located_at", value: coords });
  r.pivots.push({ kind: "coordinates", value: coords });
  return r;
}
export async function geocode(query: string): Promise<CapabilityResult> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
  const hits = await getJson<NominatimHit[]>(url, { rateKey: "nominatim", minIntervalMs: 1100 }); // 1 req/s hard limit
  const r = parseNominatim(hits, query); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// C5. Map query (Overpass / OSM) — what's near a point / match a described scene
// ---------------------------------------------------------------------------
interface OverpassResponse { elements?: { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }
/** Build a simple Overpass QL query for named features around a point (optionally filtered by a tag, e.g. amenity=cafe). */
export function buildAroundQuery(lat: number, lon: number, radiusM: number, tag?: string): string {
  const filter = tag ? `[${tag}]` : `[name]`;
  return `[out:json][timeout:25];nwr${filter}(around:${radiusM},${lat},${lon});out center 60;`;
}
export function parseOverpass(j: OverpassResponse): CapabilityResult {
  const prov: CapProvenance = { capability: "geo.map", source: "Overpass/OSM", fetched_at: now(), grade: "A", tier: "normal" };
  const r = emptyResult(prov);
  r.raw = j;
  for (const el of j.elements ?? []) {
    const name = el.tags?.name;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const kind = el.tags?.amenity ?? el.tags?.shop ?? el.tags?.tourism ?? el.tags?.building ?? el.type;
    r.entities.push({ type: "place", kind, name, hints: lat !== undefined && lon !== undefined ? { coordinates: `${lat},${lon}` } : undefined });
    if (lat !== undefined && lon !== undefined) r.pivots.push({ kind: "coordinates", value: `${lat},${lon}` });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}
export async function nearbyPOIs(lat: number, lon: number, radiusM = 150, tag?: string): Promise<CapabilityResult> {
  const j = await postJson<OverpassResponse>("https://overpass-api.de/api/interpreter", buildAroundQuery(lat, lon, radiusM, tag), { rateKey: "overpass", minIntervalMs: 2000, headers: { "Content-Type": "text/plain" } });
  const r = parseOverpass(j); r.provenance.url = "https://overpass-api.de/api/interpreter"; return r;
}

// ---------------------------------------------------------------------------
// C6. Chronolocation cross-ref (SunCalc + Open-Meteo)
// ---------------------------------------------------------------------------
// SunCalc: standard low-precision solar-position formulas (the algorithm behind the `suncalc` library),
// implemented inline to avoid a dependency. Accurate to ~0.1–1° — ample for chronolocation corroboration, not
// for surveying. Returns compass azimuth (0=N, 90=E, 180=S, 270=W) and altitude, both in degrees.
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588, J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const toDays = (d: Date) => d.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const rightAscension = (l: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

export interface SunPos { azimuth: number; altitude: number }
export function sunPosition(date: Date, lat: number, lng: number): SunPos {
  const lw = RAD * -lng, phi = RAD * lat, d = toDays(date);
  const L = eclipticLongitude(solarMeanAnomaly(d));
  const dec = declination(L), ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azFromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const azimuth = (((azFromSouth / RAD) + 180) % 360 + 360) % 360; // south-referenced → compass-from-north
  return { azimuth, altitude: altitude / RAD };
}

// WMO weather interpretation codes (Open-Meteo) — the common buckets.
export function weatherDescription(code: number): string {
  if (code === 0) return "clear";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

interface MeteoResponse { daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[] } }
export function parseChrono(sun: SunPos, meteo: MeteoResponse, lat: number, lon: number, iso: string): CapabilityResult {
  const prov: CapProvenance = { capability: "geo.chronolocation", source: "SunCalc + Open-Meteo", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = { sun, meteo };
  const coords = `${lat},${lon}`;
  r.entities.push({ type: "location", name: coords });
  const phase = sun.altitude > 0 ? "daytime" : "night";
  r.attributes.push({ entity: coords, key: "sun_altitude_deg", value: sun.altitude.toFixed(1), at: iso });
  r.attributes.push({ entity: coords, key: "sun_azimuth_deg", value: sun.azimuth.toFixed(1), at: iso });
  r.attributes.push({ entity: coords, key: "sun_phase", value: phase, at: iso });
  const code = meteo.daily?.weather_code?.[0];
  const tmax = meteo.daily?.temperature_2m_max?.[0];
  const parts = [`sun ${phase} (alt ${sun.altitude.toFixed(0)}°, az ${sun.azimuth.toFixed(0)}°)`];
  if (code !== undefined) { const w = weatherDescription(code); r.attributes.push({ entity: coords, key: "weather", value: w, at: iso }); parts.push(w); }
  if (tmax !== undefined) { r.attributes.push({ entity: coords, key: "temperature_max_c", value: String(tmax), at: iso }); parts.push(`${tmax}°C max`); }
  prov.note = `at ${iso} @ ${coords}: ${parts.join(", ")} — cross-check against the photo (shadows/weather) to corroborate or contradict the claim`;
  r.pivots.push({ kind: "coordinates", value: coords });
  return r;
}

export async function chronoCheck(lat: number, lon: number, isoDateTime: string): Promise<CapabilityResult> {
  const date = new Date(isoDateTime);
  const sun = sunPosition(date, lat, lon);
  const day = isoDateTime.slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${day}&end_date=${day}&daily=weather_code,temperature_2m_max&timezone=auto`;
  const meteo = await getJson<MeteoResponse>(url, { rateKey: "open-meteo", minIntervalMs: 500 }).catch(() => ({}) as MeteoResponse);
  const r = parseChrono(sun, meteo, lat, lon, isoDateTime); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// C7. Aircraft tracking (OpenSky) — heavily rate-limited, live only
// ---------------------------------------------------------------------------
// state vector layout: [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude,
// baro_altitude, on_ground, velocity, true_track, ...]
type StateVector = (string | number | boolean | null)[];
interface OpenSkyResponse { time?: number; states?: StateVector[] | null }
export function parseOpenSky(j: OpenSkyResponse): CapabilityResult {
  const prov: CapProvenance = { capability: "geo.aircraft", source: "OpenSky", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  for (const s of j.states ?? []) {
    const icao = String(s[0] ?? "").trim();
    const callsign = String(s[1] ?? "").trim();
    const name = callsign || icao;
    if (!name) continue;
    const lon = s[5], lat = s[6], alt = s[7];
    const hints: Record<string, string> = { icao24: icao };
    if (s[2]) hints.origin_country = String(s[2]);
    if (typeof lat === "number" && typeof lon === "number") hints.position = `${lat},${lon}`;
    if (typeof alt === "number") hints.altitude_m = String(alt);
    r.entities.push({ type: "aircraft", name, hints });
  }
  if (!r.entities.length) prov.note = "no aircraft in the box (or OpenSky rate-limited)";
  return r;
}
export async function aircraftInBox(lamin: number, lomin: number, lamax: number, lomax: number): Promise<CapabilityResult> {
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const j = await getJson<OpenSkyResponse>(url, { rateKey: "opensky", minIntervalMs: 6000 });
  const r = parseOpenSky(j); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// C6. Face search (FaceCheck.ID) — BIOMETRIC, GATED. A face → the pages on the web where that face appears.
// This is the one capability that puts a name to a face, and the one with real legal exposure (BIPA, GDPR
// Art. 9). It is OFF unless FACECHECK_API_TOKEN is set, never auto-fires, and returns matches as WEAK LEADS
// (url pivots + scores) to be read and confirmed — never a confirmed "depicts". The agent must open the top
// matches and establish identity from what it finds there, the same as any other lead.
// ---------------------------------------------------------------------------
interface FaceItem { score?: number; guid?: string; url?: string; base64?: string }
interface FaceSearchResp { error?: string | null; message?: string; id_search?: string; progress?: number; output?: { items?: FaceItem[] } }
const FC_BASE = "https://facecheck.id/api";
const faceToken = () => process.env.FACECHECK_API_TOKEN;

/** score bands FaceCheck documents: ≥90 certain, 83–89 likely, 70–82 uncertain, <70 noise. */
const faceBand = (s: number): string => s >= 90 ? "certain" : s >= 83 ? "likely" : s >= 70 ? "uncertain" : "weak";

export function parseFaceSearch(items: FaceItem[], label: string): CapabilityResult {
  const prov: CapProvenance = { capability: "media.face_search", source: "FaceCheck.ID", fetched_at: now(), grade: "low", tier: "spicy", gated: true, note: "BIOMETRIC match — a LEAD, not proof. Open each match and confirm identity from the page; never assert 'depicts' on the score alone." };
  const r = emptyResult(prov);
  r.raw = { count: items?.length, items: (items ?? []).map((i) => ({ score: i.score, url: i.url })) }; // drop base64 thumbnails from the audit copy
  const hits = (items ?? []).filter((i) => i.url && (i.score ?? 0) >= 70).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!hits.length) { prov.note = "no face matches ≥70 (below this is noise) — nothing to chase"; return r; }
  r.attributes.push({ entity: label, key: "face_matches", value: String(hits.length) });
  r.attributes.push({ entity: label, key: "top_face_score", value: `${hits[0]!.score} (${faceBand(hits[0]!.score ?? 0)})` });
  for (const h of hits.slice(0, 15)) r.pivots.push({ kind: "url", value: h.url!, weak: true }); // read these to establish who it is
  r.pivots = dedupePivots(r.pivots);
  return r;
}

async function fetchImageBytes(url: string): Promise<{ buf: Buffer; type: string }> {
  const res = await fetch(url, { headers: { "User-Agent": "worldgraph-research/1.0", Accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  return { buf: Buffer.from(await res.arrayBuffer()), type };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** imgUrl → the pages where this face appears. Gated on FACECHECK_API_TOKEN. `demo` uses FaceCheck's free
 *  test mode (fake results, no credits) to verify wiring. */
export async function faceSearch(imgUrl: string, opts: { demo?: boolean } = {}): Promise<CapabilityResult> {
  const token = faceToken();
  if (!token) throw new Error("media.face_search is gated: set FACECHECK_API_TOKEN (paid). It never runs without it, and matches are leads to confirm, not proof.");
  const auth = { Authorization: token, Accept: "application/json" };
  // 1) upload the image
  const { buf, type } = await fetchImageBytes(imgUrl);
  const form = new FormData();
  form.append("images", new Blob([new Uint8Array(buf)], { type }), "face.jpg");
  const up = await fetch(`${FC_BASE}/upload_pic`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(60_000) }).then((x) => x.json() as Promise<FaceSearchResp>);
  if (up.error) throw new Error(`FaceCheck upload: ${up.message || up.error}`);
  const idSearch = up.id_search;
  if (!idSearch) throw new Error("FaceCheck upload returned no id_search");
  // 2) poll search until output is ready
  let last: FaceSearchResp = {};
  for (let i = 0; i < 20; i++) {
    last = await postJson<FaceSearchResp>(`${FC_BASE}/search`, { id_search: idSearch, with_progress: true, status_only: false, demo: !!opts.demo }, { rateKey: "facecheck.id", minIntervalMs: 3000, timeoutMs: 60_000, headers: auth });
    if (last.error) throw new Error(`FaceCheck search: ${last.message || last.error}`);
    if (last.output?.items) break;
    await sleep(4000);
  }
  const r = parseFaceSearch(last.output?.items ?? [], imgUrl);
  r.provenance.url = `${FC_BASE}/search (id_search ${idSearch})`;
  if (opts.demo) r.provenance.note = "DEMO mode — sample results, not a real search. " + (r.provenance.note ?? "");
  return r;
}

// ---------------------------------------------------------------------------
// Gated / keyed geo (not called live — declared for the registry & the gate)
// ---------------------------------------------------------------------------
// Also needs-free-key (build in Wave 2, not gated): Mapillary (street-level imagery) and Sentinel Hub (satellite).
export const GATED_MEDIA: GatedCapability[] = [
  { id: "media.face_search", source: "PimEyes / FaceCheck.ID", consumes: "image", emits: "depicts→url", grade: "low", tier: "spicy", gated: true, note: "biometric (BIPA/GDPR Art.9); opt-in per run, human-confirm every match before asserting depicts" },
  { id: "geo.ai_geolocation", source: "GeoSpy / Picarta", consumes: "image", emits: "coordinates", grade: "low", tier: "spicy", gated: true, note: "predictive scene→location; use when EXIF stripped and no landmark is nameable; human-confirm" },
  { id: "geo.vessel", source: "MarineTraffic / AISHub", consumes: "name/mmsi", emits: "vessel position", grade: "A", tier: "spicy", gated: true, note: "keyed; ship tracking by name/MMSI" },
];
