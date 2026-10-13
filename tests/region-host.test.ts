import { describe, expect, it } from "vitest";
import { oldRegionHost } from "@/regions/hosts";

describe("oldRegionHost (regions by path, owner 2026-10-12)", () => {
  it("sends the production aliases to the production hub", () => {
    expect(oldRegionHost("cordobabasinexplorer.vercel.app")).toEqual({
      region: "cba",
      hub: "basinexplorer.vercel.app",
    });
    expect(oldRegionHost("RioNegroBasinExplorer.vercel.app")).toEqual({
      region: "nqn",
      hub: "basinexplorer.vercel.app",
    });
  });

  it("sends a dev label (slug or id) above localhost to localhost, port kept", () => {
    expect(oldRegionHost("cordoba.localhost:3000")).toEqual({
      region: "cba",
      hub: "localhost:3000",
    });
    expect(oldRegionHost("nqn.localhost:3000")).toEqual({
      region: "nqn",
      hub: "localhost:3000",
    });
  });

  it("is null for every other host: they serve the hub and the region paths", () => {
    for (const host of [
      "basinexplorer.vercel.app",
      "localhost:3000",
      "xyz.localhost:3000",
      "cordoba.example.com",
      "basin-explorer-git-main.vercel.app",
      null,
    ])
      expect(oldRegionHost(host)).toBeNull();
  });
});
