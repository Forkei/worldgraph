// The runner table: capability id → function of ONE pivot value. Shared by `wg cap` and the pivot engine, so the
// list of what can run lives in exactly one place. `auto` marks runners the pivot engine may fire on its own
// (single-value inputs); multi-argument tools (chronolocation, aircraft bbox) stay CLI-only. `maxPerRun` caps
// how many times the engine fires a noisy/slow runner in one invocation (WhatsMyName = 716 probes).
import type { CapabilityResult, PivotKind } from "./types.ts";
import { rdap, dns, certTransparency, wayback, urlscanSearch, reverseIp, asn, webPrimitives, passiveDns } from "./domain.ts";
import { gravatar, fecDonations, academic, usernameAccounts, hibpCatalog, hibpAccount, hunter, relatives, dehashed } from "./people.ts";
import { exif, reverseImage, geocode, nearbyPOIs, chronoCheck, aircraftInBox } from "./media.ts";
import { edgar, gleif, wikidata, nonprofit, usaspending, courtCases, companiesHouse, openCorporates, sanctions } from "./org.ts";

export interface CapRunner {
  id: string;
  /** pivot kinds this runner consumes when fired automatically */
  consumes: PivotKind[];
  /** run from CLI args (multi-arg tools) */
  run: (args: string[], kind?: PivotKind) => Promise<CapabilityResult>;
  /** may the pivot engine fire this on its own? */
  auto: boolean;
  maxPerRun?: number;
}

const one = (fn: (v: string) => Promise<CapabilityResult>) => (a: string[]) => fn(a.join(" "));
const coords = (a: string[]) => a.length === 1 ? a[0]!.split(/[ ,]+/).map(Number) : a.map(Number);

export const CAP_RUNNERS: CapRunner[] = [
  { id: "infra.rdap", consumes: ["domain"], run: (a) => rdap(a[0]!), auto: true },
  { id: "infra.dns", consumes: ["domain", "hostname"], run: (a) => dns(a[0]!), auto: true },
  { id: "infra.cert_transparency", consumes: ["domain"], run: (a) => certTransparency(a[0]!), auto: true },
  { id: "infra.wayback", consumes: ["domain"], run: (a) => wayback(a[0]!), auto: true },
  { id: "infra.urlscan", consumes: ["domain"], run: (a) => urlscanSearch(a[0]!), auto: true },
  { id: "infra.reverse_ip", consumes: ["ip"], run: (a) => reverseIp(a[0]!), auto: true, maxPerRun: 5 },
  { id: "infra.passive_dns", consumes: ["domain", "ip"], run: (a, kind) => passiveDns(a[0]!, kind === "ip" ? "ip" : "domain"), auto: true, maxPerRun: 8 },
  { id: "infra.asn", consumes: ["ip"], run: (a) => asn(a[0]!), auto: true },
  { id: "infra.web_primitives", consumes: ["domain"], run: (a) => webPrimitives(a[0]!), auto: true },
  { id: "people.gravatar", consumes: ["email"], run: (a) => gravatar(a[0]!), auto: true },
  { id: "people.fec", consumes: ["name"], run: one(fecDonations), auto: true },
  { id: "people.academic", consumes: ["name"], run: one(academic), auto: true },
  { id: "people.username", consumes: ["username"], run: (a) => usernameAccounts(a[0]!.replace(/^@/, "")), auto: true, maxPerRun: 3 },
  { id: "people.breach", consumes: ["email"], run: (a) => (a[0] ? hibpAccount(a[0]) : hibpCatalog()), auto: true },
  { id: "people.dehashed", consumes: ["email", "username", "phone"], run: (a, kind) => dehashed(a.join(" "), kind ?? "email"), auto: true, maxPerRun: 6 },
  { id: "people.email_pattern", consumes: ["domain"], run: (a) => hunter(a[0]!), auto: true, maxPerRun: 3 },
  { id: "people.relatives", consumes: ["name"], run: one(relatives), auto: true },
  { id: "media.exif", consumes: ["image"], run: (a) => exif(a[0]!), auto: true },
  { id: "media.reverse_image", consumes: ["image"], run: (a) => reverseImage(a[0]!), auto: true, maxPerRun: 3 },
  { id: "geo.geocode", consumes: [], run: one(geocode), auto: false },
  { id: "geo.map", consumes: ["coordinates"], run: (a) => { const [lat, lon, r] = coords(a); return nearbyPOIs(lat!, lon!, r, a[3]); }, auto: true, maxPerRun: 3 },
  { id: "geo.chronolocation", consumes: [], run: (a) => chronoCheck(Number(a[0]), Number(a[1]), a[2]!), auto: false },
  { id: "geo.aircraft", consumes: [], run: (a) => aircraftInBox(Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3])), auto: false },
  { id: "org.edgar", consumes: ["org"], run: one(edgar), auto: true },
  { id: "org.gleif", consumes: ["org"], run: one(gleif), auto: true },
  { id: "org.wikidata", consumes: ["org", "name"], run: one(wikidata), auto: true },
  { id: "org.nonprofit", consumes: ["org"], run: one(nonprofit), auto: true },
  { id: "org.usaspending", consumes: ["org"], run: one(usaspending), auto: true },
  { id: "org.court", consumes: ["org", "name"], run: one(courtCases), auto: true },
  { id: "org.companies_house", consumes: ["org"], run: one(companiesHouse), auto: true },
  { id: "org.opencorporates", consumes: ["org", "name"], run: (a, kind) => openCorporates(a.join(" "), kind === "name" ? "officer" : "company"), auto: true },
  { id: "org.sanctions", consumes: ["org", "name"], run: one(sanctions), auto: true },
];

export const capRunner = (id: string): CapRunner | undefined => CAP_RUNNERS.find((r) => r.id === id);
/** runners the engine may fire for a pivot kind */
export const runnersFor = (kind: PivotKind): CapRunner[] => CAP_RUNNERS.filter((r) => r.auto && r.consumes.includes(kind));
