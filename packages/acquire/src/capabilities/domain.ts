// Cluster A — Domain / Infrastructure capabilities. Each is a pure runner (fetch + parse) split so the parse
// half is unit-tested against real captured responses. Endpoints, grades and caveats: research/17 §Cluster A.
// All keyless. Every runner is self-rate-limited and returns the uniform CapabilityResult.
import { getJson, getJsonOrNull, getText } from "./http.ts";
import { type CapabilityResult, type CapProvenance, type CapPivot, dedupePivots, emptyResult } from "./types.ts";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// A1. RDAP / WHOIS — registration facts
// ---------------------------------------------------------------------------
interface RdapEntity { roles?: string[]; vcardArray?: [string, unknown[]] }
interface RdapResponse {
  ldhName?: string;
  events?: { eventAction: string; eventDate: string }[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  status?: string[];
}
const vcardField = (e: RdapEntity, field: string): string | undefined => {
  const arr = e.vcardArray?.[1] as unknown[][] | undefined;
  const row = arr?.find((r) => r[0] === field);
  return row ? String(row[3]) : undefined;
};

export function parseRdap(j: RdapResponse, domain: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.rdap", source: "RDAP", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  r.entities.push({ type: "domain", name: domain });
  const ev = Object.fromEntries((j.events ?? []).map((e) => [e.eventAction, e.eventDate]));
  if (ev.registration) r.attributes.push({ entity: domain, key: "registration_date", value: ev.registration.slice(0, 10), at: ev.registration });
  if (ev.expiration) r.attributes.push({ entity: domain, key: "expiration_date", value: ev.expiration.slice(0, 10), at: ev.expiration });
  if (j.status?.length) r.attributes.push({ entity: domain, key: "domain_status", value: j.status.join(", ") });

  const registrar = (j.entities ?? []).find((e) => e.roles?.includes("registrar"));
  if (registrar) {
    const name = vcardField(registrar, "fn") ?? "unknown registrar";
    r.entities.push({ type: "organization", kind: "registrar", name });
    r.edges.push({ subject: domain, predicate: "registered_with", object: name, from: ev.registration });
  }
  // registrant is almost always redacted (GDPR / privacy services) — surface it only when a real name/email is present
  const registrant = (j.entities ?? []).find((e) => e.roles?.includes("registrant"));
  const rEmail = registrant && vcardField(registrant, "email");
  const rName = registrant && vcardField(registrant, "fn");
  if (rName && !/redact|privacy|whois|protect|not disclosed/i.test(rName)) {
    r.entities.push({ type: "person", name: rName });
    r.edges.push({ subject: domain, predicate: "registered_by", object: rName });
  } else {
    prov.note = "registrant redacted (GDPR/privacy) — dates+registrar+nameservers are the durable facts";
  }
  if (rEmail && !/redact|privacy|protect/i.test(rEmail)) r.pivots.push({ kind: "email", value: rEmail });

  for (const ns of j.nameservers ?? []) {
    if (!ns.ldhName) continue;
    const h = ns.ldhName.toLowerCase();
    r.entities.push({ type: "hostname", kind: "nameserver", name: h });
    r.edges.push({ subject: domain, predicate: "uses_nameserver", object: h });
    r.pivots.push({ kind: "hostname", value: h });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function rdap(domain: string): Promise<CapabilityResult> {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const j = await getJson<RdapResponse>(url, { rateKey: "rdap.org", minIntervalMs: 1000 });
  const r = parseRdap(j, domain);
  r.provenance.url = url;
  return r;
}

// ---------------------------------------------------------------------------
// A2. DNS records (Google DoH)
// ---------------------------------------------------------------------------
const DOH_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME"] as const;
interface DohResponse { Status: number; Answer?: { name: string; type: number; data: string; TTL: number }[] }
const registrable = (host: string): string => host.replace(/\.$/, "").split(".").slice(-2).join(".");
const MAIL_PROVIDERS: Record<string, string> = { "google.com": "Google Workspace", "googlemail.com": "Google Workspace", "outlook.com": "Microsoft 365", "protection.outlook.com": "Microsoft 365", "pphosted.com": "Proofpoint", "mimecast.com": "Mimecast", "zoho.com": "Zoho Mail", "messagingengine.com": "Fastmail" };

export function parseDns(byType: Record<string, DohResponse>, host: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.dns", source: "Google DoH", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = byType;
  r.entities.push({ type: "domain", name: host });
  const pivots: CapPivot[] = [];

  for (const rec of byType.A?.Answer ?? []) if (rec.type === 1) { r.edges.push({ subject: host, predicate: "resolves_to", object: rec.data }); r.entities.push({ type: "ip_address", name: rec.data }); pivots.push({ kind: "ip", value: rec.data }); }
  for (const rec of byType.AAAA?.Answer ?? []) if (rec.type === 28) { r.edges.push({ subject: host, predicate: "resolves_to", object: rec.data }); pivots.push({ kind: "ip", value: rec.data }); }

  const mx = (byType.MX?.Answer ?? []).filter((a) => a.type === 15).map((a) => a.data.split(/\s+/).pop()!.replace(/\.$/, ""));
  if (mx.length) {
    const provDomain = registrable(mx[0]!);
    const friendly = MAIL_PROVIDERS[provDomain] ?? provDomain;
    r.attributes.push({ entity: host, key: "mail_provider", value: friendly });
    r.edges.push({ subject: host, predicate: "uses_mail_provider", object: friendly });
    if (!MAIL_PROVIDERS[provDomain]) pivots.push({ kind: "domain", value: provDomain });
  }
  for (const rec of byType.NS?.Answer ?? []) if (rec.type === 2) { const ns = rec.data.replace(/\.$/, ""); r.edges.push({ subject: host, predicate: "uses_nameserver", object: ns }); }
  for (const rec of byType.CNAME?.Answer ?? []) if (rec.type === 5) { const t = rec.data.replace(/\.$/, ""); r.edges.push({ subject: host, predicate: "aliases_to", object: t }); pivots.push({ kind: "hostname", value: t }); }
  for (const rec of byType.TXT?.Answer ?? []) {
    if (rec.type !== 16) continue;
    const txt = rec.data.replace(/^"|"$/g, "");
    // SPF include: lines enumerate a domain's service providers — a clean vendor pivot
    const includes = [...txt.matchAll(/include:([\w.-]+)/g)].map((m) => m[1]!);
    for (const inc of includes) { r.edges.push({ subject: host, predicate: "uses_service", object: registrable(inc) }); pivots.push({ kind: "domain", value: registrable(inc) }); }
    if (/verification|site-verification|verify/i.test(txt)) r.attributes.push({ entity: host, key: "dns_verification_token", value: txt.slice(0, 120) });
  }
  r.pivots = dedupePivots(pivots);
  return r;
}

export async function dns(host: string): Promise<CapabilityResult> {
  const byType: Record<string, DohResponse> = {};
  await Promise.all(DOH_TYPES.map(async (t) => {
    byType[t] = await getJson<DohResponse>(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${t}`, { rateKey: "dns.google", minIntervalMs: 200 });
  }));
  const r = parseDns(byType, host);
  r.provenance.url = `https://dns.google/resolve?name=${host}`;
  return r;
}

// ---------------------------------------------------------------------------
// A3. Certificate Transparency — subdomain discovery (certSpotter primary, crt.sh fallback)
// ---------------------------------------------------------------------------
interface CertSpotterRow { dns_names?: string[]; issuer?: string; not_before?: string; not_after?: string; revoked?: boolean }
interface CrtshRow { name_value?: string; common_name?: string; not_before?: string }

const certResult = (source: string): CapabilityResult =>
  emptyResult({ capability: "infra.cert_transparency", source, fetched_at: now(), grade: "A", tier: "easy" });

export function parseCertSpotter(rows: CertSpotterRow[], domain: string): CapabilityResult {
  const r = certResult("certSpotter");
  r.raw = rows;
  const first = new Map<string, string>();
  for (const row of rows) for (const h of row.dns_names ?? []) {
    const host = h.toLowerCase().replace(/^\*\./, "");
    if (!host.endsWith(domain.toLowerCase())) continue;
    if (row.not_before && (!first.has(host) || row.not_before < first.get(host)!)) first.set(host, row.not_before);
    else if (!first.has(host)) first.set(host, "");
  }
  for (const [host, seen] of first) {
    r.entities.push({ type: "hostname", name: host });
    r.edges.push({ subject: domain, predicate: "has_subdomain", object: host, from: seen || undefined });
    r.pivots.push({ kind: "hostname", value: host });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export function parseCrtsh(rows: CrtshRow[], domain: string): CapabilityResult {
  const r = certResult("crt.sh");
  r.raw = rows;
  const first = new Map<string, string>();
  for (const row of rows) {
    const names = (row.name_value ?? row.common_name ?? "").split(/\n/).map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const host = n.toLowerCase().replace(/^\*\./, "");
      if (!host.endsWith(domain.toLowerCase())) continue;
      if (row.not_before && (!first.has(host) || row.not_before < first.get(host)!)) first.set(host, row.not_before);
      else if (!first.has(host)) first.set(host, "");
    }
  }
  for (const [host, seen] of first) {
    r.entities.push({ type: "hostname", name: host });
    r.edges.push({ subject: domain, predicate: "has_subdomain", object: host, from: seen || undefined });
    r.pivots.push({ kind: "hostname", value: host });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function certTransparency(domain: string): Promise<CapabilityResult> {
  try {
    const url = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names&expand=issuer`;
    const rows = await getJson<CertSpotterRow[]>(url, { rateKey: "certspotter", minIntervalMs: 3000 });
    if (rows.length) { const r = parseCertSpotter(rows, domain); r.provenance.url = url; return r; }
  } catch { /* fall through to crt.sh */ }
  const url = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`;
  const rows = await getJson<CrtshRow[]>(url, { rateKey: "crt.sh", minIntervalMs: 2000 });
  const r = parseCrtsh(rows, domain); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// A4. Wayback / CDX — URL inventory + first-seen dates
// ---------------------------------------------------------------------------
export function parseCdx(rows: string[][], domain: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.wayback", source: "Wayback CDX", fetched_at: now(), grade: "B", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = rows;
  const body = rows[0]?.[0] === "timestamp" ? rows.slice(1) : rows; // drop header row if present
  const seen = new Map<string, { first: string; last: string }>();
  for (const [ts, original] of body) {
    if (!ts || !original) continue;
    const cur = seen.get(original);
    if (!cur) seen.set(original, { first: ts, last: ts });
    else { if (ts < cur.first) cur.first = ts; if (ts > cur.last) cur.last = ts; }
  }
  const iso = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  for (const [url, span] of seen) {
    r.entities.push({ type: "url", name: url, hints: { first_seen: iso(span.first), last_seen: iso(span.last) } });
    r.pivots.push({ kind: "url", value: url });
  }
  if (seen.size) {
    const firstEver = [...seen.values()].map((s) => s.first).sort()[0]!;
    r.attributes.push({ entity: domain, key: "first_archived", value: iso(firstEver), at: iso(firstEver) });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}

export async function wayback(domain: string, opts: { limit?: number } = {}): Promise<CapabilityResult> {
  const url = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}*&output=json&fl=timestamp,original,statuscode&collapse=urlkey&limit=${opts.limit ?? 500}`;
  const rows = await getJson<string[][]>(url, { rateKey: "web.archive.org", minIntervalMs: 1500 });
  const r = parseCdx(rows, domain); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// A5. urlscan.io — existing public scans (contacted domains / infra)
// ---------------------------------------------------------------------------
interface UrlscanResult { results?: { task?: { url?: string; domain?: string }; page?: { domain?: string; ip?: string; asnname?: string; server?: string } }[]; total?: number }
export function parseUrlscan(j: UrlscanResult, domain: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.urlscan", source: "urlscan.io", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.raw = j;
  r.entities.push({ type: "domain", name: domain });
  for (const res of (j.results ?? []).slice(0, 50)) {
    const ip = res.page?.ip;
    if (ip) { r.edges.push({ subject: domain, predicate: "hosted_at", object: ip }); r.entities.push({ type: "ip_address", name: ip, hints: res.page?.asnname ? { asn: res.page.asnname } : undefined }); r.pivots.push({ kind: "ip", value: ip }); }
    if (res.page?.server) r.attributes.push({ entity: domain, key: "server", value: res.page.server });
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}
export async function urlscanSearch(domain: string): Promise<CapabilityResult> {
  const url = `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}&size=100`;
  const j = await getJson<UrlscanResult>(url, { rateKey: "urlscan.io", minIntervalMs: 2000 });
  const r = parseUrlscan(j, domain); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// A6. Reverse IP — sibling domains (⚠ noise on CDN/shared IPs; emitted weak)
// ---------------------------------------------------------------------------
export function parseReverseIp(text: string, ip: string, cdn = false): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.reverse_ip", source: "HackerTarget", fetched_at: now(), grade: "C", tier: "normal", note: cdn ? "CDN/shared IP — siblings NOT derivable; discarded" : "reverse-IP is unreliable on shared/CDN hosting — verify the IP is dedicated" };
  const r = emptyResult(prov);
  r.raw = text;
  if (cdn) return r; // on a CDN the list is meaningless
  const domains = text.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => s && /^[\w.-]+\.[a-z]{2,}$/.test(s) && !/error|api count/i.test(s));
  for (const d of domains) { r.entities.push({ type: "domain", name: d }); r.edges.push({ subject: ip, predicate: "co_hosts", object: d }); r.pivots.push({ kind: "domain", value: d, weak: true }); }
  r.pivots = dedupePivots(r.pivots);
  return r;
}
export async function reverseIp(ip: string, opts: { cdn?: boolean } = {}): Promise<CapabilityResult> {
  const url = `https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`;
  const text = await getText(url, { rateKey: "hackertarget", minIntervalMs: 2000 });
  const r = parseReverseIp(text, ip, opts.cdn); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// A7. ASN / BGP — infra owner + the CDN gate. RIPEstat is the primary (keyless, RIPE-run, reliable); IPinfo and
// BGPView are fallbacks. BGPView's DNS is frequently unresolvable (research/17) so it must not be the only source.
// ---------------------------------------------------------------------------
const CDN_ASNS = /cloudflare|akamai|fastly|amazon|aws|google|microsoft|azure|incapsula|imperva|sucuri|cloudfront|edgecast|stackpath|automattic|vercel|netlify|ovh/i;

/** Build the uniform ASN result and apply the CDN gate (the flag that tells A6 not to trust reverse-IP siblings). */
function buildAsn(ip: string, source: string, asnNum: number | null, holder: string | null, prefix: string | null, ptr: string | null): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.asn", source, fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  r.entities.push({ type: "ip_address", name: ip });
  if (asnNum) {
    const label = `AS${asnNum}${holder ? ` ${holder}` : ""}`;
    r.entities.push({ type: "organization", kind: "network", name: label });
    r.edges.push({ subject: ip, predicate: "announced_by", object: label });
    r.attributes.push({ entity: ip, key: "asn", value: String(asnNum) });
    if (prefix) r.attributes.push({ entity: ip, key: "prefix", value: prefix });
    const isCdn = CDN_ASNS.test(holder ?? "");
    r.attributes.push({ entity: ip, key: "is_cdn", value: String(isCdn) });
    if (isCdn) prov.note = "shared/CDN network — do not trust reverse-IP siblings for this address";
  }
  if (ptr) r.attributes.push({ entity: ip, key: "ptr", value: ptr });
  return r;
}

interface RipestatResponse { data?: { resource?: string; asns?: { asn?: number; holder?: string }[] } }
export function parseRipestat(j: RipestatResponse, ip: string): CapabilityResult {
  const a = j.data?.asns?.[0];
  const r = buildAsn(ip, "RIPEstat", a?.asn ?? null, a?.holder ?? null, j.data?.resource ?? null, null);
  r.raw = j;
  return r;
}

interface IpinfoResponse { org?: string; hostname?: string; city?: string; region?: string; country?: string }
export function parseIpinfo(j: IpinfoResponse, ip: string): CapabilityResult {
  const m = j.org?.match(/^AS(\d+)\s+(.*)$/); // "AS13335 Cloudflare, Inc."
  const r = buildAsn(ip, "IPinfo", m ? Number(m[1]) : null, m ? m[2]! : j.org ?? null, null, j.hostname ?? null);
  if (j.city || j.country) r.attributes.push({ entity: ip, key: "geo", value: [j.city, j.region, j.country].filter(Boolean).join(", ") });
  r.raw = j;
  return r;
}

interface BgpviewResponse { data?: { prefixes?: { prefix?: string; asn?: { asn?: number; name?: string; description?: string } }[]; ptr_record?: string | null } }
export function parseBgpview(j: BgpviewResponse, ip: string): CapabilityResult {
  const p = j.data?.prefixes?.[0];
  const r = buildAsn(ip, "BGPView", p?.asn?.asn ?? null, p?.asn?.description || p?.asn?.name || null, p?.prefix ?? null, j.data?.ptr_record ?? null);
  r.raw = j;
  return r;
}

export async function asn(ip: string): Promise<CapabilityResult> {
  try {
    const url = `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`;
    const j = await getJson<RipestatResponse>(url, { rateKey: "ripestat", minIntervalMs: 500 });
    if (j.data?.asns?.length) { const r = parseRipestat(j, ip); r.provenance.url = url; return r; }
  } catch { /* fall through */ }
  try {
    const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
    const j = await getJson<IpinfoResponse>(url, { rateKey: "ipinfo", minIntervalMs: 500, headers: { Accept: "application/json" } });
    if (j.org) { const r = parseIpinfo(j, ip); r.provenance.url = url; return r; }
  } catch { /* fall through */ }
  const url = `https://api.bgpview.io/ip/${encodeURIComponent(ip)}`;
  const j = await getJson<BgpviewResponse>(url, { rateKey: "bgpview", minIntervalMs: 1500 });
  const r = parseBgpview(j, ip); r.provenance.url = url; return r;
}

// ---------------------------------------------------------------------------
// A8. Web recon primitives — robots / sitemap / security.txt
// ---------------------------------------------------------------------------
export function parseSecurityTxt(text: string, domain: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.web_primitives", source: "security.txt", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  const contacts = [...text.matchAll(/Contact:\s*(?:mailto:)?(\S+)/gi)].map((m) => m[1]!);
  for (const c of contacts) {
    const email = c.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    if (email) { r.attributes.push({ entity: domain, key: "security_contact", value: email }); r.pivots.push({ kind: "email", value: email }); }
  }
  r.pivots = dedupePivots(r.pivots);
  return r;
}
export function parseSitemap(xml: string): CapabilityResult {
  const prov: CapProvenance = { capability: "infra.web_primitives", source: "sitemap.xml", fetched_at: now(), grade: "A", tier: "easy" };
  const r = emptyResult(prov);
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
  for (const u of urls) { r.entities.push({ type: "url", name: u }); r.pivots.push({ kind: "url", value: u }); }
  r.pivots = dedupePivots(r.pivots);
  return r;
}
export async function webPrimitives(domain: string): Promise<CapabilityResult> {
  const base = domain.startsWith("http") ? domain : `https://${domain}`;
  const merged = emptyResult({ capability: "infra.web_primitives", source: "site", fetched_at: now(), grade: "A", tier: "easy" });
  const sec = await getText(`${base}/.well-known/security.txt`, { rateKey: domain, minIntervalMs: 1000 }).catch(() => "");
  if (sec) { const s = parseSecurityTxt(sec, domain); merged.attributes.push(...s.attributes); merged.pivots.push(...s.pivots); }
  const sm = await getText(`${base}/sitemap.xml`, { rateKey: domain, minIntervalMs: 1000 }).catch(() => "");
  if (sm) { const s = parseSitemap(sm); merged.entities.push(...s.entities.slice(0, 200)); merged.pivots.push(...s.pivots.slice(0, 200)); }
  merged.pivots = dedupePivots(merged.pivots);
  return merged;
}
