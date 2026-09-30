import { describe, expect, it } from "vitest";
import { MASK_LEVEL_COUNT } from "../lib/map/config";
import { maskOpacities } from "../lib/map/mask";
import { endoMaskOpacities, lakeFilter } from "../lib/map/style";

describe("maskOpacities", () => {
  it("shows exactly one level, opaque, on a level stop", () => {
    expect(maskOpacities(2, 6)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(maskOpacities(0, 6)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(maskOpacities(5, 6)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it("fades the smaller hole out between stops", () => {
    const o = maskOpacities(2.25, 6);
    expect(o[2]).toBeCloseTo(0.75);
    expect(o[3]).toBe(1);
    expect(o.filter((x) => x > 0)).toHaveLength(2);
  });

  it("clamps out-of-range values", () => {
    expect(maskOpacities(-1, 6)).toEqual(maskOpacities(0, 6));
    expect(maskOpacities(9, 6)).toEqual(maskOpacities(5, 6));
  });
});

describe("endorheic overlay", () => {
  it("is transparent while endorheic streams are shown", () => {
    expect(endoMaskOpacities(2.5, false).every((o) => o === 0)).toBe(true);
  });

  it("follows the mask opacities when endorheic streams are hidden", () => {
    for (const v of [0, 1.3, 2.5, 4.99, MASK_LEVEL_COUNT - 1])
      expect(endoMaskOpacities(v, true)).toEqual(
        maskOpacities(v, MASK_LEVEL_COUNT),
      );
  });

  it("filters endorheic lake outlines only when hidden", () => {
    expect(lakeFilter(false)).toEqual(["literal", true]);
    expect(lakeFilter(true)).toEqual(["!=", ["get", "network"], "endorheic"]);
  });
});
