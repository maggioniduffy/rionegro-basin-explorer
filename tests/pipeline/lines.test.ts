import { describe, expect, it } from "vitest";
import {
  mapStatus,
  mergeRuns,
  pieceRuns,
  type StatusRules,
} from "../../pipeline/lib/lines";

const rules: StatusRules = {
  drop: ["Eliminado"],
  map: { vigente: "vigente", "en revisión": "en-revision" },
};

describe("mapStatus", () => {
  it("drops, maps and keeps empty as null", () => {
    expect(mapStatus("Eliminado", rules)).toEqual({ kind: "drop" });
    expect(mapStatus("En revisión", rules)).toEqual({
      kind: "keep",
      status: "en-revision",
    });
    expect(mapStatus("VIgente", rules)).toEqual({
      kind: "keep",
      status: "vigente",
    });
    expect(mapStatus(null, rules)).toEqual({ kind: "keep", status: null });
    expect(mapStatus("  ", rules)).toEqual({ kind: "keep", status: null });
  });
  it("flags values it has no rule for", () => {
    expect(mapStatus("Otro", rules)).toEqual({
      kind: "unknown",
      label: "otro",
    });
  });
});

describe("mergeRuns", () => {
  it("merges consecutive equal reaches, null included", () => {
    expect(mergeRuns([1, 1, null, null, 2])).toEqual([
      { from: 0, to: 2, reach: 1 },
      { from: 2, to: 4, reach: null },
      { from: 4, to: 5, reach: 2 },
    ]);
    expect(mergeRuns([])).toEqual([]);
  });
});

describe("pieceRuns", () => {
  it("absorbs a short run between two runs of the same reach", () => {
    // 10 parts of 100 m; one part (100 m) to reach 2 between reach 1.
    const r = [1, 1, 1, 2, 1, 1, 1, 1, 1, 1];
    expect(pieceRuns(r, 1000, 250)).toEqual([{ from: 0, to: 10, reach: 1 }]);
  });
  it("absorbs a short unmatched gap too", () => {
    expect(pieceRuns([1, 1, null, 1, 1], 500, 150)).toEqual([
      { from: 0, to: 5, reach: 1 },
    ]);
  });
  it("keeps runs at or above the minimum", () => {
    expect(pieceRuns([1, 2, 2, 1], 400, 200)).toHaveLength(3);
  });
  it("keeps a short run between different reaches or at the ends", () => {
    expect(pieceRuns([1, 1, 2, 3, 3], 500, 500)).toHaveLength(3);
    expect(pieceRuns([2, 1, 1, 1], 400, 150)).toHaveLength(2);
  });
  it("does not absorb into an unmatched neighbour pair", () => {
    expect(pieceRuns([null, 5, null], 300, 500)).toHaveLength(3);
  });
  it("cascades until stable", () => {
    // 1 | 2 | 1 | 3 | 1: absorbing 2 gives one long 1-run; 3 is then between 1 and 1.
    expect(pieceRuns([1, 2, 1, 3, 1], 500, 150)).toEqual([
      { from: 0, to: 5, reach: 1 },
    ]);
  });
});
