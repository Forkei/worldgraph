// Cluster E parse tests — fixtures mirror Apify instagram-scraper item shapes.
import { describe, it, expect } from "vitest";
import { parseIgProfile, parseIgPosts, parseIgComments } from "../../src/capabilities/social.ts";

describe("E1 ig profile", () => {
  const items = [{
    username: "uqua", fullName: "Jay Rivers", biography: "brother of @maxrivers · Denver · link below", externalUrl: "https://linktr.ee/uqua",
    followersCount: 812, followsCount: 300, postsCount: 47, private: false, verified: false, profilePicUrlHD: "https://img/pfp.jpg",
    latestPosts: [{ url: "https://instagram.com/p/AAA", caption: "with the fam", displayUrl: "https://img/1.jpg", taggedUsers: [{ username: "maxrivers", full_name: "Max Rivers" }], locationName: "Denver, Colorado" }],
  }];
  const r = parseIgProfile(items, "uqua");
  it("emits an instagram account entity with display name + counts", () => {
    expect(r.entities.find((e) => e.type === "instagram")?.name).toBe("uqua");
    expect(r.attributes.find((a) => a.key === "display_name")?.value).toBe("Jay Rivers");
    expect(r.attributes.find((a) => a.key === "followers")?.value).toBe("812");
    expect(r.attributes.find((a) => a.key === "following")?.value).toBe("300");
  });
  it("surfaces external link, profile pic image, and bio @mention as pivots", () => {
    expect(r.pivots.find((p) => p.kind === "url")?.value).toBe("https://linktr.ee/uqua");
    expect(r.pivots.some((p) => p.kind === "image" && p.value === "https://img/pfp.jpg")).toBe(true);
    expect(r.pivots.some((p) => p.kind === "username" && p.value === "maxrivers")).toBe(true);
    expect(r.pivots.some((p) => p.kind === "name" && p.value === "Jay Rivers")).toBe(true);
  });
  it("folds latest-post leads: post image + tagged user + full name + location", () => {
    expect(r.pivots.some((p) => p.kind === "image" && p.value === "https://img/1.jpg")).toBe(true);
    expect(r.pivots.some((p) => p.kind === "name" && p.value === "Max Rivers")).toBe(true);
    expect(r.entities.some((e) => e.type === "place" && e.name === "Denver, Colorado")).toBe(true);
    expect(r.edges.some((e) => e.predicate === "tagged_with" && e.object === "maxrivers")).toBe(true);
  });
  it("private/missing profile → note, no entity", () => {
    const rr = parseIgProfile([], "nobody");
    expect(rr.entities).toHaveLength(0);
    expect(rr.provenance.note).toMatch(/no public Instagram/i);
  });
});

describe("E2 ig posts", () => {
  const items = [
    { url: "https://instagram.com/p/AAA", caption: "beach day 🌊", timestamp: "2026-07-01T00:00:00Z", displayUrl: "https://img/a.jpg", images: ["https://img/a2.jpg"], taggedUsers: [{ username: "friend1", full_name: "Sam Friend" }], locationName: "Santa Cruz" },
    { url: "https://instagram.com/p/BBB", caption: "gg @rivalgamer", displayUrl: "https://img/b.jpg", mentions: ["@rivalgamer"] },
  ];
  const r = parseIgPosts(items, "uqua");
  it("surfaces every post image as an image pivot (for look_at)", () => {
    const imgs = r.pivots.filter((p) => p.kind === "image").map((p) => p.value);
    expect(imgs).toEqual(expect.arrayContaining(["https://img/a.jpg", "https://img/a2.jpg", "https://img/b.jpg"]));
  });
  it("captures captions as dated attributes and tagged/mentioned handles as pivots", () => {
    expect(r.attributes.some((a) => a.key === "post_caption" && a.value.includes("beach day"))).toBe(true);
    expect(r.pivots.some((p) => p.kind === "username" && p.value === "friend1")).toBe(true);
    expect(r.pivots.some((p) => p.kind === "username" && p.value === "rivalgamer")).toBe(true);
  });
  it("empty → note", () => {
    expect(parseIgPosts([], "uqua").provenance.note).toMatch(/no posts/i);
  });
});

describe("E3 ig comments", () => {
  it("emits commenter handles, full names, and @-mentions in comment text as pivots", () => {
    const items = [
      { ownerUsername: "auntie_kim", text: "love this! say hi to @grandpajoe", owner: { username: "auntie_kim", full_name: "Kim Rivers" } },
      { ownerUsername: "randokid", text: "🔥" },
    ];
    const r = parseIgComments(items, "https://instagram.com/p/AAA");
    const users = r.pivots.filter((p) => p.kind === "username").map((p) => p.value);
    expect(users).toEqual(expect.arrayContaining(["auntie_kim", "grandpajoe", "randokid"]));
    expect(r.pivots.some((p) => p.kind === "name" && p.value === "Kim Rivers")).toBe(true);
  });
});
