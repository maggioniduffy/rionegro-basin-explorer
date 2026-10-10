import { describe, expect, it } from "vitest";
import { DEFAULT_REGION, isRegionId, regionDbName } from "@/regions";

describe("regions", () => {
  it("nqn keeps the database seeded before regions existed", () => {
    expect(regionDbName("basin-explorer", "nqn")).toBe("basin-explorer");
  });

  it("knows its ids", () => {
    expect(isRegionId(DEFAULT_REGION)).toBe(true);
    expect(isRegionId("xyz")).toBe(false);
    expect(isRegionId(undefined)).toBe(false);
  });
});
