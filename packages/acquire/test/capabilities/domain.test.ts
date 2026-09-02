// Cluster A parse tests — fixtures are real response shapes captured live on 2026-09-01 (research/17).
import { describe, it, expect } from "vitest";
import { parseRdap, parseDns, parseCertSpotter, parseCrtsh, parseCdx, parseReverseIp, parseBgpview, parseRipestat, parseIpinfo, parseSecurityTxt, parseSitemap, SHARED_HOST_MAX } from "../../src/capabilities/domain.ts";

describe("A1 rdap", () => {
  const j = {
    ldhName: "OPENAI.COM",
    events: [{ eventAction: "registration", eventDate: "2007-01-19T19:28:24Z" }, { eventAction: "expiration", eventDate: "2029-01-19T19:28:24Z" }],
    status: ["client transfer prohibited"],
    entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "MarkMonitor Inc."]]] }, { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]] }],
    nameservers: [{ ldhName: "NS1.OPENAI.COM" }, { ldhName: "NS2.OPENAI.COM" }],
  };
  const r = parseRdap(j as never, "openai.com");
  it("extracts registrar + dates", () => {
    expect(r.edges.find((e) => e.predicate === "registered_with")?.object).toBe("MarkMonitor Inc.");
    expect(r.attributes.find((a) => a.key === "registration_date")?.value).toBe("2007-01-19");
    expect(r.attributes.find((a) => a.key === "expiration_date")?.value).toBe("2029-01-19");
  });
  it("does NOT emit a redacted registrant, and notes it", () => {
    expect(r.edges.find((e) => e.predicate === "registered_by")).toBeUndefined();
    expect(r.provenance.note).toMatch(/redact/i);
  });
  it("emits nameservers as hostname pivots", () => {
    expect(r.pivots.filter((p) => p.kind === "hostname").map((p) => p.value)).toEqual(expect.arrayContaining(["ns1.openai.com", "ns2.openai.com"]));
  });
});

describe("A2 dns", () => {
  const byType = {
    A: { Status: 0, Answer: [{ name: "openai.com", type: 1, data: "104.18.32.47", TTL: 300 }] },
    MX: { Status: 0, Answer: [{ name: "openai.com", type: 15, data: "1 aspmx.l.google.com.", TTL: 300 }] },
    TXT: { Status: 0, Answer: [{ name: "openai.com", type: 16, data: '"v=spf1 include:_spf.google.com ~all"', TTL: 300 }] },
  };
  const r = parseDns(byType as never, "openai.com");
  it("resolves A → ip entity + pivot", () => {
    expect(r.pivots.find((p) => p.kind === "ip")?.value).toBe("104.18.32.47");
    expect(r.edges.find((e) => e.predicate === "resolves_to")?.object).toBe("104.18.32.47");
  });
  it("maps MX to a friendly mail provider", () => {
    expect(r.attributes.find((a) => a.key === "mail_provider")?.value).toBe("Google Workspace");
  });
  it("reads SPF include: as a service pivot", () => {
    expect(r.edges.find((e) => e.predicate === "uses_service")?.object).toBe("google.com");
  });
});

describe("A3 certificate transparency", () => {
  it("certSpotter: subdomains within the domain, first-seen from not_before", () => {
    const rows = [{ dns_names: ["brand.openai.com", "openai.com"], not_before: "2024-05-01T00:00:00Z" }, { dns_names: ["*.api.openai.com", "unrelated.example.com"], not_before: "2023-01-01T00:00:00Z" }];
    const r = parseCertSpotter(rows, "openai.com");
    const hosts = r.pivots.map((p) => p.value);
    expect(hosts).toEqual(expect.arrayContaining(["brand.openai.com", "api.openai.com"]));
    expect(hosts).not.toContain("unrelated.example.com"); // out-of-domain filtered
    expect(r.edges.find((e) => e.object === "api.openai.com")?.from).toBe("2023-01-01T00:00:00Z"); // wildcard stripped
  });
  it("crt.sh: parses name_value newlines", () => {
    const r = parseCrtsh([{ name_value: "a.openai.com\n*.b.openai.com", not_before: "2022-01-01" }], "openai.com");
    expect(r.pivots.map((p) => p.value)).toEqual(expect.arrayContaining(["a.openai.com", "b.openai.com"]));
  });
});

describe("A4 wayback cdx", () => {
  const rows = [["timestamp", "original", "statuscode"], ["20010706030108", "http://openai.com/", "200"], ["20240101000000", "http://openai.com/", "200"], ["20190101000000", "http://openai.com/blog", "200"]];
  const r = parseCdx(rows, "openai.com");
  it("drops the header and dedupes urls with first/last seen", () => {
    const root = r.entities.find((e) => e.name === "http://openai.com/");
    expect(root?.hints?.first_seen).toBe("2001-07-06");
    expect(root?.hints?.last_seen).toBe("2024-01-01");
  });
  it("records earliest archive date on the domain", () => {
    expect(r.attributes.find((a) => a.key === "first_archived")?.value).toBe("2001-07-06");
  });
});

describe("A6 reverse ip — the CDN gate", () => {
  it("discards everything on a CDN IP and notes why", () => {
    const r = parseReverseIp("a.com\nb.com\nc.com", "104.18.32.47", true);
    expect(r.pivots).toHaveLength(0);
    expect(r.provenance.note).toMatch(/CDN/i);
  });
  it("emits weak sibling pivots on a dedicated IP", () => {
    const r = parseReverseIp("sibling1.com\nsibling2.com\nnot a domain", "203.0.113.5", false);
    expect(r.pivots.map((p) => p.value)).toEqual(["sibling1.com", "sibling2.com"]);
    expect(r.pivots.every((p) => p.weak)).toBe(true);
  });
});

describe("A7 asn / bgp (shape fix)", () => {
  it("reads data.prefixes[0].asn and flags CDNs", () => {
    const j = { data: { prefixes: [{ prefix: "104.18.0.0/16", asn: { asn: 13335, name: "CLOUDFLARENET", description: "Cloudflare, Inc." } }], ptr_record: null } };
    const r = parseBgpview(j, "104.18.32.47");
    expect(r.attributes.find((a) => a.key === "asn")?.value).toBe("13335");
    expect(r.attributes.find((a) => a.key === "is_cdn")?.value).toBe("true");
    expect(r.edges.find((e) => e.predicate === "announced_by")?.object).toMatch(/Cloudflare/);
  });
  it("does not flag a dedicated host as CDN", () => {
    const j = { data: { prefixes: [{ prefix: "203.0.113.0/24", asn: { asn: 64500, name: "EXAMPLE-AS", description: "Example Hosting Ltd" } }] } };
    expect(parseBgpview(j, "203.0.113.5").attributes.find((a) => a.key === "is_cdn")?.value).toBe("false");
  });
  it("RIPEstat (primary): reads data.asns[0] + flags CDN via holder", () => {
    const r = parseRipestat({ data: { resource: "104.18.32.0/24", asns: [{ asn: 13335, holder: "CLOUDFLARENET - Cloudflare, Inc." }] } }, "104.18.32.47");
    expect(r.attributes.find((a) => a.key === "asn")?.value).toBe("13335");
    expect(r.attributes.find((a) => a.key === "is_cdn")?.value).toBe("true");
    expect(r.attributes.find((a) => a.key === "prefix")?.value).toBe("104.18.32.0/24");
  });
  it("IPinfo (fallback): parses 'AS13335 Cloudflare, Inc.' org string", () => {
    const r = parseIpinfo({ org: "AS13335 Cloudflare, Inc.", city: "San Francisco", region: "California", country: "US" }, "104.18.32.47");
    expect(r.attributes.find((a) => a.key === "asn")?.value).toBe("13335");
    expect(r.edges.find((e) => e.predicate === "announced_by")?.object).toBe("AS13335 Cloudflare, Inc.");
    expect(r.attributes.find((a) => a.key === "geo")?.value).toMatch(/San Francisco/);
  });
});

describe("A8 web primitives", () => {
  it("security.txt → contact email pivot", () => {
    const r = parseSecurityTxt("Contact: mailto:security@openai.com\nExpires: 2027-01-01", "openai.com");
    expect(r.pivots.find((p) => p.kind === "email")?.value).toBe("security@openai.com");
  });
  it("sitemap.xml → url inventory pivots", () => {
    const r = parseSitemap("<urlset><url><loc>https://openai.com/about</loc></url><url><loc>https://openai.com/blog</loc></url></urlset>");
    expect(r.pivots.map((p) => p.value)).toEqual(["https://openai.com/about", "https://openai.com/blog"]);
  });
});

describe("A6 reverse-ip shared hosting cap", () => {
  it("keeps a short sibling list as weak domain pivots", () => {
    const r = parseReverseIp("a.com\nb.org\n", "1.2.3.4");
    expect(r.edges).toHaveLength(2);
    expect(r.pivots.every((p) => p.weak)).toBe(true);
  });
  it("collapses a shared-hosting box (> SHARED_HOST_MAX tenants) into a count, no siblings, no pivots", () => {
    const many = Array.from({ length: SHARED_HOST_MAX + 5 }, (_, i) => `tenant${i}.example`).join("\n");
    const r = parseReverseIp(many, "1.2.3.4");
    expect(r.edges).toHaveLength(0);
    expect(r.pivots).toHaveLength(0);
    expect(r.attributes.find((a) => a.key === "cohosted_domains")?.value).toBe(String(SHARED_HOST_MAX + 5));
    expect(r.provenance.note).toMatch(/shared hosting/);
  });
});
