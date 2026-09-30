import { describe, expect, it } from "vitest";
import {
  difference,
  upstreamIndex,
  upstreamSet,
} from "../../pipeline/lib/graph";

//      1 (outlet, drains to 0 = sea)
//     / \
//    2   3
//   / \
//  4   5          6 → 0 is a separate basin
const links = [
  { id: 1, nextDown: 0 },
  { id: 2, nextDown: 1 },
  { id: 3, nextDown: 1 },
  { id: 4, nextDown: 2 },
  { id: 5, nextDown: 2 },
  { id: 6, nextDown: 0 },
];

describe("upstreamSet", () => {
  const index = upstreamIndex(links);

  it("collects everything upstream of the outlet, including it", () => {
    expect([...upstreamSet(index, 1)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at the root's own subtree", () => {
    expect([...upstreamSet(index, 2)].sort()).toEqual([2, 4, 5]);
  });

  it("returns just the root for a headwater", () => {
    expect([...upstreamSet(index, 4)]).toEqual([4]);
  });

  it("terminates on a cycle", () => {
    const cyclic = upstreamIndex([
      { id: 1, nextDown: 2 },
      { id: 2, nextDown: 1 },
    ]);
    expect([...upstreamSet(cyclic, 1)].sort()).toEqual([1, 2]);
  });

  it("handles a deep chain without recursion", () => {
    const chain = Array.from({ length: 100_000 }, (_, i) => ({
      id: i + 1,
      nextDown: i,
    }));
    expect(upstreamSet(upstreamIndex(chain), 1).size).toBe(100_000);
  });
});

describe("difference", () => {
  it("lists elements only in the first set", () => {
    expect(difference(new Set([1, 2, 3]), new Set([2]))).toEqual([1, 3]);
  });
});
