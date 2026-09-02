// Cluster C parse tests — fixtures are real response shapes captured live on 2026-09-01 (research/17).
import { describe, it, expect } from "vitest";
import { parseExif, parseReverseImage, parseNominatim, parseOverpass, buildAroundQuery, parseChrono, sunPosition, weatherDescription, parseOpenSky, GATED_MEDIA } from "../../src/capabilities/media.ts";

describe("C1 exif", () => {
  it("extracts timestamp, device, serial, and GPS → coordinates pivot", () => {
    const r = parseExif([{ DateTimeOriginal: "2024:07:04 12:30:00", Make: "Apple", Model: "iPhone 15 Pro", SerialNumber: "ABC123", GPSLatitude: 37.4225, GPSLongitude: -122.0856 }], "photo.jpg");
    expect(r.attributes.find((a) => a.key === "taken_at")?.value).toBe("2024-07-04T12:30:00");
    expect(r.attributes.find((a) => a.key === "device")?.value).toBe("Apple iPhone 15 Pro");
    expect(r.attributes.find((a) => a.key === "device_serial")?.value).toBe("ABC123");
    expect(r.pivots.find((p) => p.kind === "coordinates")?.value).toBe("37.4225,-122.0856");
  });
  it("notes stripped GPS (the social-upload case)", () => {
    const r = parseExif([{ Make: "Canon", Model: "EOS R5" }], "img.jpg");
    expect(r.pivots.find((p) => p.kind === "coordinates")).toBeUndefined();
    expect(r.provenance.note).toMatch(/no GPS/i);
  });
});

describe("C2 reverse image", () => {
  const j = { visual_matches: [{ title: "Albert Einstein", link: "https://en.wikipedia.org/wiki/Albert_Einstein", source: "Wikipedia" }, { title: "Portrait", link: "https://www.instagram.com/p/xyz", source: "Instagram" }] };
  const r = parseReverseImage(j, "https://example.com/face.jpg", "google_lens");
  it("emits appears_on edges + url pivots (grade B)", () => {
    expect(r.provenance.grade).toBe("B");
    expect(r.edges.filter((e) => e.predicate === "appears_on")).toHaveLength(2);
    expect(r.pivots.map((p) => p.value)).toContain("https://www.instagram.com/p/xyz");
  });
  it("notes the empty case (thumbnail URLs return 0)", () => {
    expect(parseReverseImage({ visual_matches: [] }, "https://x/thumb.jpg", "google_lens").provenance.note).toMatch(/full-size/i);
  });
});

describe("C4 geocode", () => {
  it("resolves top hit to a place + coordinates pivot", () => {
    const r = parseNominatim([{ display_name: "Google Building 41, 1600 Amphitheatre Parkway, Mountain View", lat: "37.4224858", lon: "-122.0855846", type: "office" }], "1600 Amphitheatre Parkway");
    expect(r.entities[0]?.name).toMatch(/Amphitheatre/);
    expect(r.attributes.find((a) => a.key === "located_at")?.value).toBe("37.4224858,-122.0855846");
    expect(r.pivots.find((p) => p.kind === "coordinates")?.value).toBe("37.4224858,-122.0855846");
  });
  it("notes an empty result", () => {
    expect(parseNominatim([], "nowhere at all").provenance.note).toMatch(/no geocoding/i);
  });
});

describe("C5 overpass map query", () => {
  it("builds an around-query with a tag filter", () => {
    expect(buildAroundQuery(37.42, -122.08, 150, "amenity=cafe")).toContain("nwr[amenity=cafe](around:150,37.42,-122.08)");
    expect(buildAroundQuery(37.42, -122.08, 150)).toContain("nwr[name](around:150");
  });
  it("parses named POIs (node + way center) into place entities", () => {
    const j = { elements: [{ type: "node", id: 1, lat: 37.4, lon: -122.0, tags: { name: "Blue Bottle", amenity: "cafe" } }, { type: "way", id: 2, center: { lat: 37.41, lon: -122.01 }, tags: { name: "City Hall", building: "civic" } }, { type: "node", id: 3, tags: { amenity: "bench" } }] };
    const r = parseOverpass(j as never);
    expect(r.entities.map((e) => e.name)).toEqual(["Blue Bottle", "City Hall"]); // unnamed bench skipped
    expect(r.entities[0]?.kind).toBe("cafe");
    expect(r.pivots).toHaveLength(2);
  });
});

describe("C6 chronolocation", () => {
  it("SunCalc: sun is up and roughly south at London summer-solstice noon", () => {
    const p = sunPosition(new Date("2023-06-21T12:00:00Z"), 51.5, 0);
    expect(p.altitude).toBeGreaterThan(55);
    expect(p.altitude).toBeLessThan(66);
    expect(p.azimuth).toBeGreaterThan(150); // ~180 = due south
    expect(p.azimuth).toBeLessThan(210);
  });
  it("SunCalc: sun is below the horizon at local midnight", () => {
    expect(sunPosition(new Date("2023-06-21T00:00:00Z"), 51.5, 0).altitude).toBeLessThan(0);
  });
  it("WMO codes map to descriptions", () => {
    expect(weatherDescription(0)).toBe("clear");
    expect(weatherDescription(3)).toBe("partly cloudy");
    expect(weatherDescription(95)).toBe("thunderstorm");
  });
  it("combines sun + weather into a corroboration fact", () => {
    const sun = { altitude: 60, azimuth: 180 };
    const r = parseChrono(sun, { daily: { time: ["2024-07-04"], weather_code: [0], temperature_2m_max: [32.0] } }, 37.42, -122.08, "2024-07-04T12:00:00");
    expect(r.attributes.find((a) => a.key === "sun_phase")?.value).toBe("daytime");
    expect(r.attributes.find((a) => a.key === "weather")?.value).toBe("clear");
    expect(r.attributes.find((a) => a.key === "temperature_max_c")?.value).toBe("32");
    expect(r.provenance.note).toMatch(/corroborate or contradict/i);
  });
});

describe("C7 aircraft", () => {
  it("parses state vectors into aircraft entities", () => {
    const j = { time: 1, states: [["a1b2c3", "N174EM ", "United States", 1, 1, -122.1, 37.4, 1500, false], ["d4e5f6", "  ", "Canada", 1, 1, -122.2, 37.5, 2000, false]] };
    const r = parseOpenSky(j as never);
    expect(r.entities[0]?.name).toBe("N174EM"); // callsign trimmed
    expect(r.entities[0]?.hints?.position).toBe("37.4,-122.1");
    expect(r.entities[1]?.name).toBe("d4e5f6"); // falls back to icao24 when callsign blank
  });
  it("notes an empty box", () => {
    expect(parseOpenSky({ states: null }).provenance.note).toMatch(/no aircraft/i);
  });
});

describe("gated media declarations", () => {
  it("declares spicy/biometric sources without live calls", () => {
    const ids = GATED_MEDIA.map((g) => g.id);
    expect(ids).toContain("media.face_search");
    expect(GATED_MEDIA.every((g) => g.gated)).toBe(true);
  });
});
