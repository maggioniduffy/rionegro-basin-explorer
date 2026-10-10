import { describe, expect, it } from "vitest";
import { parseTilesVersions, tilePaths } from "@/lib/map/config";

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
