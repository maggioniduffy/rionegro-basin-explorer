import { describe, expect, it } from "vitest";
import { MASK_LEVEL_COUNT } from "../lib/map/config";
import { maskOpacities } from "../lib/map/mask";
import {
  featureFilter,
  type FilterSpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { DEFAULT_LAYERS, type LayerVisibility } from "../lib/store";
import {
  buildStyle,
  DAM_LAYER_ID,
  DAM_WALL_LAYER_ID,
  endoMaskOpacities,
  IGN_DETAIL_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
  LAKE_LAYER_ID,
  lakeFilter,
  maskLayerId,
  reachFilter,
  reachLayerId,
  selectionFilter,
  waterFilter,
} from "../lib/map/style";

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

describe("selectionFilter", () => {
  it("matches a river by slug, a reach by feature id, nothing otherwise", () => {
    expect(selectionFilter({ kind: "river", id: "limay" })).toEqual([
      "==",
      ["get", "river"],
      "limay",
    ]);
    expect(selectionFilter({ kind: "reach", id: 7 })).toEqual([
      "==",
      ["id"],
      7,
    ]);
    expect(selectionFilter(null)).toEqual(["boolean", false]);
  });
});

describe("buildStyle with the IGN layers", () => {
  const style = buildStyle({
    origin: "http://localhost",
    dataAttribution: "",
    theme: "dark",
    hideEndorheic: false,
    visibleLand: 3,
    selection: null,
    viewMode: "basin",
    isolatedIds: null,
    layers: DEFAULT_LAYERS,
  });
  const index = (id: string) => style.layers.findIndex((l) => l.id === id);

  it("is a valid style", () => {
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("draws IGN streams and extra lakes below the mask, dams above the rivers", () => {
    const firstMask = index(maskLayerId(0));
    expect(index(IGN_DETAIL_LAYER_ID)).toBeGreaterThan(-1);
    expect(index(IGN_DETAIL_LAYER_ID)).toBeLessThan(firstMask);
    expect(index(IGN_LAKE_FILL_LAYER_ID)).toBeLessThan(firstMask);
    expect(index(DAM_LAYER_ID)).toBeGreaterThan(
      index(reachLayerId("perennial")),
    );
    expect(index(DAM_WALL_LAYER_ID)).toBeGreaterThan(index(LAKE_LAYER_ID));
  });

  it("reads every IGN layer from the ign source", () => {
    expect(style.sources.ign).toMatchObject({ type: "vector" });
    for (const id of [
      IGN_DETAIL_LAYER_ID,
      IGN_LAKE_FILL_LAYER_ID,
      DAM_LAYER_ID,
      DAM_WALL_LAYER_ID,
    ])
      expect(style.layers[index(id)]).toMatchObject({ source: "ign" });
  });
});

/** Whether `filter` keeps a feature with these properties. */
const keeps = (
  filter: FilterSpecification,
  properties: Record<string, unknown>,
) =>
  featureFilter(filter, "layers[0].filter").filter({ zoom: 10 }, {
    type: 1,
    properties,
    geometry: [],
  } as never);

const layersWith = (patch: Partial<LayerVisibility>): LayerVisibility => ({
  ...DEFAULT_LAYERS,
  ...patch,
});

describe("waterFilter", () => {
  it("splits natural from artificial water bodies", () => {
    const natural = waterFilter(false, layersWith({ artificialLakes: false }));
    for (const kind of ["lake", "waterbody"])
      expect(keeps(natural, { kind, network: "connected" })).toBe(true);
    expect(keeps(natural, { kind: "reservoir", network: "connected" })).toBe(
      false,
    );

    const artificial = waterFilter(false, layersWith({ naturalLakes: false }));
    expect(keeps(artificial, { kind: "reservoir" })).toBe(true);
    expect(keeps(artificial, { kind: "controlled-lake" })).toBe(true);
    expect(keeps(artificial, { kind: "lake" })).toBe(false);
  });

  it("hides everything with both toggles off, and keeps the endorheic rule", () => {
    const none = layersWith({ naturalLakes: false, artificialLakes: false });
    expect(keeps(waterFilter(false, none), { kind: "lake" })).toBe(false);
    const endo = { kind: "lake", network: "endorheic" };
    expect(keeps(waterFilter(false, DEFAULT_LAYERS), endo)).toBe(true);
    expect(keeps(waterFilter(true, DEFAULT_LAYERS), endo)).toBe(false);
  });
});

describe("reachFilter with the Display toggles", () => {
  const perennial = { nonPerennial1d: 0, network: "connected" };

  it("hides a flow class on its own", () => {
    const flow = { ...DEFAULT_LAYERS.flow, perennial: false };
    const layers = layersWith({ flow });
    expect(keeps(reachFilter("perennial", false, layers), perennial)).toBe(
      false,
    );
    expect(
      keeps(reachFilter("nonPerennial", false, layers), { nonPerennial1d: 1 }),
    ).toBe(true);
  });

  it("hides every class with the rivers toggle", () => {
    const layers = layersWith({ rivers: false });
    expect(keeps(reachFilter("perennial", false, layers), perennial)).toBe(
      false,
    );
    expect(keeps(reachFilter("unknown", false, layers), {})).toBe(false);
  });
});
