import { describe, expect, it } from "vitest";
import {
  MAP_CONFIG_REGIONS,
  MASK_LEVEL_COUNT,
  mapConfigFor,
  parseTilesVersions,
  tilePaths,
} from "@/lib/map/config";
import { REGION_IDS } from "@/regions";

describe("tilePaths", () => {
  it("puts the region and its tiles version in the path", () => {
    expect(tilePaths("nqn", { nqn: "abc123" }).rivers).toBe(
      "/tiles/nqn/abc123/rivers.pmtiles",
    );
  });

  it("falls back to dev when the region has no version", () => {
    expect(tilePaths("nqn", {}).mask).toBe("/tiles/nqn/dev/mask.pmtiles");
  });
});

describe("parseTilesVersions", () => {
  it("reads the build-time JSON and survives a missing or broken value", () => {
    expect(parseTilesVersions('{"nqn":"abc"}')).toEqual({ nqn: "abc" });
    expect(parseTilesVersions(undefined)).toEqual({});
    expect(parseTilesVersions("not json")).toEqual({});
  });
});

describe("map configs", () => {
  it("exist for every region, each with the shared number of Visible Land levels", () => {
    expect([...MAP_CONFIG_REGIONS].sort()).toEqual([...REGION_IDS].sort());
    for (const region of REGION_IDS)
      expect(mapConfigFor(region).mask.baseHalfWidthKm.length + 1).toBe(
        MASK_LEVEL_COUNT,
      );
  });
});
