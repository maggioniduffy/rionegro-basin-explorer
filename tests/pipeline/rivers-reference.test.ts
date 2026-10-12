import { describe, expect, it } from "vitest";
import {
  applyCuts,
  applyOverrides,
  applyRootOverrides,
  connectedSet,
  terminals,
  type RefReach,
} from "../../pipeline/lib/rivers-reference-pure";

// Root A: 1 <- 2 <- 3, 1 is the exit. Root B: 11 <- 12; 12 drains to 2 in A (cut); 13 drains
// to 99 (outside the selection). 21 is an endorheic sink inside A, fed by 22.
const reaches: RefReach[] = [
  { id: 1, hrNextDown: 0, root: "A", km: 10 },
  { id: 2, hrNextDown: 1, root: "A", km: 10 },
  { id: 3, hrNextDown: 2, root: "A", km: 10 },
  { id: 21, hrNextDown: 0, root: "A", km: 5 },
  { id: 22, hrNextDown: 21, root: "A", km: 7 },
  { id: 11, hrNextDown: 0, root: "B", km: 4 },
  { id: 12, hrNextDown: 2, root: "B", km: 4 },
  { id: 13, hrNextDown: 99, root: "B", km: 4 },
];

describe("applyCuts", () => {
  it("cuts cross-root and outside edges and keeps the rest", () => {
    const e = applyCuts(reaches);
    expect(e.nextDown.get(12)).toBe(0);
    expect(e.edit.get(12)).toBe("cut");
    expect(e.cuts).toEqual([{ from: 12, to: 2, rootFrom: "B", rootTo: "A" }]);
    expect(e.nextDown.get(13)).toBe(0);
    expect(e.edit.get(13)).toBe("outside");
    expect(e.nextDown.get(3)).toBe(2);
    expect(e.edit.get(3)).toBeNull();
    expect(e.edit.get(1)).toBeNull();
  });
});

describe("applyOverrides", () => {
  it("applies a valid override", () => {
    const e = applyCuts(reaches);
    applyOverrides(reaches, e, [
      { from: 21, to: 1, reason: "r", evidence: "e" },
    ]);
    expect(e.nextDown.get(21)).toBe(1);
    expect(e.edit.get(21)).toBe("override");
  });

  it("rejects cross-root, non-terminal, unknown and cyclic overrides", () => {
    const check = (o: { from: number; to: number }, msg: RegExp) => {
      const e = applyCuts(reaches);
      expect(() =>
        applyOverrides(reaches, e, [{ ...o, reason: "r", evidence: "e" }]),
      ).toThrow(msg);
    };
    check({ from: 21, to: 11 }, /roots differ/);
    check({ from: 3, to: 1 }, /not a terminal/);
    check({ from: 21, to: 500 }, /not a selected reach/);
    // 22 drains into 21, so 21 -> 22 closes a loop.
    check({ from: 21, to: 22 }, /cycle/);
  });
});

describe("connectedSet and terminals", () => {
  it("flags what drains to the exit and ranks the other terminals", () => {
    const e = applyCuts(reaches);
    const conn = connectedSet(e.nextDown, 1);
    expect([...conn].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const t = terminals(
      reaches,
      e,
      new Map([
        ["A", 1],
        ["B", 11],
      ]),
    );
    expect(t.map((x) => [x.id, x.why, x.upstreamKm])).toEqual([
      [21, "hr-sink", 12],
      [12, "cut", 4],
      [13, "outside", 4],
    ]);
  });
});

describe("applyRootOverrides", () => {
  const ro = { reason: "r", evidence: "e" };
  it("moves a reach to another root so its edge is no longer cut", () => {
    // 12 (root B) drains to 2 (root A): moving 12 to A removes the cut.
    const moved = applyRootOverrides(
      reaches,
      [{ reach: 12, root: "A", ...ro }],
      new Set(["A", "B"]),
    );
    expect(moved.find((r) => r.id === 12)?.root).toBe("A");
    expect(applyCuts(moved).cuts).toEqual([]);
    expect(reaches.find((r) => r.id === 12)?.root).toBe("B");
  });

  it("rejects unknown reaches and roots, and duplicates", () => {
    const roots = new Set(["A", "B"]);
    expect(() =>
      applyRootOverrides(reaches, [{ reach: 500, root: "A", ...ro }], roots),
    ).toThrow(/not a selected reach/);
    expect(() =>
      applyRootOverrides(reaches, [{ reach: 12, root: "Z", ...ro }], roots),
    ).toThrow(/unknown root/);
    expect(() =>
      applyRootOverrides(
        reaches,
        [
          { reach: 12, root: "A", ...ro },
          { reach: 12, root: "A", ...ro },
        ],
        roots,
      ),
    ).toThrow(/duplicate/);
  });
});
