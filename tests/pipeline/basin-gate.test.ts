import { describe, expect, it } from "vitest";
import {
  assignLargestShare,
  boxInside,
  findRoots,
  iou,
  median,
  rootKind,
  splitRootsByUpArea,
  sumByGroup,
  upstreamOutside,
  type Lev12Link,
} from "../../pipeline/lib/basin-gate";
import { upstreamIndex } from "../../pipeline/lib/graph";

describe("assignLargestShare", () => {
  it("picks the basin with the largest share", () => {
    const a = assignLargestShare(
      [
        { key: "01", km2: 30 },
        { key: "02", km2: 60 },
      ],
      100,
      0.5,
    );
    expect(a).toEqual({ key: "02", share: 0.6 });
  });

  it("leaves the polygon unassigned below the threshold, still reporting the share", () => {
    const a = assignLargestShare(
      [
        { key: "01", km2: 30 },
        { key: "02", km2: 40 },
      ],
      100,
      0.5,
    );
    expect(a).toEqual({ key: null, share: 0.4 });
  });

  it("accepts a share exactly at the threshold", () => {
    expect(assignLargestShare([{ key: "03", km2: 50 }], 100, 0.5).key).toBe(
      "03",
    );
  });

  it("breaks ties with the lowest code, whatever the input order", () => {
    const overlaps = [
      { key: "04", km2: 50 },
      { key: "02", km2: 50 },
    ];
    expect(assignLargestShare(overlaps, 100, 0.5).key).toBe("02");
    expect(assignLargestShare([...overlaps].reverse(), 100, 0.5).key).toBe(
      "02",
    );
  });

  it("orders numeric-looking keys numerically", () => {
    const overlaps = [
      { key: "10", km2: 50 },
      { key: "9", km2: 50 },
    ];
    expect(assignLargestShare(overlaps, 100, 0.5).key).toBe("9");
  });

  it("sums repeated keys and caps the share at 1", () => {
    const a = assignLargestShare(
      [
        { key: "01", km2: 60 },
        { key: "01", km2: 41 },
      ],
      100,
      0.5,
    );
    expect(a).toEqual({ key: "01", share: 1 });
  });

  it("returns unassigned with no overlap or a degenerate area", () => {
    expect(assignLargestShare([], 100, 0.5)).toEqual({ key: null, share: 0 });
    expect(assignLargestShare([{ key: "01", km2: 5 }], 0, 0.5)).toEqual({
      key: null,
      share: 0,
    });
  });
});

describe("rootKind", () => {
  it("classifies by NEXT_DOWN and ENDO", () => {
    expect(rootKind("0", 0)).toBe("sea");
    expect(rootKind("0", 1)).toBe("sea");
    expect(rootKind("0", 2)).toBe("sink");
    expect(rootKind("7", 2)).toBe("virtual-sink");
    expect(rootKind("7", 0)).toBe("flows-out");
    expect(rootKind("7", 1)).toBe("flows-out");
  });
});

//  a1 → a2 → a3 → 0 (sea)              group A = {a1, a2, a3}
//  b1 → a2   (outsider flowing in)     group B = {b1, b2, b3, b4}
//  a1 ← x1   (x1 unassigned, upstream)
//  b2 → s (ENDO 2, NEXT_DOWN 0 : sink, group B)
//  b3 → a1 (flows out of B into A)
//  b4 → v (ENDO 2, virtual link to a3: virtual-sink, group B)
const links: Lev12Link[] = [
  { id: "a1", nextDown: "a2", endo: 0 },
  { id: "a2", nextDown: "a3", endo: 0 },
  { id: "a3", nextDown: "0", endo: 0 },
  { id: "b1", nextDown: "a2", endo: 0 },
  { id: "b2", nextDown: "0", endo: 2 },
  { id: "b3", nextDown: "a1", endo: 0 },
  { id: "b4", nextDown: "a3", endo: 2 },
  { id: "x1", nextDown: "a1", endo: 0 },
];
const groups: Record<string, string> = {
  a1: "A",
  a2: "A",
  a3: "A",
  b1: "B",
  b2: "B",
  b3: "B",
  b4: "B",
};
const groupOf = (id: string) => groups[id] ?? null;
const membersOf = (code: string) =>
  new Set(Object.keys(groups).filter((id) => groups[id] === code));

describe("findRoots", () => {
  it("finds the sea root of a group and ignores members that drain inside it", () => {
    const roots = findRoots(links, membersOf("A"), groupOf);
    expect(roots).toEqual([
      { id: "a3", kind: "sea", intoId: null, intoCode: null },
    ]);
  });

  it("classifies sink, virtual-sink and flows-out roots, with the target group", () => {
    const roots = findRoots(links, membersOf("B"), groupOf);
    expect(roots).toEqual([
      { id: "b1", kind: "flows-out", intoId: "a2", intoCode: "A" },
      { id: "b2", kind: "sink", intoId: null, intoCode: null },
      { id: "b3", kind: "flows-out", intoId: "a1", intoCode: "A" },
      { id: "b4", kind: "virtual-sink", intoId: "a3", intoCode: "A" },
    ]);
  });

  it("gives intoCode null when the target is unassigned or unknown", () => {
    const roots = findRoots(
      [
        { id: "m", nextDown: "u", endo: 0 },
        { id: "n", nextDown: "gone", endo: 0 },
      ],
      new Set(["m", "n"]),
      groupOf,
    );
    expect(roots.map((r) => [r.intoId, r.intoCode])).toEqual([
      ["u", null],
      ["gone", null],
    ]);
  });

  it("treats a virtual link to another member as internal", () => {
    const roots = findRoots(
      [
        { id: "s", nextDown: "t", endo: 2 },
        { id: "t", nextDown: "0", endo: 0 },
      ],
      new Set(["s", "t"]),
      () => "A",
    );
    expect(roots.map((r) => r.id)).toEqual(["t"]);
  });
});

describe("splitRootsByUpArea", () => {
  it("lists large roots by UP_AREA descending and totals the rest", () => {
    const roots = [
      { id: "a", upArea: 150, subArea: 10 },
      { id: "b", upArea: 20, subArea: 5 },
      { id: "c", upArea: 900, subArea: 40 },
      { id: "d", upArea: 99.9, subArea: 7 },
    ];
    const { large, small } = splitRootsByUpArea(roots, 100);
    expect(large.map((r) => r.id)).toEqual(["c", "a"]);
    expect(small).toEqual({ count: 2, subAreaKm2: 12 });
  });
});

describe("upstreamOutside", () => {
  const index = upstreamIndex(
    links.map((l) => ({ id: l.id, nextDown: l.nextDown })),
  );

  it("collects non-member polygons upstream of the group's roots", () => {
    const out = upstreamOutside(index, ["a3"], membersOf("A"));
    expect([...out].sort()).toEqual(["b1", "b3", "b4", "x1"]);
  });

  it("is empty when everything upstream is a member", () => {
    const all = new Set(Object.keys(groups).concat("x1"));
    expect(upstreamOutside(index, ["a3"], all).size).toBe(0);
  });
});

describe("sumByGroup", () => {
  it("sums by group code, largest first, with null as unassigned, and truncates", () => {
    const area: Record<string, number> = { b1: 5, b2: 7, x1: 20, a1: 1 };
    const top = sumByGroup(
      ["b1", "b2", "x1", "a1"],
      groupOf,
      (id) => area[id] ?? 0,
      2,
    );
    expect(top).toEqual([
      { code: null, km2: 20 },
      { code: "B", km2: 12 },
    ]);
  });
});

describe("measures", () => {
  it("computes intersection over union", () => {
    expect(iou(50, 100, 100)).toBeCloseTo(1 / 3);
    expect(iou(100, 100, 100)).toBe(1);
    expect(iou(0, 0, 0)).toBe(0);
  });

  it("computes the median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("checks that a box lies inside another", () => {
    const outer = { xmin: -10, ymin: -10, xmax: 10, ymax: 10 };
    expect(boxInside({ xmin: -1, ymin: -1, xmax: 1, ymax: 1 }, outer)).toBe(
      true,
    );
    expect(boxInside({ xmin: -1, ymin: -1, xmax: 11, ymax: 1 }, outer)).toBe(
      false,
    );
  });
});
