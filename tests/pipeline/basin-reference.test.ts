import { describe, expect, it } from "vitest";
import {
  classifyExit,
  lev12Tolerance,
  pickExit,
  walkMainStem,
  withinPct,
} from "../../pipeline/lib/basin-reference-pure";

// 1 <- 2 <- 3 <- 4 (main), 2 <- 5 (small side branch), 3 <- 6 (smaller), mouth is 1.
const reaches = [
  { id: "1", nextDown: "0", upland: 100 },
  { id: "2", nextDown: "1", upland: 90 },
  { id: "3", nextDown: "2", upland: 60 },
  { id: "4", nextDown: "3", upland: 40 },
  { id: "5", nextDown: "2", upland: 20 },
  { id: "6", nextDown: "3", upland: 10 },
];

describe("walkMainStem", () => {
  it("takes the largest-upland branch and stops at the first outside reach", () => {
    const out = new Set(["4", "5"]);
    expect(walkMainStem(reaches, "1", (id) => out.has(id))).toEqual({
      entry: "4",
      path: ["1", "2", "3", "4"],
    });
  });

  it("does not follow a side branch even if only it is outside", () => {
    expect(walkMainStem(reaches, "1", (id) => id === "5")).toBeNull();
  });

  it("stops at the first outside reach, not a later one", () => {
    const out = new Set(["3", "4"]);
    expect(walkMainStem(reaches, "1", (id) => out.has(id))?.entry).toBe("3");
  });

  it("tests the mouth itself", () => {
    expect(walkMainStem(reaches, "1", () => true)).toEqual({
      entry: "1",
      path: ["1"],
    });
  });

  it("returns null for a headwater with no outside reach", () => {
    expect(walkMainStem(reaches, "1", () => false)).toBeNull();
  });

  it("breaks upland ties with the lowest id", () => {
    const tie = [
      { id: "1", nextDown: "0", upland: 10 },
      { id: "9", nextDown: "1", upland: 5 },
      { id: "7", nextDown: "1", upland: 5 },
    ];
    expect(walkMainStem(tie, "1", (id) => id !== "1")?.entry).toBe("7");
  });

  it("throws when the mouth is unknown or the graph has a cycle", () => {
    expect(() => walkMainStem(reaches, "99", () => false)).toThrow(/mouth/);
    const cyc = [
      { id: "1", nextDown: "2", upland: 1 },
      { id: "2", nextDown: "1", upland: 1 },
    ];
    expect(() => walkMainStem(cyc, "1", () => false)).toThrow(/cycle/);
  });
});

describe("classifyExit", () => {
  it("classifies terminal reaches by ENDORHEIC", () => {
    expect(classifyExit({ nextDown: "0", endorheic: 1 }, null).kind).toBe(
      "sink",
    );
    expect(classifyExit({ nextDown: "0", endorheic: 0 }, null).kind).toBe(
      "sea",
    );
  });

  it("classifies flow into another root or out of the region", () => {
    expect(classifyExit({ nextDown: "7", endorheic: 0 }, "03")).toEqual({
      kind: "into-root",
      intoCode: "03",
    });
    expect(classifyExit({ nextDown: "7", endorheic: 0 }, null)).toEqual({
      kind: "leaves-region",
      intoCode: null,
    });
  });
});

describe("pickExit", () => {
  const c = (id: string, upland: number) => ({
    id,
    upland,
    kind: "sink" as const,
    intoCode: null,
  });
  const cands = [c("a", 500), c("b", 5000), c("d", 1000), c("e", 999)];

  it("without an expectation picks the largest and lists other big candidates", () => {
    const r = pickExit(cands, null, 1000);
    expect(r.exit?.id).toBe("b");
    expect(r.exitIsLargest).toBe(true);
    expect(r.expectedIsCandidate).toBeNull();
    expect(r.others.map((o) => o.id)).toEqual(["d"]);
  });

  it("with an expectation the exit is that candidate, not the largest", () => {
    const r = pickExit(cands, "d", 1000);
    expect(r.exit?.id).toBe("d");
    expect(r.largest?.id).toBe("b");
    expect(r.exitIsLargest).toBe(false);
    expect(r.expectedIsCandidate).toBe(true);
    expect(r.others.map((o) => o.id)).toEqual(["b"]);
  });

  it("an expected reach that is not a candidate gives no exit", () => {
    const r = pickExit(cands, "zzz", 1000);
    expect(r.exit).toBeNull();
    expect(r.expectedIsCandidate).toBe(false);
    expect(r.largest?.id).toBe("b");
  });

  it("is deterministic on ties and handles no candidates", () => {
    expect(pickExit([c("9", 5), c("2", 5)], null, 1).exit?.id).toBe("2");
    expect(pickExit([], null, 1).exit).toBeNull();
  });
});

describe("withinPct", () => {
  it("compares within a percentage", () => {
    expect(withinPct(101, 100, 1)).toBe(true);
    expect(withinPct(102, 100, 1)).toBe(false);
    expect(withinPct(1, 0, 1)).toBe(false);
  });
});

describe("lev12Tolerance", () => {
  it("uses the percentage for big roots and two median polygons for small ones", () => {
    const areas = [10, 20, 30]; // median 20
    expect(lev12Tolerance(100000, areas, 3)).toBe(3000);
    expect(lev12Tolerance(1000, areas, 3)).toBe(40);
  });

  it("falls back to the percentage with no members", () => {
    expect(lev12Tolerance(1000, [], 3)).toBe(30);
  });
});
