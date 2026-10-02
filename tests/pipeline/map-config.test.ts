import { describe, expect, it } from "vitest";
import {
  mapConfig,
  reachMinzoom,
  stepMinzoom,
} from "../../pipeline/lib/map-config";

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

describe("stepMinzoom", () => {
  const { detailMinzoomByKm, extraLakeMinzoomByKm2, damsMinzoom } =
    mapConfig.ign;

  it("takes the first step whose min is at most the value", () => {
    expect(stepMinzoom(detailMinzoomByKm, 100)).toBe(7);
    expect(stepMinzoom(detailMinzoomByKm, 20)).toBe(7);
    expect(stepMinzoom(detailMinzoomByKm, 19.9)).toBe(8);
    expect(stepMinzoom(detailMinzoomByKm, 0.5)).toBe(9);
  });

  it("shows larger features no later than smaller ones, within maxzoom", () => {
    for (const steps of [detailMinzoomByKm, extraLakeMinzoomByKm2]) {
      expect(steps.at(-1)?.min).toBe(0);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]?.min).toBeLessThan(steps[i - 1]?.min ?? Infinity);
        expect(steps[i]?.minzoom).toBeGreaterThanOrEqual(
          steps[i - 1]?.minzoom ?? 0,
        );
      }
      expect(steps.every((s) => s.minzoom <= mapConfig.maxzoom)).toBe(true);
    }
    expect(damsMinzoom).toBeLessThanOrEqual(mapConfig.maxzoom);
  });

  it("throws when no step applies", () => {
    expect(() => stepMinzoom([{ min: 5, minzoom: 8 }], 1)).toThrow(
      /no minzoom/,
    );
  });
});
