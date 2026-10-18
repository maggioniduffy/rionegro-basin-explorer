import { describe, expect, it } from "vitest";
import {
  type XY,
  PolyIndex,
  cutWindows,
  stationSpan,
} from "@/pipeline/lib/flow-sections";

describe("cutWindows", () => {
  it("cuts a 10.4 km course into 3 equal windows with linked ids", () => {
    const w = cutWindows("limay", 10_400, 4);
    expect(w.map((s) => s.id)).toEqual(["limay-000", "limay-001", "limay-002"]);
    expect(w.map((s) => s.prev)).toEqual([null, "limay-000", "limay-001"]);
    expect(w.map((s) => s.next)).toEqual(["limay-001", "limay-002", null]);
    expect(w.every((s) => s.count === 3)).toBe(true);
    for (const s of w) expect(s.s1 - s.s0).toBeCloseTo(10_400 / 3, 6);
    expect(w[0]!.s0).toBe(0);
    expect(w[2]!.s1).toBe(10_400);
    // Rounded lengths add up to the course length.
    expect(w.reduce((sum, s) => sum + s.lengthM, 0)).toBeCloseTo(10_400, 6);
  });

  it("gives a short course one window", () => {
    const w = cutWindows("traful", 1_200, 4);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: "traful-000", prev: null, next: null });
  });
});

describe("stationSpan", () => {
  const cfg = {
    maxSearchM: 1500,
    maxOffsetM: 200,
    maxSpanM: 1500,
    mergeGapM: 1,
  };
  const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  // A channel 200 m wide along the x axis, with an island (a hole) from y=20 to y=60 at x=480..520.
  const water = new PolyIndex(
    [[rect(0, -100, 1000, 100), rect(480, 20, 520, 60)]],
    500,
  );
  // The left normal of a station on the x axis walking along +x.
  const left: XY = [0, 1];

  it("takes the interval that holds the centerline, stopping at the island", () => {
    expect(stationSpan(water, 500, 0, left, cfg)).toEqual([-100, 20]);
    // Away from the island the whole channel is one interval.
    expect(stationSpan(water, 200, 0, left, cfg)).toEqual([-100, 100]);
  });

  it("takes the nearest interval when the centerline is 50 m outside the water", () => {
    // From y=150: the channel is 50 m below; the island splits it, the nearer part is [-90, -50].
    expect(stationSpan(water, 500, 150, left, cfg)).toEqual([-90, -50]);
    expect(stationSpan(water, 200, 150, left, cfg)).toEqual([-250, -50]);
  });

  it("returns null when nothing lies within maxOffsetM", () => {
    expect(stationSpan(water, 500, 500, left, cfg)).toBeNull();
  });
});
