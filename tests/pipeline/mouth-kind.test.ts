import { describe, expect, it } from "vitest";
import {
  type NetworkReach,
  mouthKinds,
  overridePaths,
  seaDistance,
  terminalFlowsInto,
  terminalKind,
} from "../../pipeline/lib/mouth-kind";

const reach = (r: Partial<NetworkReach> & { id: number }): NetworkReach => ({
  nextDown: 0,
  nextDownEdit: null,
  endorheic: false,
  network: "connected",
  ...r,
});

describe("terminalKind", () => {
  it("reads the end of a path from the source fields only", () => {
    expect(terminalKind(reach({ id: 1, nextDownEdit: "outside" }))).toBe(
      "region-edge",
    );
    expect(terminalKind(reach({ id: 2, endorheic: true }))).toBe("sink");
    expect(terminalKind(reach({ id: 3, network: "endorheic" }))).toBe("sink");
    expect(terminalKind(reach({ id: 4 }))).toBe("sea");
  });

  it("leaving the region wins over the endorheic flag", () => {
    expect(
      terminalKind(reach({ id: 1, nextDownEdit: "outside", endorheic: true })),
    ).toBe("region-edge");
  });

  it("throws on a cut into another root with no sink flag (no field names its end)", () => {
    expect(() => terminalKind(reach({ id: 9, nextDownEdit: "cut" }))).toThrow(
      /reach 9/,
    );
    expect(
      terminalKind(reach({ id: 9, nextDownEdit: "cut", endorheic: true })),
    ).toBe("sink");
  });
});

describe("mouthKinds", () => {
  it("gives every reach on a path the kind of the path's end", () => {
    const kinds = mouthKinds([
      reach({ id: 1, nextDown: 2 }),
      reach({ id: 2, nextDown: 3 }),
      reach({ id: 3, endorheic: true }),
      reach({ id: 4, nextDown: 2 }),
      reach({ id: 5, nextDownEdit: "outside" }),
      reach({ id: 6 }),
    ]);
    expect(Object.fromEntries(kinds)).toEqual({
      1: "sink",
      2: "sink",
      3: "sink",
      4: "sink",
      5: "region-edge",
      6: "sea",
    });
  });

  it("throws on a cycle and on a NEXT_DOWN outside the network", () => {
    expect(() =>
      mouthKinds([
        reach({ id: 1, nextDown: 2 }),
        reach({ id: 2, nextDown: 1 }),
      ]),
    ).toThrow(/cycle/);
    expect(() => mouthKinds([reach({ id: 1, nextDown: 99 })])).toThrow(
      /NEXT_DOWN 99/,
    );
  });
});

describe("terminalFlowsInto", () => {
  it("keeps nqn's 'sea' when a region has no kinds", () => {
    expect(terminalFlowsInto(undefined)).toBe("sea");
    expect(terminalFlowsInto("sink")).toBe("sink");
  });
});

describe("overridePaths and seaDistance", () => {
  const net = [
    reach({ id: 1, nextDown: 2 }),
    reach({ id: 2, nextDown: 3, nextDownEdit: "override" }),
    reach({ id: 3, nextDown: 4 }),
    reach({ id: 4, nextDownEdit: "outside" }),
    reach({ id: 5, nextDown: 4 }),
  ];

  it("marks every reach above an override link, and none below it", () => {
    expect([...overridePaths(net)].sort()).toEqual([1, 2]);
  });

  it("gives no distance for a sink or across an override, DIST_DN_KM otherwise", () => {
    expect(seaDistance("sink", false, 12)).toBeNull();
    expect(seaDistance("region-edge", true, 47.9)).toBeNull();
    expect(seaDistance("region-edge", false, 378.2)).toBe(378.2);
    expect(seaDistance(undefined, false, 640)).toBe(640);
  });
});
