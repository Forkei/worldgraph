// The graph bridge: CapabilityResult → ExtractionOutput. Checks vocabulary mapping, identity hints, swaps,
// attribute→relation promotions, time mapping, and that every quote is findable in the synthetic source text.
import { describe, it, expect } from "vitest";
import { registry } from "@worldgraph/core";
import { capabilityToExtraction, mapEntityType, mapHints, GRADE_TIER } from "../../src/capabilities/toExtraction.ts";
import type { CapabilityResult } from "../../src/capabilities/types.ts";

const reg = registry();
const prov = { capability: "org.test", source: "Test Registry", fetched_at: "2026-09-02T10:00:00.000Z", grade: "A" as const, tier: "easy" as const, url: "https://api.example.org/x" };
const base = (over: Partial<CapabilityResult>): CapabilityResult => ({ provenance: prov, entities: [], edges: [], attributes: [], pivots: [], ...over });
const mentionOf = (o: ReturnType<typeof capabilityToExtraction>, name: string) => o.output.mentions.find((m) => m.name === name)!;
const relOf = (o: ReturnType<typeof capabilityToExtraction>, pred: string) => o.output.relations.filter((r) => r.predicate === pred || r.candidate_label === pred);
const nameOfRef = (o: ReturnType<typeof capabilityToExtraction>, ref: string) => o.output.mentions.find((m) => m.ref === ref)!.name;

describe("entity types + identity hints", () => {
  it("maps capability types onto registry node types and kinds", () => {
    expect(mapEntityType({ type: "organization", kind: "public_company", name: "X" })).toMatchObject({ type: "organization", kind: "company" });
    expect(mapEntityType({ type: "organization", kind: "government_agency", name: "X" })).toMatchObject({ type: "organization", kind: "agency" });
    expect(mapEntityType({ type: "hostname", name: "a.b.com" })).toMatchObject({ type: "account", kind: "hostname" });
    expect(mapEntityType({ type: "ip_address", name: "1.2.3.4" })).toMatchObject({ type: "account", kind: "ip" });
    expect(mapEntityType({ type: "legal_case", name: "A v. B" })).toMatchObject({ type: "legal_matter", kind: "case" });
    expect(mapEntityType({ type: "concept", name: "software" })).toMatchObject({ type: "candidate", type_label: "concept", type_parent: "artifact" });
  });
  it("picks the strongest external id as registry_id and keeps the rest as soft hints", () => {
    expect(mapHints({ type: "organization", name: "X", hints: { wikidata: "Q1", lei: "LEI1", cik: "123" } }, "organization")).toMatchObject({ registry_id: "lei:LEI1" });
    expect(mapHints({ type: "organization", name: "X", hints: { companies_house: "07386350", jurisdiction: "GB" } }, "organization")).toEqual({ registry_id: "companies_house:07386350", jurisdiction: "GB" });
    expect(mapHints({ type: "email", name: "a@b.c" }, "account")).toEqual({ identifier: "a@b.c" });
    expect(mapHints({ type: "person", name: "J", hints: { email: "j@x.y", orcid: "0000-1" } }, "person")).toEqual({ email: "j@x.y", orcid: "0000-1" });
  });
});

describe("relations", () => {
  const r = base({
    entities: [{ type: "organization", kind: "public_company", name: "Palantir Technologies", hints: { wikidata: "Q2047336" } }, { type: "person", name: "Pat Founder" }, { type: "person", name: "Alex C. Sample" }, { type: "organization", name: "Palantir France" }],
    edges: [
      { subject: "Palantir Technologies", predicate: "founded_by", object: "Pat Founder" },
      { subject: "Palantir Technologies", predicate: "led_by", object: "Alex C. Sample", from: "2003" },
      { subject: "Palantir France", predicate: "subsidiary_of", object: "Palantir Technologies" },
      { subject: "Palantir Technologies", predicate: "headquartered_in", object: "Denver" },
      { subject: "Alex C. Sample", predicate: "officer_of", object: "Palantir Technologies", qualifiers: { role: "director" }, from: "2005-01-01" },
      { subject: "Palantir Technologies", predicate: "formerly_known_as", object: "Palantir Tech Inc", from: "2005-03-22", to: "2011-09-07" },
      { subject: "Palantir Technologies", predicate: "filed", object: "10-K 2026-02-17", at: "2026-02-17", qualifiers: { form: "10-K", url: "https://sec.gov/x" } },
      { subject: "Palantir Technologies", predicate: "holds_contract", object: "W911QX24F0053 (Army)", from: "2024-06-18", to: "2026-05-31", value: "292680689.24" },
      { subject: "Palantir Technologies", predicate: "frobnicated_with", object: "Pat Founder" },
    ],
  });
  const o = capabilityToExtraction(r, "Palantir Technologies", reg);
  it("swaps inverse predicates onto registry ones (founded_by → founded, led_by → manages with a role)", () => {
    const f = relOf(o, "founded")[0]!;
    expect(nameOfRef(o, f.subject)).toBe("Pat Founder"); expect(nameOfRef(o, f.object)).toBe("Palantir Technologies");
    const m = relOf(o, "manages")[0]!;
    expect(nameOfRef(o, m.subject)).toBe("Alex C. Sample");
    expect(m.qualifiers).toEqual([{ key: "role", value: "chief executive" }]);
    expect(m).toMatchObject({ temporal_kind: "interval", valid_from: "2003", time_qualifier: "exact" });
  });
  it("keeps direct predicates and promotes place-ish edges to located_in with a place mention", () => {
    expect(relOf(o, "subsidiary_of")).toHaveLength(1);
    const l = relOf(o, "located_in")[0]!;
    expect(mentionOf(o, "Denver")).toMatchObject({ type: "place", kind: "city" });
    expect(l.qualifiers).toEqual([{ key: "kind", value: "headquartered_in" }]);
  });
  it("routes officer_of by role (director → board_member)", () => {
    expect(relOf(o, "board_member")[0]).toMatchObject({ valid_from: "2005-01-01" });
  });
  it("turns formerly_known_as into a dated aliases attribute", () => {
    const a = o.output.attributes.find((x) => x.key === "aliases")!;
    expect(a.value).toBe("Palantir Tech Inc");
    expect(a).toMatchObject({ temporal_kind: "snapshot", date: "2005-03-22" });
  });
  it("creates typed object mentions for filings and contracts", () => {
    expect(mentionOf(o, "10-K 2026-02-17")).toMatchObject({ type: "document", kind: "filing" });
    expect(relOf(o, "authored")[0]!.qualifiers).toEqual(expect.arrayContaining([{ key: "form", value: "10-K" }]));
    expect(mentionOf(o, "W911QX24F0053 (Army)")).toMatchObject({ type: "transaction", kind: "contract_award" });
    expect(relOf(o, "participated_in")[0]!.qualifiers).toEqual(expect.arrayContaining([{ key: "value", value: "292680689.24" }]));
  });
  it("never drops an unknown predicate: it becomes a candidate under the root", () => {
    const c = relOf(o, "frobnicated_with")[0]!;
    expect(c).toMatchObject({ predicate: "candidate", candidate_label: "frobnicated_with", candidate_parent: "associated_with" });
  });
  it("falls back to a candidate when a mapped predicate would violate the registry's domain/range", () => {
    const r2 = base({ entities: [{ type: "domain", name: "example.com" }, { type: "organization", kind: "registrar", name: "MarkMonitor Inc." }], edges: [{ subject: "example.com", predicate: "subsidiary_of", object: "MarkMonitor Inc." }] });
    const o2 = capabilityToExtraction(r2, "example.com", reg);
    expect(o2.output.relations[0]).toMatchObject({ predicate: "candidate", candidate_label: "subsidiary_of", candidate_parent: "associated_with" });
  });
  it("carries the entity's registry id into the mention hints", () => {
    expect(mentionOf(o, "Palantir Technologies").hints).toEqual([{ key: "registry_id", value: "wikidata:Q2047336" }]);
  });
});

describe("attributes", () => {
  const r = base({
    entities: [{ type: "organization", name: "Acme Corp" }, { type: "person", name: "Jane Doe" }],
    attributes: [
      { entity: "Acme Corp", key: "cik", value: "1321655" }, { entity: "Acme Corp", key: "lei", value: "549300UVN46B3BBDHO85" },
      { entity: "Acme Corp", key: "founded", value: "2003-05-06" }, { entity: "Acme Corp", key: "entity_status", value: "ACTIVE" },
      { entity: "Acme Corp", key: "website", value: "https://acme.example" }, { entity: "Acme Corp", key: "employees", value: "3936" },
      { entity: "Acme Corp", key: "revenue", value: "5363248", at: "2023" }, { entity: "Acme Corp", key: "headquarters", value: "1200 17th St, Denver, CO" },
      { entity: "Acme Corp", key: "filings:4", value: "12 (2024 → 2026)" }, { entity: "Acme Corp", key: "twitter", value: "acme" },
      { entity: "Jane Doe", key: "email", value: "jane@acme.example" }, { entity: "Jane Doe", key: "birth_year_month", value: "1980-03" }, { entity: "Jane Doe", key: "sanctions_target", value: "true" },
    ],
  });
  const o = capabilityToExtraction(r, "Acme Corp", reg);
  const attr = (key: string) => o.output.attributes.filter((a) => a.key === key);
  it("folds external identifiers into scheme:value registry_id attributes", () => {
    expect(attr("registry_id").map((a) => a.value)).toEqual(["cik:1321655", "lei:549300UVN46B3BBDHO85"]);
  });
  it("maps known keys with datatypes and dates", () => {
    expect(attr("founded_on")[0]).toMatchObject({ value: "2003-05-06", datatype: "date", key_parent: "" });
    expect(attr("status")[0]!.value).toBe("ACTIVE");
    expect(attr("website")[0]!.datatype).toBe("url");
    expect(attr("employee_count")[0]).toMatchObject({ value: "3936", datatype: "number" });
    expect(attr("revenue")[0]).toMatchObject({ datatype: "money", temporal_kind: "snapshot", date: "2023" });
    expect(attr("date_of_birth")[0]).toMatchObject({ value: "1980-03", datatype: "date" });
    expect(attr("status").find((a) => a.value === "sanctioned")).toBeTruthy();
  });
  it("keeps unknown keys as candidates under description", () => {
    expect(attr("filings:4")[0]).toMatchObject({ key_parent: "description", value: "12 (2024 → 2026)" });
  });
  it("promotes addresses to located_in and emails/handles to uses_account with identity hints", () => {
    const loc = o.output.relations.find((x) => x.predicate === "located_in")!;
    expect(nameOfRef(o, loc.object)).toBe("1200 17th St, Denver, CO");
    expect(mentionOf(o, "1200 17th St, Denver, CO")).toMatchObject({ type: "place", kind: "address" });
    const accts = o.output.relations.filter((x) => x.predicate === "uses_account");
    expect(accts.map((x) => nameOfRef(o, x.object)).sort()).toEqual(["acme", "jane@acme.example"]);
    expect(mentionOf(o, "jane@acme.example")).toMatchObject({ type: "account", kind: "email", hints: [{ key: "identifier", value: "jane@acme.example" }] });
    expect(mentionOf(o, "acme").hints).toEqual(expect.arrayContaining([{ key: "platform", value: "twitter" }]));
  });
});

describe("provenance text + page", () => {
  const r = base({ entities: [{ type: "organization", name: "Acme Corp" }], edges: [{ subject: "Acme Corp", predicate: "subsidiary_of", object: "Mega Corp", from: "2019" }], attributes: [{ entity: "Acme Corp", key: "ticker", value: "ACME" }] });
  const o = capabilityToExtraction(r, "Acme Corp", reg);
  it("every quote is found verbatim in the synthetic source text (so spans resolve exact)", () => {
    for (const q of [...o.output.relations, ...o.output.attributes].map((x) => x.quote)) expect(o.text.includes(q)).toBe(true);
    expect(o.text.split("\n")[0]).toBe("Test Registry · org.test · Acme Corp");
  });
  it("fills the page block from provenance and files the grade as a tier", () => {
    expect(o.output.page).toMatchObject({ published_at: "2026-09-02", publisher_name: "Test Registry", publisher_kind: "authority" });
    expect(o.title).toBe("Test Registry: Acme Corp");
    expect(GRADE_TIER.low).toBe("E");
  });
});
