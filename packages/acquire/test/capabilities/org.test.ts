// Cluster D parse tests — fixtures are real response shapes captured live on 2026-09-02 (research/17 §D).
import { describe, it, expect } from "vitest";
import { parseEdgarSubmissions, matchTicker, parseEdgarCompanyList, parseGleif, parseWikidata, wdTime, wdLinkedIds, parseProPublica, parseUsaSpending, parseCourtListener, partyType, parseCompaniesHouse, chName, parseOpenCorporates, parseOpenSanctions, type OsResult } from "../../src/capabilities/org.ts";
import { aggregateRecurring } from "../../src/capabilities/types.ts";

describe("aggregateRecurring (HANDOFF §5.4)", () => {
  it("collapses ≥3 dated numeric edges with the same triple into one edge with count/total/span", () => {
    const edges = [1, 2, 3, 4].map((i) => ({ subject: "A", predicate: "donated_to", object: "PAC", at: `2024-0${i}-01`, value: "192.31" }));
    const out = aggregateRecurring(edges);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "2024-01-01", to: "2024-04-01", value: "769.24", qualifiers: { count: "4", total: "769.24" } });
  });
  it("keeps singletons and undated/non-numeric groups verbatim", () => {
    const edges = [{ subject: "A", predicate: "x", object: "B", value: "1", at: "2024" }, { subject: "A", predicate: "y", object: "C" }, { subject: "A", predicate: "y", object: "C" }, { subject: "A", predicate: "y", object: "C" }];
    expect(aggregateRecurring(edges)).toHaveLength(4);
  });
});

describe("D1 edgar", () => {
  const j = {
    cik: "0001321655", name: "Palantir Technologies Inc.", entityType: "operating", sic: "7372", sicDescription: "Services-Prepackaged Software", ein: "680551851", lei: null,
    tickers: ["PLTR"], exchanges: ["Nasdaq"], website: "", investorWebsite: "https://investors.palantir.com", stateOfIncorporation: "DE", category: "Large accelerated filer",
    formerNames: [{ name: "Palantir Technologies Inc", from: "2005-03-22T00:00:00.000Z", to: "2011-09-07T00:00:00.000Z" }],
    addresses: { business: { street1: "1200 17TH STREET", city: "DENVER", stateOrCountry: "CO", zipCode: "80202" } },
    filings: { recent: { accessionNumber: ["0001321655-26-000010", "0001321655-26-000009", "0001321655-26-000008", "0001321655-26-000007"], filingDate: ["2026-08-04", "2026-08-03", "2026-08-01", "2026-07-30"], form: ["10-Q", "8-K", "4", "4"], primaryDocument: ["pltr-20260630.htm", "pltr-8k.htm", "wk-form4_1.xml", "wk-form4_2.xml"] } },
  };
  const r = parseEdgarSubmissions(j);
  it("profiles the filer with identifiers and a domain pivot", () => {
    expect(r.entities[0]).toMatchObject({ type: "organization", kind: "public_company", name: "Palantir Technologies Inc.", hints: { cik: "1321655", ein: "680551851" } });
    expect(r.attributes.find((a) => a.key === "ticker")?.value).toBe("PLTR");
    expect(r.attributes.find((a) => a.key === "headquarters")?.value).toBe("1200 17TH STREET, DENVER, CO, 80202");
    expect(r.pivots).toEqual([{ kind: "domain", value: "investors.palantir.com" }]);
  });
  it("lists notable filings individually with archive URLs and aggregates the rest per form", () => {
    const filed = r.edges.filter((e) => e.predicate === "filed");
    expect(filed.map((e) => e.qualifiers?.form)).toEqual(["10-Q", "8-K"]);
    expect(filed[0]!.qualifiers?.url).toBe("https://www.sec.gov/Archives/edgar/data/1321655/000132165526000010/pltr-20260630.htm");
    expect(r.attributes.find((a) => a.key === "filings:4")?.value).toBe("2 (2026-07-30 → 2026-08-01)");
    expect(r.attributes.find((a) => a.key === "sec_filings_total")?.value).toBe("4 (2026-07-30 → 2026-08-04)");
    expect(r.attributes.find((a) => a.key === "first_sec_filing")?.value).toBe("2026-07-30");
  });
  it("records former names as dated edges", () => {
    expect(r.edges.find((e) => e.predicate === "formerly_known_as")).toMatchObject({ object: "Palantir Technologies Inc", from: "2005-03-22", to: "2011-09-07" });
  });
  it("types an insider filer (no SIC/EIN/ticker, personal name) as a person", () => {
    expect(parseEdgarSubmissions({ cik: "0001234567", name: "Sample Alex C", ein: "000000000" }).entities[0]!.type).toBe("person");
  });
  it("matches tickers by symbol, exact stem, then substring", () => {
    const rows = [{ cik_str: 1321655, ticker: "PLTR", title: "Palantir Technologies Inc." }, { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }];
    expect(matchTicker(rows, "pltr")?.cik_str).toBe(1321655);
    expect(matchTicker(rows, "PALANTIR TECHNOLOGIES")?.cik_str).toBe(1321655);
    expect(matchTicker(rows, "Apple")?.cik_str).toBe(320193);
    expect(matchTicker(rows, "1321655")?.cik_str).toBe(1321655);
    expect(matchTicker(rows, "Nonexistent Co")).toBeUndefined();
  });
  it("parses the company-browser HTML and ranks the exact name first", () => {
    const html = `<tr><td scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001234567&amp;owner=include">0001234567</a></td><td scope="row">BIRCH HOLDINGS CAPITAL LTD</td><td>DE</td></tr>
<tr><td scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001000001&amp;owner=include">0001000001</a></td>
<td scope="row">BIRCH HOLDINGS INC.</td><td>DE</td></tr>`;
    expect(parseEdgarCompanyList(html, "Birch Holdings Inc")[0]).toEqual({ cik: "0001000001", name: "BIRCH HOLDINGS INC." });
  });
});

describe("D2 gleif", () => {
  const rec = (lei: string, name: string, extra: Record<string, unknown> = {}) => ({ id: lei, attributes: { lei, entity: { legalName: { name }, jurisdiction: "US-DE", status: "ACTIVE", ...extra }, registration: { initialRegistrationDate: "2013-08-16T00:52:00Z" } } });
  const t = {
    record: rec("549300UVN46B3BBDHO85", "PALANTIR TECHNOLOGIES INC.", { registeredAs: "3649383", legalForm: { id: "XTIQ" }, creationDate: "2003-05-06T00:00:00Z", otherNames: [{ name: "PALANTIR TECH", type: "PREVIOUS_LEGAL_NAME" }],
      legalAddress: { addressLines: ["1209 ORANGE ST"], city: "WILMINGTON", region: "US-DE", country: "US" }, headquartersAddress: { addressLines: ["1200 17th Street"], city: "Denver", region: "US-CO", country: "US" } }),
    directParent: null, ultimateParent: null,
    children: [rec("549300ULXLFSKYE9I809", "PALANTIR SHAKTI TECHNOLOGIES PRIVATE LIMITED", { jurisdiction: "IN" })], childrenTotal: 3,
  };
  const r = parseGleif(t as never);
  it("profiles the LEI record", () => {
    expect(r.entities[0]).toMatchObject({ type: "organization", name: "PALANTIR TECHNOLOGIES INC.", hints: { lei: "549300UVN46B3BBDHO85" } });
    expect(r.attributes.find((a) => a.key === "registry_number")?.value).toBe("3649383");
    expect(r.attributes.find((a) => a.key === "founded")?.value).toBe("2003-05-06");
    expect(r.attributes.find((a) => a.key === "former_name")?.value).toBe("PALANTIR TECH");
    expect(r.attributes.find((a) => a.key === "headquarters")?.value).toBe("1200 17th Street, Denver, US-CO, US");
  });
  it("links children as subsidiary_of and emits org pivots; notes truncation", () => {
    expect(r.edges).toEqual([{ subject: "PALANTIR SHAKTI TECHNOLOGIES PRIVATE LIMITED", predicate: "subsidiary_of", object: "PALANTIR TECHNOLOGIES INC." }]);
    expect(r.pivots).toEqual([{ kind: "org", value: "PALANTIR SHAKTI TECHNOLOGIES PRIVATE LIMITED" }]);
    expect(r.provenance.note).toMatch(/3 direct children/);
  });
  it("links parents upward", () => {
    const r2 = parseGleif({ ...t, directParent: rec("P1", "PARENT CO"), ultimateParent: rec("U1", "ULTIMATE CO"), children: [] } as never);
    expect(r2.edges.map((e) => `${e.subject}|${e.predicate}|${e.object}`)).toEqual(["PALANTIR TECHNOLOGIES INC.|subsidiary_of|PARENT CO", "PALANTIR TECHNOLOGIES INC.|ultimately_owned_by|ULTIMATE CO"]);
  });
});

describe("D3 wikidata", () => {
  const item = (id: string) => ({ mainsnak: { datavalue: { type: "wikibase-entityid", value: { id } } } });
  const time = (t: string, precision: number) => ({ mainsnak: { datavalue: { type: "time", value: { time: t, precision } } } });
  const e = {
    id: "Q2047336", labels: { en: { value: "Palantir Technologies" } }, descriptions: { en: { value: "American software company" } }, aliases: { en: [{ value: "Palantir" }] },
    claims: {
      P31: [item("Q4830453")],
      P112: [item("Q313115"), item("Q6208194")],
      P169: [{ ...item("Q4720033"), qualifiers: { P580: [{ datavalue: { type: "time", value: { time: "+2003-00-00T00:00:00Z", precision: 9 } } }] } }],
      P127: [item("Q4720033"), item("Q849363")],
      P749: [{ ...item("Q95"), rank: "deprecated" }],
      P571: [time("+2003-05-06T00:00:00Z", 11)],
      P856: [{ mainsnak: { datavalue: { type: "string", value: "https://www.palantir.com/" } } }],
      P1128: [{ mainsnak: { datavalue: { type: "quantity", value: { amount: "+3936", unit: "1" } } } }],
      P2002: [{ mainsnak: { datavalue: { type: "string", value: "PalantirTech" } } }],
    },
  };
  const resolved = { Q313115: { label: "Pat Founder", human: true }, Q6208194: { label: "Jo Cofounder", human: true }, Q4720033: { label: "Alex C. Sample", human: true }, Q849363: { label: "The Vanguard Group", org: true } };
  const r = parseWikidata(e as never, resolved);
  it("emits typed relationships with the item deciding person vs org", () => {
    expect(r.entities[0]).toMatchObject({ type: "organization", name: "Palantir Technologies", hints: { wikidata: "Q2047336" } });
    expect(r.edges.find((x) => x.predicate === "led_by")).toMatchObject({ object: "Alex C. Sample", from: "2003" });
    const owned = r.edges.filter((x) => x.predicate === "owned_by").map((x) => x.object);
    expect(owned).toEqual(["Alex C. Sample", "The Vanguard Group"]);
    expect(r.entities.find((x) => x.name === "Alex C. Sample")?.type).toBe("person");
    expect(r.pivots.filter((p) => p.kind === "name").map((p) => p.value)).toEqual(["Pat Founder", "Jo Cofounder", "Alex C. Sample"]);
    expect(r.pivots.find((p) => p.kind === "org")?.value).toBe("The Vanguard Group");
  });
  it("skips deprecated claims and unresolved labels", () => {
    expect(r.edges.find((x) => x.predicate === "subsidiary_of")).toBeUndefined();
  });
  it("maps attributes: dates by precision, quantities, website → domain pivot, twitter → username pivot", () => {
    expect(r.attributes.find((a) => a.key === "founded")?.value).toBe("2003-05-06");
    expect(r.attributes.find((a) => a.key === "employees")?.value).toBe("3936");
    expect(r.pivots).toEqual(expect.arrayContaining([{ kind: "domain", value: "palantir.com" }, { kind: "username", value: "PalantirTech" }]));
    expect(wdTime({ time: "+2010-00-00T00:00:00Z", precision: 9 })).toBe("2010");
    expect(wdTime({ time: "+2010-05-00T00:00:00Z", precision: 10 })).toBe("2010-05");
  });
  it("collects linked ids for batch resolution", () => {
    expect(wdLinkedIds(e as never).sort()).toEqual(["Q313115", "Q4720033", "Q6208194", "Q849363", "Q95"]);
  });
  it("types a human item as a person", () => {
    const h = { id: "Q1", labels: { en: { value: "Jane Doe" } }, claims: { P31: [item("Q5")], P108: [item("Q2")] } };
    const rr = parseWikidata(h as never, { Q2: { label: "Acme Corp", org: true } });
    expect(rr.entities[0]!.type).toBe("person");
    expect(rr.edges[0]).toMatchObject({ subject: "Jane Doe", predicate: "works_at", object: "Acme Corp" });
  });
});

describe("D4 nonprofit (propublica)", () => {
  const j = { organization: { ein: 810861541, name: "Openai Inc", address: "3180 18TH ST", city: "San Francisco", state: "CA", zipcode: "94110", ntee_code: "U40", subsection_code: 3, ruling_date: "2016-11-01" },
    filings_with_data: [{ tax_prd_yr: 2023, totrevenue: 5363248, totfuncexpns: 2866846, totassetsend: 22678253, compnsatncurrofcr: 0, pdf_url: null }, { tax_prd_yr: 2022, totrevenue: 100, pdf_url: "https://x/990.pdf" }], filings_without_data: [{ tax_prd_yr: 2016 }] };
  const r = parseProPublica(j);
  it("profiles the nonprofit with a formatted EIN and tax status", () => {
    expect(r.entities[0]).toMatchObject({ type: "organization", kind: "nonprofit", name: "Openai Inc", hints: { ein: "81-0861541" } });
    expect(r.attributes.find((a) => a.key === "tax_status")?.value).toBe("501(c)(3)");
    expect(r.attributes.find((a) => a.key === "irs_ruling_date")?.value).toBe("2016-11");
  });
  it("emits per-year financials as dated attributes and a filings span", () => {
    expect(r.attributes.filter((a) => a.key === "revenue").map((a) => [a.at, a.value])).toEqual([["2023", "5363248"], ["2022", "100"]]);
    expect(r.attributes.find((a) => a.key === "officer_compensation")).toBeUndefined();
    expect(r.attributes.find((a) => a.key === "filings:990")?.value).toBe("3 (2016 → 2023)");
    expect(r.pivots).toEqual([{ kind: "url", value: "https://x/990.pdf" }]);
  });
});

describe("D5 usaspending", () => {
  const award = (id: string, recipient: string, sub: string, amt: number, start: string) => ({ "Award ID": id, "Recipient Name": recipient, "Awarding Agency": "Department of Defense", "Awarding Sub Agency": sub, "Award Amount": amt, "Start Date": start, "End Date": "2026-05-31", Description: "TASK ORDER", generated_internal_id: `CONT_AWD_${id}` });
  const awards = [award("W1", "PALANTIR USG INC", "Department of the Army", 292680689.24, "2024-06-18"), award("W2", "PALANTIR USG INC", "Department of the Army", 1000, "2023-01-01"), award("W3", "PALANTIR USG INC", "Department of the Army", 500, "2022-01-01"), award("H1", "PALANTIR TECHNOLOGIES INC.", "U.S. Special Operations Command", 275959237.71, "2016-05-24")];
  const r = parseUsaSpending(awards, "Palantir Technologies");
  it("picks the dominant recipient as subject and links sibling recipients", () => {
    expect(r.entities[0]!.name).toBe("PALANTIR USG INC");
    expect(r.attributes).toEqual([{ entity: "PALANTIR USG INC", key: "related_recipient", value: "PALANTIR TECHNOLOGIES INC." }]);
  });
  it("aggregates per-agency awards (count/total/span) and lists the top awards with URLs", () => {
    const agg = r.edges.find((e) => e.predicate === "awarded_contract_by" && e.object === "Department of the Army");
    expect(agg).toMatchObject({ from: "2022-01-01", to: "2024-06-18", qualifiers: { count: "3", total: "292682189.24" } });
    const single = r.edges.find((e) => e.predicate === "awarded_contract_by" && e.object === "U.S. Special Operations Command");
    expect(single).toMatchObject({ at: "2016-05-24", value: "275959237.71" });
    expect(single?.qualifiers).toBeUndefined();
    expect(r.edges.find((e) => e.predicate === "holds_contract")?.qualifiers?.url).toBe("https://www.usaspending.gov/award/CONT_AWD_W1");
    expect(r.edges.find((e) => e.predicate === "part_of")).toMatchObject({ subject: "Department of the Army", object: "Department of Defense" });
  });
  it("notes an empty result", () => {
    expect(parseUsaSpending([], "Nobody Inc").provenance.note).toMatch(/no federal awards/);
  });
});

describe("D6 court (courtlistener)", () => {
  const dockets = [
    { caseName: "Plaintiff v. Palantir Technologies Inc", docketNumber: "1:26-cv-00426", court: "District Court, D. Hawaii", dateFiled: "2026-08-06", dateTerminated: null, party: ["Taylor Plaintiff", "Palantir Technologies Inc", "Anthropic PBC"], firm: ["Crowell and Moring LLP"], docket_absolute_url: "/docket/1/plaintiff/", suitNature: "Civil Rights" },
    { caseName: "Gribble v. Anthropic PBC", docketNumber: "2", court: "D. Hawaii", dateFiled: "2026-08-10", party: ["Gribble", "Anthropic PBC"] },
    { caseName: "IN RE SUBPOENAS SERVED ON PALANTIR TECHNOLOGIES INC.", court: "N.D. Cal.", dateFiled: "2026-05-22", party: ["CELONIS SE", "SUBPOENAS SERVED ON PALANTIR TECHNOLOGIES INC."] },
  ];
  const opinions = [{ caseName: "KT4 Partners LLC v. Palantir Technologies", docketNumber: "42, 2021", court: "Supreme Court of Delaware", dateFiled: "2021-09-23", absolute_url: "/opinion/5150237/kt4/", citation: ["2021 WL 1"], status: "Published" }];
  const r = parseCourtListener(dockets, opinions, "Palantir Technologies");
  it("keeps only cases naming the subject and links co-litigants without asserting sides", () => {
    const cases = r.edges.filter((e) => e.predicate === "party_to").map((e) => e.object);
    expect(cases).toEqual(["Plaintiff v. Palantir Technologies Inc", "IN RE SUBPOENAS SERVED ON PALANTIR TECHNOLOGIES INC.", "KT4 Partners LLC v. Palantir Technologies"]);
    const co = r.edges.filter((e) => e.predicate === "co_litigant").map((e) => e.object);
    expect(co).toEqual(["Taylor Plaintiff", "Anthropic PBC", "CELONIS SE"]);
    expect(r.entities.find((e) => e.name === "Taylor Plaintiff")?.type).toBe("person");
    expect(r.entities.find((e) => e.name === "Anthropic PBC")?.type).toBe("organization");
  });
  it("carries court/docket/url qualifiers and counsel edges", () => {
    const h = r.edges.find((e) => e.object === "Plaintiff v. Palantir Technologies Inc")!;
    expect(h.qualifiers).toMatchObject({ court: "District Court, D. Hawaii", docket: "1:26-cv-00426", nature: "Civil Rights", url: "https://www.courtlistener.com/docket/1/plaintiff/" });
    expect(r.edges.find((e) => e.predicate === "counsel_in")).toMatchObject({ subject: "Crowell and Moring LLP" });
    expect(r.edges.find((e) => e.object === "KT4 Partners LLC v. Palantir Technologies")?.qualifiers).toMatchObject({ kind: "opinion", citation: "2021 WL 1" });
  });
  it("guesses party types conservatively", () => {
    expect(partyType("Jane Doe")).toBe("person");
    expect(partyType("The United States of America")).toBe("organization");
    expect(partyType("Acme Holdings LLC")).toBe("organization");
  });
});

describe("D7 companies house", () => {
  const c = { company_name: "DEEPMIND TECHNOLOGIES LIMITED", company_number: "07386350", company_status: "active", type: "ltd", date_of_creation: "2010-09-23", sic_codes: ["62012"], registered_office_address: { address_line_1: "5 New Street Square", locality: "London", postal_code: "EC4A 3TW", country: "United Kingdom" }, previous_company_names: [{ name: "DEEPMIND TECHNOLOGIES LTD", ceased_on: "2014-01-01", effective_from: "2010-09-23" }] };
  const officers = [{ name: "EXAMPLE, Dana", officer_role: "director", appointed_on: "2010-09-23", nationality: "British", occupation: "Company Director", date_of_birth: { month: 3, year: 1980 }, country_of_residence: "United Kingdom" }, { name: "GOOGLE UK LIMITED", officer_role: "corporate-secretary", appointed_on: "2014-01-27", resigned_on: "2016-01-01" }];
  const pscs = [{ name: "Google Llc", kind: "corporate-entity-person-with-significant-control", natures_of_control: ["ownership-of-shares-75-to-100-percent"], notified_on: "2016-04-06", identification: { registration_number: "3582691" } }];
  const r = parseCompaniesHouse(c, officers, pscs);
  it("flips SURNAME, Given to natural order", () => {
    expect(chName("EXAMPLE, Dana")).toBe("Dana Example");
    expect(chName("VAN DER BERG, Jan")).toBe("Jan Van Der Berg");
  });
  it("profiles the company and its former name", () => {
    expect(r.entities[0]).toMatchObject({ name: "DEEPMIND TECHNOLOGIES LIMITED", hints: { companies_house: "07386350" } });
    expect(r.attributes.find((a) => a.key === "founded")?.value).toBe("2010-09-23");
    expect(r.edges.find((e) => e.predicate === "formerly_known_as")).toMatchObject({ object: "DEEPMIND TECHNOLOGIES LTD", from: "2010-09-23", to: "2014-01-01" });
  });
  it("emits officers (person vs corporate) with roles/dates and PSC control edges", () => {
    expect(r.edges.find((e) => e.subject === "Dana Example")).toMatchObject({ predicate: "officer_of", from: "2010-09-23", qualifiers: { role: "director", occupation: "Company Director" } });
    expect(r.attributes.find((a) => a.entity === "Dana Example" && a.key === "birth_year_month")?.value).toBe("1980-03");
    expect(r.entities.find((e) => e.name === "GOOGLE UK LIMITED")?.type).toBe("organization");
    expect(r.edges.find((e) => e.predicate === "controls")).toMatchObject({ subject: "Google Llc", object: "DEEPMIND TECHNOLOGIES LIMITED", qualifiers: { nature: "ownership-of-shares-75-to-100-percent" } });
    expect(r.pivots).toEqual(expect.arrayContaining([{ kind: "name", value: "Dana Example" }, { kind: "org", value: "Google Llc" }]));
  });
});

describe("D8 opencorporates", () => {
  const company = { name: "BIRCH HOLDINGS INC.", company_number: "7654321", jurisdiction_code: "us_de", incorporation_date: "2019-03-01", current_status: "Active", company_type: "Corporation", registered_address_in_full: "251 Little Falls Drive\nWilmington, DE 19808", opencorporates_url: "https://opencorporates.com/companies/us_de/7654321", previous_names: [{ company_name: "BIRCH ENTERPRISES INC.", end_date: "2020-01-01" }], officers: [{ officer: { name: "Dana Example", position: "president", start_date: "2019-03-01", end_date: null } }] };
  it("profiles the company with officers as name pivots", () => {
    const r = parseOpenCorporates(company, [], "Birch Holdings");
    expect(r.entities[0]).toMatchObject({ name: "BIRCH HOLDINGS INC.", hints: { opencorporates: "us_de/7654321" } });
    expect(r.attributes.find((a) => a.key === "jurisdiction")?.value).toBe("US-DE");
    expect(r.edges.find((e) => e.predicate === "officer_of")).toMatchObject({ subject: "Dana Example", object: "BIRCH HOLDINGS INC.", qualifiers: { role: "president" } });
    expect(r.pivots).toEqual([{ kind: "name", value: "Dana Example" }]);
  });
  it("reverse officer search fans a person out to their companies (org pivots)", () => {
    const hits = [{ officer: { name: "EXAMPLE, DANA", position: "director", start_date: "2018-01-01", end_date: null, company: { name: "BIRCH ANALYTICS INC.", jurisdiction_code: "us_ca", company_number: "C1" } } }];
    const r = parseOpenCorporates(null, hits, "Dana Example");
    expect(r.edges[0]).toMatchObject({ subject: "Dana Example", predicate: "officer_of", object: "BIRCH ANALYTICS INC.", qualifiers: { role: "director", jurisdiction: "US_CA" } });
    expect(r.pivots).toEqual([{ kind: "org", value: "BIRCH ANALYTICS INC." }]);
  });
  it("notes no match", () => { expect(parseOpenCorporates(null, [], "x").provenance.note).toMatch(/no OpenCorporates/); });
});

describe("D9 sanctions (opensanctions)", () => {
  const results: OsResult[] = [
    { id: "Q-1", caption: "Ivan Sample", schema: "Person", datasets: ["us_ofac_sdn", "eu_fsf"], target: true, first_seen: "2014-04-28T00:00:00", properties: { topics: ["sanction", "role.pep"], birthDate: ["1965-04-12"], nationality: ["ru"], position: ["CEO of Example Energy"], alias: ["Ivan Ivanovich Sample"], email: ["x@example.com"] } },
    { id: "Q-2", caption: "Sample Something Else", schema: "Company", datasets: ["ru_egrul"], properties: { topics: [] } },
  ];
  const r = parseOpenSanctions(results, "Ivan Sample");
  it("emits matched hits with risk topics, listings and identity attributes", () => {
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]).toMatchObject({ type: "person", name: "Ivan Sample", hints: { opensanctions: "Q-1" } });
    expect(r.attributes.filter((a) => a.key === "risk_topic").map((a) => a.value)).toEqual(["sanction", "role.pep"]);
    expect(r.edges.map((e) => e.object)).toEqual(["us_ofac_sdn", "eu_fsf"]);
    expect(r.attributes.find((a) => a.key === "birth_date")?.value).toBe("1965-04-12");
    expect(r.pivots).toEqual([{ kind: "email", value: "x@example.com" }]);
  });
  it("notes no match", () => { expect(parseOpenSanctions(results, "Nobody").provenance.note).toMatch(/no OpenSanctions match/); });
});
