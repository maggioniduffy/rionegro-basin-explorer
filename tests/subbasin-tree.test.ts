import { describe, expect, it } from "vitest";
import { ancestorIds, initiallyExpanded } from "@/lib/subbasin-tree";

const nodes = [
  { id: "negro", parentId: null, childIds: ["limay", "neuquen"], level: 0 },
  { id: "limay", parentId: "negro", childIds: ["collon-cura"], level: 1 },
  { id: "neuquen", parentId: "negro", childIds: ["agrio"], level: 1 },
  { id: "collon-cura", parentId: "limay", childIds: ["alumine"], level: 2 },
  { id: "agrio", parentId: "neuquen", childIds: [], level: 2 },
  { id: "alumine", parentId: "collon-cura", childIds: [], level: 3 },
];

describe("sub-basin tree", () => {
  it("lists ancestors root first", () => {
    expect(ancestorIds(nodes, "alumine")).toEqual([
      "negro",
      "limay",
      "collon-cura",
    ]);
    expect(ancestorIds(nodes, "negro")).toEqual([]);
    expect(ancestorIds(nodes, "unknown")).toEqual([]);
  });

  it("opens the top two levels and the path to the selection", () => {
    expect([...initiallyExpanded(nodes, null)].sort()).toEqual([
      "limay",
      "negro",
      "neuquen",
    ]);
    expect(initiallyExpanded(nodes, "alumine").has("collon-cura")).toBe(true);
    expect(initiallyExpanded(nodes, "agrio").has("collon-cura")).toBe(false);
  });
});
