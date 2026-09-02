// Cluster B parse tests — fixtures are real response shapes (research/17, live 2026-09-01).
import { describe, it, expect } from "vitest";
import { parseGravatar, parseFec, parseOpenAlex, checkSite, parseHibpAccount, parseHunter, parseWikitree, GATED_PEOPLE, type WmnSite } from "../../src/capabilities/people.ts";

describe("B3 gravatar", () => {
  it("emits person, location, accounts (username pivots) and url pivots", () => {
    const j = { entry: [{ displayName: "Jane Doe", currentLocation: "San Francisco", accounts: [{ shortname: "github", username: "janedoe", url: "https://github.com/janedoe" }], urls: [{ value: "https://jane.dev" }] }] };
    const r = parseGravatar(j, "jane@example.com");
    expect(r.entities.find((e) => e.type === "person")?.name).toBe("Jane Doe");
    expect(r.attributes.find((a) => a.key === "location")?.value).toBe("San Francisco");
    expect(r.pivots.find((p) => p.kind === "username")?.value).toBe("janedoe");
    expect(r.pivots.filter((p) => p.kind === "url").map((p) => p.value)).toEqual(expect.arrayContaining(["https://github.com/janedoe", "https://jane.dev"]));
  });
  it("handles no-profile (null) gracefully with a note", () => {
    const r = parseGravatar(null, "nobody@example.com");
    expect(r.entities).toHaveLength(0);
    expect(r.provenance.note).toMatch(/no public Gravatar/i);
  });
});

describe("B6 fec donations", () => {
  const j = { results: [
    { contributor_name: "SAMPLE, CASEY N.", contributor_employer: "META PLATFORMS, INC.", contributor_occupation: "EXECUTIVE", contributor_city: "SAN FRANCISCO", contributor_state: "CA", contribution_receipt_amount: 192.31, contribution_receipt_date: "2024-03-01", committee: { name: "META PLATFORMS, INC. PAC" } },
    { contributor_name: "SAMPLE, CASEY N.", contributor_employer: "META PLATFORMS, INC.", contribution_receipt_amount: 100, contribution_receipt_date: "2023-01-01", committee: { name: "META PLATFORMS, INC. PAC" } },
  ] };
  const r = parseFec(j, "Casey Sample");
  it("emits dated donation edges with amounts", () => {
    const d = r.edges.filter((e) => e.predicate === "donated_to");
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ object: "META PLATFORMS, INC. PAC", value: "192.31", at: "2024-03-01" });
  });
  it("derives employer/occupation/location (deduped) + works_at edge", () => {
    expect(r.attributes.filter((a) => a.key === "employer")).toHaveLength(1);
    expect(r.attributes.find((a) => a.key === "occupation")?.value).toBe("EXECUTIVE");
    expect(r.attributes.find((a) => a.key === "location")?.value).toBe("SAN FRANCISCO, CA");
    expect(r.edges.find((e) => e.predicate === "works_at")?.object).toBe("META PLATFORMS, INC.");
  });
});

describe("B7 academic (openalex)", () => {
  const j = { results: [{ display_name: "Lee Example", works_count: 477, cited_by_count: 300000, orcid: "https://orcid.org/0000-0002-1234-5678", last_known_institutions: [{ display_name: "Courant Institute" }], x_concepts: [{ display_name: "Deep learning", score: 90 }, { display_name: "Noise", score: 10 }] }] };
  const r = parseOpenAlex(j, "Lee Example");
  it("emits person, affiliation edge, works_count and orcid", () => {
    expect(r.entities.find((e) => e.type === "person")?.name).toBe("Lee Example");
    expect(r.edges.find((e) => e.predicate === "affiliated_with")?.object).toBe("Courant Institute");
    expect(r.attributes.find((a) => a.key === "works_count")?.value).toBe("477");
    expect(r.attributes.find((a) => a.key === "orcid")?.value).toBe("0000-0002-1234-5678");
  });
  it("keeps only high-score research topics", () => {
    const topics = r.attributes.filter((a) => a.key === "research_topic").map((a) => a.value);
    expect(topics).toEqual(["Deep learning"]);
  });
});

describe("B5 username — checkSite detection", () => {
  const site: WmnSite = { name: "GitHub", uri_check: "https://github.com/{account}", e_code: 200, e_string: "js-profile", m_code: 404, m_string: "Not Found", cat: "coding" };
  it("exists when status==e_code and e_string present", () => {
    expect(checkSite(site, 200, "<div class='js-profile'>")).toBe("exists");
  });
  it("missing when status==m_code and m_string present", () => {
    expect(checkSite(site, 404, "Not Found")).toBe("missing");
  });
  it("unknown when neither rule matches (e.g. e_code but e_string absent)", () => {
    expect(checkSite(site, 200, "totally different page")).toBe("unknown");
  });
});

describe("B1 hibp account (appearance only)", () => {
  it("emits breached_in edges with dates + weak domain pivots", () => {
    const r = parseHibpAccount([{ Name: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04" }, { Name: "LinkedIn", Domain: "linkedin.com", BreachDate: "2012-05-05" }], "jane@example.com");
    const e = r.edges.filter((x) => x.predicate === "breached_in");
    expect(e.map((x) => x.object)).toEqual(["adobe.com", "linkedin.com"]);
    expect(e[0]?.at).toBe("2013-10-04");
    expect(r.pivots.every((p) => p.weak)).toBe(true);
    expect(r.provenance.note).toMatch(/appearance only/i);
  });
});

describe("B4 hunter email pattern", () => {
  const j = { data: { pattern: "{first}.{last}", organization: "OpenAI", emails: [{ value: "sam@openai.com", first_name: "Sam", last_name: "Sample", position: "CEO" }] } };
  const r = parseHunter(j, "openai.com");
  it("emits pattern, email pivot, and person→works_at with occupation", () => {
    expect(r.attributes.find((a) => a.key === "email_pattern")?.value).toBe("{first}.{last}");
    expect(r.pivots.find((p) => p.kind === "email")?.value).toBe("sam@openai.com");
    expect(r.edges.find((e) => e.predicate === "works_at")).toMatchObject({ subject: "Sam Sample", object: "OpenAI" });
    expect(r.attributes.find((a) => a.key === "occupation")?.value).toBe("CEO");
  });
});

describe("B9 relatives (wikitree, shape assumed)", () => {
  it("emits spouse_of / parent_of edges + relative name pivots", () => {
    const j = { 0: { profiles: { "123": { RealName: "Jane Doe", Spouses: { "456": { RealName: "John Doe" } }, Children: { "789": { RealName: "Kid Doe" } } } } } };
    const r = parseWikitree(j as never, "Jane Doe");
    expect(r.edges.find((e) => e.predicate === "spouse_of")?.object).toBe("John Doe");
    expect(r.edges.find((e) => e.predicate === "parent_of")?.object).toBe("Kid Doe");
    expect(r.pivots.map((p) => p.value)).toEqual(expect.arrayContaining(["John Doe", "Kid Doe"]));
  });
});

describe("gated darker capabilities are registered (not called)", () => {
  it("lists brokers/breach-records/enrichment, all gated+spicy", () => {
    expect(GATED_PEOPLE.length).toBeGreaterThanOrEqual(3);
    expect(GATED_PEOPLE.every((c) => c.gated && c.tier === "spicy")).toBe(true);
    expect(GATED_PEOPLE.map((c) => c.id)).toEqual(expect.arrayContaining(["people.broker", "people.breach_records", "people.enrichment"]));
  });
});
