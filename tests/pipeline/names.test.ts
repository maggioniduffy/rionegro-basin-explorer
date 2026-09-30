import { describe, expect, it } from "vitest";
import { evenlySpaced, slugify, tallyNames } from "../../pipeline/lib/names";

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
