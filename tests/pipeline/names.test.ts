import { describe, expect, it } from "vitest";
import {
  cleanName,
  evenlySpaced,
  nameKey,
  slugify,
  tallyNames,
} from "../../pipeline/lib/names";

describe("tallyNames", () => {
  it("counts each name once per point and sorts by points", () => {
    expect(
      tallyNames([
        ["Río Limay", "Río Limay", "Arroyo X"],
        ["Río Limay"],
        ["Río Collón Curá"],
        [],
      ]),
    ).toEqual([
      { name: "Río Limay", points: 2 },
      { name: "Arroyo X", points: 1 },
      { name: "Río Collón Curá", points: 1 },
    ]);
  });
});

describe("evenlySpaced", () => {
  it("returns everything when the list is short", () => {
    expect(evenlySpaced([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("includes both ends", () => {
    expect(evenlySpaced([0, 1, 2, 3, 4, 5, 6, 7, 8], 5)).toEqual([
      0, 2, 4, 6, 8,
    ]);
  });
});

describe("slugify", () => {
  it("strips accents and joins words", () => {
    expect(slugify("Collón Curá")).toBe("collon-cura");
    expect(slugify("Picún Leufú")).toBe("picun-leufu");
    expect(slugify("Neuquén")).toBe("neuquen");
  });
});

describe("cleanName", () => {
  it("trims and collapses whitespace, keeps accents, maps empty to null", () => {
    expect(cleanName("  Río   Collón Curá ")).toBe("Río Collón Curá");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName(undefined)).toBeNull();
  });

  it("normalizes decomposed accents to NFC", () => {
    expect(cleanName("Ri\u0301o Negro")).toBe("R\u00edo Negro");
  });
});

describe("nameKey", () => {
  it("ignores accents, case, parentheses and spacing", () => {
    expect(nameKey("Río Negro (Brazo Norte)")).toBe(
      nameKey("Río Negro Brazo Norte"),
    );
    expect(nameKey("Arroyo Poñihue")).toBe(nameKey("Arroyo Poñihué"));
    expect(nameKey("Río  Limay")).toBe("rio limay");
  });

  it("keeps different names apart and keeps the degree sign", () => {
    expect(nameKey("Arroyo Calmuco")).not.toBe(nameKey("Arroyo Camulco"));
    expect(nameKey("Arroyo del Fortín 1° de Mayo")).toBe(
      "arroyo del fortin 1° de mayo",
    );
  });
});
