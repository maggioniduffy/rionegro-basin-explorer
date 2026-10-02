import { describe, expect, it } from "vitest";
import {
  ancestorPath,
  hierarchyProblems,
  partition,
} from "../../pipeline/lib/subbasins";

describe("ancestorPath", () => {
  const tree = [
    { id: "negro", parentId: null },
    { id: "limay", parentId: "negro" },
    { id: "collon-cura", parentId: "limay" },
  ];
  it("runs from the root down to the node", () => {
    expect(ancestorPath(tree, "collon-cura")).toEqual([
      "negro",
      "limay",
      "collon-cura",
    ]);
    expect(ancestorPath(tree, "negro")).toEqual(["negro"]);
  });
  it("throws on a cycle or an unknown node", () => {
    const loop = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(() => ancestorPath(loop, "a")).toThrow(/cycle/);
    expect(() => ancestorPath(tree, "x")).toThrow(/unknown/);
  });
});

describe("hierarchyProblems", () => {
  it("accepts a well-formed tree", () => {
    expect(
      hierarchyProblems([
        { id: "r", parentId: null, level: 0 },
        { id: "a", parentId: "r", level: 1 },
        { id: "b", parentId: "a", level: 2 },
      ]),
    ).toEqual([]);
  });
  it("reports wrong levels, order and duplicates", () => {
    const problems = hierarchyProblems([
      { id: "r", parentId: null, level: 1 },
      { id: "b", parentId: "a", level: 2 },
      { id: "a", parentId: "r", level: 3 },
      { id: "a", parentId: "r", level: 2 },
    ]);
    expect(problems).toContain("r: root must be level 0");
    expect(problems).toContain("b: parent a not listed before it");
    expect(problems).toContain("a: level 3, parent r is level 1");
    expect(problems).toContain("a: duplicate id");
  });
});

const nodes = [
  { id: "root", parentId: null },
  { id: "a", parentId: "root" },
  { id: "b", parentId: "root" },
];
const sorted = <T>(s: Set<T> | undefined) => [...(s ?? [])].sort();

describe("partition", () => {
  it("gives each node the polygons none of its children hold", () => {
    const setOf = new Map([
      ["root", new Set([1, 2, 3, 4, 5, 6])],
      ["a", new Set([2, 4])],
      ["b", new Set([3])],
    ]);
    const p = partition(nodes, setOf);
    expect(p.problems).toEqual([]);
    expect(sorted(p.own.get("root"))).toEqual([1, 5, 6]);
    expect(sorted(p.own.get("a"))).toEqual([2, 4]);
    expect(p.ownerOf.get(3)).toBe("b");
    expect(p.ownerOf.size).toBe(6);
  });

  it("reports overlapping siblings", () => {
    const setOf = new Map([
      ["root", new Set([1, 2, 3])],
      ["a", new Set([2])],
      ["b", new Set([2, 3])],
    ]);
    expect(partition(nodes, setOf).problems).toContain("a and b overlap at 2");
  });

  it("reports a child that leaves its parent", () => {
    const setOf = new Map([
      ["root", new Set([1, 2])],
      ["a", new Set([2, 9])],
      ["b", new Set<number>()],
    ]);
    expect(partition(nodes, setOf).problems).toContain(
      "a: polygon 9 is outside root",
    );
  });

  it("requires exactly one root", () => {
    const two = [...nodes, { id: "c", parentId: null }];
    expect(partition(two, new Map()).problems).toContain(
      "expected one root, found 2",
    );
  });
});
