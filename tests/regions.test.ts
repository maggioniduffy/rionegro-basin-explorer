import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION,
  isKnownRegionId,
  isRegionId,
  KNOWN_REGION_IDS,
  regionDbName,
  regionFromSlug,
  regionPath,
  REGION_IDS,
  REGION_SLUGS,
} from "@/regions";

describe("regions", () => {
  it("nqn keeps the database seeded before regions existed", () => {
    expect(regionDbName("basin-explorer", "nqn")).toBe("basin-explorer");
    expect(regionDbName("basin-explorer", "cba")).toBe("basin-explorer-cba");
  });

  it("knows its ids", () => {
    expect(isRegionId(DEFAULT_REGION)).toBe(true);
    expect(isRegionId("xyz")).toBe(false);
    expect(isRegionId(undefined)).toBe(false);
    // Known to the pipeline and served by the app (R3.8).
    expect(isKnownRegionId("cba")).toBe(true);
    expect(isRegionId("cba")).toBe(true);
    expect(isRegionId("xyz")).toBe(false);
  });

  it("has one URL slug per region, unique and clear of ids and app paths", () => {
    const slugs = KNOWN_REGION_IDS.map((id) => REGION_SLUGS[id]);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z]+$/);
      expect(isKnownRegionId(slug)).toBe(false);
      expect([
        "hub",
        "api",
        "tiles",
        "landing",
        "maplibre",
        "en",
        "es",
      ]).not.toContain(slug);
    }
    for (const id of REGION_IDS)
      expect(regionFromSlug(REGION_SLUGS[id])).toBe(id);
    expect(regionFromSlug("cba")).toBeNull();
    expect(regionFromSlug("xyz")).toBeNull();
  });

  it("builds paths inside a region", () => {
    expect(regionPath("cba")).toBe("/cordoba");
    expect(regionPath("nqn", "/map")).toBe("/rionegro/map");
  });
});
