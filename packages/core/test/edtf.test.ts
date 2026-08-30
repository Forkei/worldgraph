import { describe, it, expect } from "vitest";
import { parseEdtf, dobFromAge, startFromDuration } from "../src/edtf.ts";

describe("parseEdtf", () => {
  it("parses year / month / day with bounds and precision", () => {
    expect(parseEdtf("2019")).toMatchObject({ edtf: "2019", lo: "2019-01-01", hi: "2019-12-31", precision: "year", qualifier: "exact" });
    expect(parseEdtf("2019-02")).toMatchObject({ edtf: "2019-02", lo: "2019-02-01", hi: "2019-02-28", precision: "month" });
    expect(parseEdtf("2020-02-29")).toMatchObject({ edtf: "2020-02-29", lo: "2020-02-29", hi: "2020-02-29", precision: "day" });
    expect(parseEdtf("2019-13")).toBeNull();
    expect(parseEdtf("2019-02-30")).toBeNull();
  });
  it("handles approximate / uncertain qualifiers", () => {
    expect(parseEdtf("2019~")).toMatchObject({ edtf: "2019~", qualifier: "circa" });
    expect(parseEdtf("circa 1985")).toMatchObject({ edtf: "1985~", qualifier: "circa" });
    expect(parseEdtf("2019?")).toMatchObject({ edtf: "2019?", qualifier: "uncertain" });
  });
  it("handles intervals, sets, decades and unspecified digits", () => {
    expect(parseEdtf("1990/1995")).toMatchObject({ edtf: "1990/1995", lo: "1990-01-01", hi: "1995-12-31", precision: "range" });
    expect(parseEdtf("[1984,1985]")).toMatchObject({ lo: "1984-01-01", hi: "1985-12-31", precision: "range" });
    expect(parseEdtf("1990s")).toMatchObject({ edtf: "199X", lo: "1990-01-01", hi: "1999-12-31", precision: "decade" });
    expect(parseEdtf("early 1990s")).toMatchObject({ lo: "1990-01-01", hi: "1993-12-31" });
    expect(parseEdtf("19XX")).toMatchObject({ lo: "1900-01-01", hi: "1999-12-31", precision: "century" });
  });
  it("accepts ISO datetimes and rejects garbage", () => {
    expect(parseEdtf("2024-01-27T15:21:20.000Z")).toMatchObject({ edtf: "2024-01-27" });
    expect(parseEdtf("")).toBeNull();
    expect(parseEdtf("last spring")).toBeNull();
    expect(parseEdtf("Jan 2001 - Dec 2003")).toBeNull();
  });
});

describe("derived quantities", () => {
  it("turns an age at a date into a date-of-birth set", () => {
    expect(dobFromAge(34, "2019-05-01")).toMatchObject({ edtf: "[1984,1985]", lo: "1984-01-01", hi: "1985-12-31" });
    expect(dobFromAge(-1, "2019-05-01")).toBeNull();
  });
  it("turns a duration into a circa start year", () => {
    expect(startFromDuration(10, "2026-08-30")).toMatchObject({ edtf: "2016~", qualifier: "circa" });
  });
});
