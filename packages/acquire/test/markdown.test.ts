import { describe, it, expect } from "vitest";
import { footnoteLinks } from "../src/markdown.ts";

describe("footnoteLinks", () => {
  it("rewrites inline links to numbered refs and builds a deduped table", () => {
    const { text, links } = footnoteLinks("[Alder Maple](https://am.com) and [ACORN](https://acorn.com), again [AM](https://am.com).");
    expect(text).toBe("[Alder Maple][1] and [ACORN][2], again [AM][1].");
    expect(links).toEqual([
      { n: 1, anchor: "Alder Maple", url: "https://am.com" },
      { n: 2, anchor: "ACORN", url: "https://acorn.com" },
    ]);
  });
  it("keeps markdown structure (tables, headings) untouched", () => {
    const md = "# Title\n\n| Name | Role |\n| --- | --- |\n| Person A | GP |";
    expect(footnoteLinks(md).text).toBe(md);
  });
  it("drops images to alt text, folds autolinks and reference links", () => {
    expect(footnoteLinks("![a photo](https://img.com/x.png)Person A").text).toBe("a photo Person A");
    expect(footnoteLinks("mail <mailto:a@b.com>").links[0]).toEqual({ n: 1, anchor: "mailto:a@b.com", url: "mailto:a@b.com" });
    const ref = footnoteLinks("see [the site][kp]\n\n[kp]: https://am.com");
    expect(ref.text.trim()).toBe("see [the site][1]");
    expect(ref.links[0]!.url).toBe("https://am.com");
  });
  it("handles wiki citation links without leaving noise", () => {
    const { text, links } = footnoteLinks("graduated in 1986[[65]](https://en.wikipedia.org/wiki/X#cite_note-70) with a degree");
    expect(text).toBe("graduated in 1986[[65]][1] with a degree");
    expect(links[0]!.url).toContain("cite_note");
  });
});
