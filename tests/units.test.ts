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
