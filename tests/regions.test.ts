import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION,
  isKnownRegionId,
  isRegionId,
  regionDbName,
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
    // Known to the pipeline, not served by the app yet.
    expect(isKnownRegionId("cba")).toBe(true);
    expect(isRegionId("cba")).toBe(false);
  });
});
