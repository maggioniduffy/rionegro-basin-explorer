import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TIER,
  expandWaterName,
  isCovered,
  parseLakesConfig,
  sortDamCaveat,
  sourceOf,
  waterId,
  waterKind,
  yearOrNull,
} from "../../pipeline/lib/water-pure";

const config = JSON.parse(
  readFileSync("regions/cba/lakes.config.json", "utf8"),
) as unknown;
const rules = parseLakesConfig(config);

describe("expandWaterName", () => {
  it("expands dotted words, also without a space after the dot", () => {
    expect(expandWaterName("Lag. Avila", rules).name).toBe("Laguna Avila");
    expect(expandWaterName("Lag.La Chanchera", rules).name).toBe(
      "Laguna La Chanchera",
    );
    expect(expandWaterName("Lags. Las Viscacheras", rules).name).toBe(
      "Lagunas Las Viscacheras",
    );
    expect(expandWaterName("Cda. Negra", rules).name).toBe("Cañada Negra");
  });

  it("leaves the rest as the source has it and collapses whitespace", () => {
    expect(expandWaterName("  Lag.  De La Legua ", rules).name).toBe(
      "Laguna De La Legua",
    );
    expect(expandWaterName("Mar Chiquita (Mar de Ansenuza)", rules)).toEqual({
      name: "Mar Chiquita (Mar de Ansenuza)",
      blank: false,
      unknown: [],
      expanded: [],
    });
  });

  it("keeps titles and initials listed in keepDotted", () => {
    const e = expandWaterName("Ing. A. M. Allende (La Viña)", rules);
    expect(e.name).toBe("Ing. A. M. Allende (La Viña)");
    expect(e.unknown).toEqual([]);
  });

  it("reports a dotted word it does not know instead of guessing", () => {
    const e = expandWaterName("Emb. Nuevo", rules);
    expect(e.unknown).toEqual(["emb"]);
    expect(e.name).toBe("Emb. Nuevo");
  });

  it("blanks names the source marks as unknown and empty values", () => {
    expect(expandWaterName("Las Toscas*", rules)).toMatchObject({
      name: null,
      blank: true,
    });
    expect(expandWaterName("   ", rules).name).toBeNull();
    expect(expandWaterName(null, rules).name).toBeNull();
  });
});

describe("parseLakesConfig", () => {
  it("accepts regions/cba/lakes.config.json", () => {
    expect(rules.mode).toBe("reference");
    expect(rules.aprhi.reservoirs.damTypes).toEqual(["Presa"]);
  });

  it("names every problem of a bad file", () => {
    expect(() => parseLakesConfig({ mode: "x", ign: {} })).toThrow(
      /mode must be "reference".*aprhi\.natural missing.*ign\.dropCoveredShare/s,
    );
    expect(() => parseLakesConfig(null)).toThrow(/not an object/);
  });
});

describe("ids, sources, kinds and precedence", () => {
  it("builds ids from the source layer and the source id", () => {
    expect(waterId("nat", 1582)).toBe("aprhi-nat-1582");
    expect(waterId("emb", "13")).toBe("aprhi-emb-13");
    expect(waterId("bh130", 69209)).toBe("ign-bh130-69209");
    expect(waterId("perenne", 44821)).toBe("ign-perenne-44821");
    expect(waterId("hydrolakes", 84)).toBe("hydrolakes-84");
    expect(() => waterId("nat", "x1")).toThrow(/not an integer/);
  });

  it("maps layers to sources", () => {
    expect(
      ["nat", "emb", "bh130", "perenne", "hydrolakes"].map((l) =>
        sourceOf(l as never),
      ),
    ).toEqual(["aprhi", "aprhi", "ign", "ign", "hydrolakes"]);
  });

  it("makes reservoirs of APRHI Embalses, IGN BH130 and HydroLAKES type 2", () => {
    expect(waterKind("emb")).toBe("reservoir");
    expect(waterKind("bh130")).toBe("reservoir");
    expect(waterKind("hydrolakes", 2)).toBe("reservoir");
    expect(waterKind("hydrolakes", 1)).toBe("lake");
    expect(waterKind("hydrolakes", 3)).toBe("controlled-lake");
    expect(waterKind("nat")).toBe("lake");
    expect(waterKind("perenne")).toBe("lake");
  });

  it("orders precedence APRHI > IGN > HydroLAKES, reservoirs first within a source", () => {
    expect(TIER.emb).toBeLessThan(TIER.nat);
    expect(TIER.nat).toBeLessThan(TIER.bh130);
    expect(TIER.bh130).toBeLessThan(TIER.perenne);
    expect(TIER.perenne).toBeLessThan(TIER.hydrolakes);
  });

  it("treats a polygon as covered from the limit up", () => {
    expect(isCovered(0.5, 0.5)).toBe(true);
    expect(isCovered(0.4999, 0.5)).toBe(false);
    expect(isCovered(0.905, 0.5)).toBe(true);
  });
});

describe("dam caveat helpers", () => {
  it("turns the no-value years into null", () => {
    expect(yearOrNull(1927, [0, -999])).toBe(1927);
    expect(yearOrNull(0, [0, -999])).toBeNull();
    expect(yearOrNull(-999, [0, -999])).toBeNull();
    expect(yearOrNull(null, [0, -999])).toBeNull();
    expect(yearOrNull("", [0, -999])).toBeNull();
    expect(yearOrNull(Number.NaN, [0, -999])).toBeNull();
  });

  it("sorts by area, largest first, ties by name", () => {
    const rows = [
      { name: "B", areaKm2: 1, yearStart: null },
      { name: "A", areaKm2: 1, yearStart: 1950 },
      { name: "C", areaKm2: 5, yearStart: 1927 },
    ];
    expect(sortDamCaveat(rows).map((r) => r.name)).toEqual(["C", "A", "B"]);
    expect(rows[0]?.name).toBe("B");
  });
});
