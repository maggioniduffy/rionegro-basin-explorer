import { describe, expect, it } from "vitest";
import { mapConfig, reachMinzoom } from "../../pipeline/lib/map-config";

describe("map.config.json", () => {
  it("gives every Strahler order in the basin (1–7) a minzoom and a buffer factor", () => {
    for (let order = 1; order <= 7; order++) {
      expect(reachMinzoom(mapConfig, order)).toBeLessThanOrEqual(
        mapConfig.maxzoom,
      );
      expect(mapConfig.mask.strahlerFactor[String(order)]).toBeGreaterThan(0);
    }
  });

  it("shows larger rivers no later than smaller ones", () => {
    for (let order = 2; order <= 7; order++) {
      expect(reachMinzoom(mapConfig, order)).toBeLessThanOrEqual(
        reachMinzoom(mapConfig, order - 1),
      );
    }
  });

  it("has strictly increasing mask widths", () => {
    const w = mapConfig.mask.baseHalfWidthKm;
    for (let i = 1; i < w.length; i++)
      expect(w[i]).toBeGreaterThan(w[i - 1] ?? Infinity);
  });

  it("throws for an order without a minzoom", () => {
    expect(() => reachMinzoom(mapConfig, 99)).toThrow(/Strahler order 99/);
  });
});
