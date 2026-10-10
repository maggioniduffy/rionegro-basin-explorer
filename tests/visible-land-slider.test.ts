import { describe, expect, it } from "vitest";
import {
  LEVEL_VISIBLE_SHARE,
  levelToPosition,
  positionToLevel,
} from "@/lib/map/mask";

describe("Visible Land slider position", () => {
  it("spans the bar from level 0 to the last level", () => {
    expect(positionToLevel(0)).toBe(0);
    expect(positionToLevel(1)).toBe(LEVEL_VISIBLE_SHARE.length - 1);
    expect(levelToPosition(0)).toBe(0);
    expect(levelToPosition(LEVEL_VISIBLE_SHARE.length - 1)).toBeCloseTo(1);
  });

  it("round-trips", () => {
    for (const v of [0, 0.4, 1, 2.5, 3, 4.2, 5]) {
      expect(positionToLevel(levelToPosition(v))).toBeCloseTo(v);
    }
  });

  it("puts half the basin near the middle of the bar", () => {
    const level = positionToLevel(0.5);
    expect(level).toBeGreaterThan(3);
    expect(level).toBeLessThan(4);
  });
});
