import { describe, expect, it } from "vitest";
import {
  assignByShare,
  chooseOutlet,
  depthFirst,
  fixName,
  generateIds,
  idsProblems,
  largestShare,
} from "../../pipeline/lib/subbasins-reference-pure";

describe("generateIds", () => {
  it("uses presets and slugs, and suffixes a taken slug by level", () => {
    const { ids, disambiguated } = generateIds(
      [
        { level: 3, key: "5-01", basis: "5-01" },
        { level: 2, key: "La Picasa", basis: "La Picasa" },
        { level: 1, key: "05", basis: "05", preset: "la-picasa" },
        { level: 3, key: "Cerro Negro", basis: "Cerro Negro" },
        { level: 2, key: "Cerro Negro", basis: "Cerro Negro" },
      ],
      ["cordoba"],
    );
    expect(ids.level1["05"]).toBe("la-picasa");
    expect(ids.level2["La Picasa"]).toBe("la-picasa-subcuenca");
    expect(ids.level2["Cerro Negro"]).toBe("cerro-negro");
    expect(ids.level3["Cerro Negro"]).toBe("cerro-negro-ugh");
    expect(ids.level3["5-01"]).toBe("5-01");
    expect(disambiguated.map((d) => d.got)).toEqual([
      "la-picasa-subcuenca",
      "cerro-negro-ugh",
    ]);
  });
  it("does not depend on the input order", () => {
    const a = [
      { level: 2 as const, key: "B", basis: "x" },
      { level: 2 as const, key: "A", basis: "x" },
    ];
    expect(generateIds(a).ids).toEqual(generateIds([...a].reverse()).ids);
  });
});

describe("idsProblems", () => {
  const keys = [
    { level: 1 as const, key: "01" },
    { level: 2 as const, key: "Pocho" },
  ];
  const ids = { level1: { "01": "a" }, level2: { Pocho: "pocho" }, level3: {} };
  it("is empty when ids and features match", () => {
    expect(idsProblems(ids, keys, ["cordoba"])).toEqual([]);
  });
  it("reports a missing id, an unused id and a duplicate", () => {
    const bad = {
      level1: { "01": "pocho" },
      level2: { Pocho: "pocho", Gone: "gone" },
      level3: {},
    };
    const text = idsProblems(bad, keys).join("|");
    expect(text).toMatch(/already used/);
    expect(text).toMatch(/no feature "Gone"/);
    expect(idsProblems({ ...ids, level2: {} }, keys).join("|")).toMatch(
      /"Pocho" has no id/,
    );
  });
});

describe("fixName", () => {
  const fixes = [
    {
      from: "Río Carcaraña",
      to: "Río Carcarañá",
      note: "",
      match: "exact" as const,
    },
    { from: "Rio", to: "Río", note: "", match: "word" as const },
  ];
  it("applies exact and word fixes and collapses whitespace", () => {
    expect(fixName("Río Carcaraña", fixes)).toEqual({
      name: "Río Carcarañá",
      applied: ["Río Carcaraña"],
    });
    expect(fixName("Rio Juramento Salado", fixes).name).toBe(
      "Río Juramento Salado",
    );
    expect(fixName("Río Seco  - Cuenca Alta", fixes)).toEqual({
      name: "Río Seco - Cuenca Alta",
      applied: ["whitespace"],
    });
    expect(fixName("Río Carcarañá", fixes).applied).toEqual([]);
  });
  it("throws on an empty name", () => {
    expect(() => fixName("  ", fixes)).toThrow();
  });
});

describe("shares", () => {
  it("picks the largest share, ties to the lowest key", () => {
    expect(
      largestShare(
        new Map([
          ["b", 0.4],
          ["a", 0.4],
          ["c", 0.2],
        ]),
      ),
    ).toEqual({ key: "a", share: 0.4 });
    expect(largestShare(new Map([["a", 0]]))).toBeNull();
  });
  it("keeps it only from the minimum share", () => {
    const shares = new Map([["a", 0.49]]);
    expect(assignByShare(shares, 0.5)).toBeNull();
    expect(assignByShare(new Map([["a", 0.5]]), 0.5)?.key).toBe("a");
  });
});

describe("chooseOutlet", () => {
  // 1 <- 2 <- 3 and 1 <- 4; reach 9 is separate (drains outside the node).
  const reaches = [
    { id: 1, nextDown: 0, upland: 100, lengthKm: 10 },
    { id: 2, nextDown: 1, upland: 60, lengthKm: 10 },
    { id: 3, nextDown: 2, upland: 20, lengthKm: 10 },
    { id: 4, nextDown: 1, upland: 30, lengthKm: 10 },
    { id: 9, nextDown: 0, upland: 5, lengthKm: 10 },
  ];
  it("takes the largest-upland reach and the share draining to it", () => {
    const c = chooseOutlet(reaches, 0.9);
    expect(c).toMatchObject({ reachId: 1, upstreamReaches: 4, kept: false });
    expect(c.share).toBeCloseTo(0.8);
    expect(chooseOutlet(reaches, 0.8).kept).toBe(true);
  });
  it("uses a forced reach", () => {
    expect(chooseOutlet(reaches, 0, 2)).toMatchObject({
      reachId: 2,
      upstreamReaches: 2,
    });
    expect(() => chooseOutlet(reaches, 0, 77)).toThrow();
  });
  it("handles a node without reaches", () => {
    expect(chooseOutlet([], 0.9)).toMatchObject({ reachId: null, kept: false });
  });
});

describe("depthFirst", () => {
  it("lists parents before children, children by id", () => {
    const nodes = [
      { id: "b1", parentId: "b" },
      { id: "b", parentId: "r" },
      { id: "a", parentId: "r" },
      { id: "r", parentId: null },
    ];
    expect(depthFirst(nodes).map((n) => n.id)).toEqual(["r", "a", "b", "b1"]);
  });
  it("throws on a node outside the tree", () => {
    expect(() =>
      depthFirst([
        { id: "r", parentId: null },
        { id: "x", parentId: "y" },
      ]),
    ).toThrow();
  });
});
