import { describe, it, expect } from "vitest";
import { intervalHoles } from "../src/gaps.ts";

describe("intervalHoles", () => {
  it("finds a hole between two employments and an open tail", () => {
    const holes = intervalHoles([{ lo: "2011-01-01", hi: "2011-12-31" }, { lo: "2016-06-01", hi: "2018-09-30" }], "2026-08-30");
    expect(holes).toEqual([{ lo: "2012-01-01", hi: "2016-05-31" }, { lo: "2018-10-01", hi: "2026-08-30" }]);
  });
  it("treats an ongoing interval as covering to today and ignores small gaps", () => {
    expect(intervalHoles([{ lo: "2013-08-01", hi: "2016-05-31" }, { lo: "2016-06-01", hi: null }], "2026-08-30")).toEqual([]);
    expect(intervalHoles([{ lo: "2010-01-01", hi: "2011-06-30" }, { lo: "2012-01-01", hi: null }], "2026-08-30")).toEqual([]);
  });
  it("returns nothing without dated intervals", () => {
    expect(intervalHoles([{ lo: null, hi: null }], "2026-08-30")).toEqual([]);
  });
});
