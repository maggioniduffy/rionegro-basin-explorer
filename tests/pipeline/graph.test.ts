import { describe, expect, it } from "vitest";
import {
  difference,
  majorBranchMouths,
  traceLargestUpstream,
  traceNamedRiver,
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

//  Outlet 1 ← 2 ← 3 (confluence): 4 (area 60) and 5 (area 40) join into 3.
//  4 ← 6 ← 7 (headwater); 2 also gets a small tributary 8 (area 5).
describe("major branches", () => {
  const areas = new Map([
    [1, 106],
    [2, 106],
    [3, 100],
    [4, 60],
    [5, 40],
    [6, 55],
    [7, 50],
    [8, 5],
  ]);
  const area = (id: number) => areas.get(id) ?? 0;
  const index = upstreamIndex([
    { id: 2, nextDown: 1 },
    { id: 3, nextDown: 2 },
    { id: 8, nextDown: 2 },
    { id: 4, nextDown: 3 },
    { id: 5, nextDown: 3 },
    { id: 6, nextDown: 4 },
    { id: 7, nextDown: 6 },
  ]);

  it("returns the outlet and both branches of a major confluence", () => {
    expect(majorBranchMouths(index, area, 1, 20).sort()).toEqual([1, 4, 5]);
  });

  it("ignores confluences with only one large branch", () => {
    expect(majorBranchMouths(index, area, 1, 50)).toEqual([1]);
  });

  it("traces the largest branch to the headwater", () => {
    expect(traceLargestUpstream(index, area, 1)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it("stops before entering another candidate's mouth", () => {
    expect(traceLargestUpstream(index, area, 1, new Set([4, 5]))).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("traceNamedRiver", () => {
  //  1 ← 2 (confluence): 3 (area 60, named mouth) and 4 (area 40) → 4 ← 5.
  const areas = new Map([
    [1, 100],
    [2, 100],
    [3, 60],
    [4, 40],
    [5, 30],
  ]);
  const area = (id: number) => areas.get(id) ?? 0;
  const index = upstreamIndex([
    { id: 2, nextDown: 1 },
    { id: 3, nextDown: 2 },
    { id: 4, nextDown: 2 },
    { id: 5, nextDown: 4 },
  ]);

  it("skips a larger branch that is another named river", () => {
    expect(traceNamedRiver(index, area, 1, new Set([3]))).toEqual([1, 2, 4, 5]);
  });

  it("follows the largest branch when nothing is claimed", () => {
    expect(traceNamedRiver(index, area, 1, new Set())).toEqual([1, 2, 3]);
  });

  it("stops when every branch is claimed", () => {
    expect(traceNamedRiver(index, area, 1, new Set([3, 4]))).toEqual([1, 2]);
  });
});
