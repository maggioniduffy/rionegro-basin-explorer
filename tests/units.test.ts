import { describe, expect, it } from "vitest";
import { formatQuantity } from "@/lib/units";

// Intl output uses no-break spaces in places; compare with plain spaces.
const fmt = (...args: Parameters<typeof formatQuantity>) =>
  formatQuantity(...args).replace(/[  ]/g, " ");

describe("formatQuantity", () => {
  it("formats by locale", () => {
    expect(fmt("en", "km", 710.7)).toBe("710.7 km");
    expect(fmt("es", "km", 710.7)).toBe("710,7 km");
    expect(fmt("en", "count", 600371)).toBe("600,371");
    expect(fmt("es", "km2", 112936.5)).toBe("112.937 km²");
    expect(fmt("en", "km2", 0.595)).toBe("0.6 km²");
    expect(fmt("es", "km2", 3.456)).toBe("3,5 km²");
    expect(fmt("en", "km2", 36.07)).toBe("36 km²");
  });
  it("takes percentages as 0–100", () => {
    expect(fmt("en", "pct", 2.5)).toBe("2.5%");
    expect(fmt("es", "pct", 154.1)).toBe("154,1 %");
  });
  it("keeps small discharges readable", () => {
    expect(fmt("en", "m3s", 0.119)).toBe("0.12 m³/s");
    expect(fmt("en", "m3s", 869.7)).toBe("869.7 m³/s");
  });
});

describe("formatQuantity, imperial", () => {
  const imp = (locale: string, q: Parameters<typeof fmt>[1], v: number) =>
    fmt(locale, q, v, "imperial");

  it("converts lengths and areas", () => {
    expect(imp("en", "km", 1.609344)).toBe("1 mi");
    expect(imp("en", "km", 710.7)).toBe("441.6 mi");
    expect(imp("es", "km", 710.7)).toBe("441,6 mi");
    expect(imp("en", "m", 1000)).toBe("3,281 ft");
    expect(imp("en", "km2", 2.589988110336)).toBe("1 mi²");
    expect(imp("en", "km2", 112936.5)).toBe("43,605 mi²");
  });
  it("converts gradients to ft/mi", () => {
    expect(imp("en", "mPerKm", 1)).toBe("5.28 ft/mi");
  });
  it("leaves discharge, percentages and counts alone", () => {
    expect(imp("en", "m3s", 869.7)).toBe("869.7 m³/s");
    expect(imp("en", "pct", 2.5)).toBe("2.5%");
    expect(imp("en", "count", 600371)).toBe("600,371");
  });
});
