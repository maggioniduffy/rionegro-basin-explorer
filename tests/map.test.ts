import { BASEMAP_TILE_URL } from "@/lib/map/config";
import { describe, expect, it } from "vitest";
import { MASK_LEVEL_COUNT } from "../lib/map/config";
import {
  MASKED_LAND_OPACITY,
  maskLayerOpacities,
  maskOpacities,
} from "../lib/map/mask";
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
  unmatchedFilter,
  reachLayerId,
  PROVINCE_LAYER_ID,
  BASEMAP_LAYER_ID,
  IMAGERY_LAYER_ID,
  reachFeatureSelection,
  reachOrder,
  selectionFilter,
  waterFilter,
} from "../lib/map/style";

describe("maskOpacities", () => {
  it("shows exactly one level, opaque, on a level stop (opaque land)", () => {
    expect(maskOpacities(2, 6, 1)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(maskOpacities(0, 6, 1)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(maskOpacities(5, 6, 1)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it("fades the smaller hole out between stops (opaque land)", () => {
    const o = maskOpacities(2.25, 6, 1);
    expect(o[2]).toBeCloseTo(0.75);
    expect(o[3]).toBe(1);
    expect(o.filter((x) => x > 0)).toHaveLength(2);
  });

  it("keeps masked land translucent, at the same opacity across a drag", () => {
    expect(MASKED_LAND_OPACITY).toBeGreaterThan(0.5);
    expect(MASKED_LAND_OPACITY).toBeLessThan(1);
    const d = MASKED_LAND_OPACITY;
    for (const v of [0, 0.4, 1, 2.25, 3.9, 4.5]) {
      const o = maskOpacities(v, 6);
      const i = Math.floor(v);
      const a = o[i + 1] ?? 0;
      const b = o[i] ?? 0;
      // Land outside hole i + 1 is under levels i and i + 1.
      expect(1 - (1 - a) * (1 - b)).toBeCloseTo(d);
      // The band between holes i and i + 1 fades from d to clear.
      expect(b).toBeCloseTo(d * (1 - (v - i)));
    }
    expect(maskOpacities(5, 6)).toEqual([0, 0, 0, 0, 0, d]);
  });

  it("clamps out-of-range values", () => {
    expect(maskOpacities(-1, 6)).toEqual(maskOpacities(0, 6));
    expect(maskOpacities(9, 6)).toEqual(maskOpacities(5, 6));
  });
});

describe("maskLayerOpacities", () => {
  it("keeps the whole-basin level, i.e. outside the basin, opaque", () => {
    for (const v of [0, 2.5, 5]) {
      const o = maskLayerOpacities(v, 6);
      expect(o[5]).toBe(1);
      expect(o.slice(0, 5)).toEqual(maskOpacities(v, 6).slice(0, 5));
    }
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
  it("matches a river by slug, a stream by id, a reach by feature id, nothing otherwise", () => {
    expect(selectionFilter({ kind: "river", id: "limay" })).toEqual([
      "==",
      ["get", "river"],
      "limay",
    ]);
    expect(selectionFilter({ kind: "stream", id: "arroyo-blanco-7" })).toEqual([
      "==",
      ["get", "stream"],
      "arroyo-blanco-7",
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
    region: "nqn",
    origin: "http://localhost",
    baseLayer: "satellite",
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

describe("buildStyle with the province outline (cba)", () => {
  const options = {
    origin: "http://localhost",
    baseLayer: "satellite",
    dataAttribution: "",
    theme: "dark",
    hideEndorheic: false,
    visibleLand: 3,
    selection: null,
    viewMode: "basin",
    isolatedIds: null,
    layers: DEFAULT_LAYERS,
  } as const;
  const cba = buildStyle({ ...options, region: "cba" });
  const nqn = buildStyle({ ...options, region: "nqn" });
  const index = (style: typeof cba, id: string) =>
    style.layers.findIndex((l) => l.id === id);

  it("draws Córdoba's boundary above the mask and under the rivers, valid style", () => {
    expect(validateStyleMin(cba)).toEqual([]);
    const i = index(cba, PROVINCE_LAYER_ID);
    expect(i).toBeGreaterThan(index(cba, maskLayerId(0)));
    expect(i).toBeLessThan(index(cba, reachLayerId("unknown")));
    expect(cba.layers[i]).toMatchObject({
      source: "rivers",
      "source-layer": "province",
    });
  });

  it("has no province layer for a region without one (nqn)", () => {
    expect(index(nqn, PROVINCE_LAYER_ID)).toBe(-1);
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
    expect(keeps(unmatchedFilter(false, layers), { piece: "aprhi:1#0" })).toBe(
      false,
    );
  });

  it("draws IGN's class (flow) over GIRES's on cba line pieces", () => {
    const dammed = {
      piece: "aprhi:3#0",
      strahler: 4,
      nonPerennial1d: 1,
      flow: 0,
    };
    const unmatchedIgn = { piece: "aprhi:4#0", flow: 1 };
    expect(keeps(reachFilter("perennial", false, DEFAULT_LAYERS), dammed)).toBe(
      true,
    );
    expect(
      keeps(reachFilter("nonPerennial", false, DEFAULT_LAYERS), dammed),
    ).toBe(false);
    expect(
      keeps(reachFilter("nonPerennial", false, DEFAULT_LAYERS), unmatchedIgn),
    ).toBe(true);
    expect(keeps(unmatchedFilter(false, DEFAULT_LAYERS), unmatchedIgn)).toBe(
      false,
    );
  });

  it("draws unmatched line pieces on their own layer, not as 'no prediction'", () => {
    const unmatched = { piece: "aprhi:1#0", network: "endorheic" };
    const matched = { piece: "aprhi:2#0", strahler: 3 };
    expect(keeps(unmatchedFilter(false, DEFAULT_LAYERS), unmatched)).toBe(true);
    expect(keeps(unmatchedFilter(true, DEFAULT_LAYERS), unmatched)).toBe(false);
    expect(keeps(unmatchedFilter(false, DEFAULT_LAYERS), matched)).toBe(false);
    expect(
      keeps(reachFilter("unknown", false, DEFAULT_LAYERS), unmatched),
    ).toBe(false);
    expect(keeps(reachFilter("unknown", false, DEFAULT_LAYERS), matched)).toBe(
      true,
    );
    // nqn reaches have no `piece`: "no prediction" as before.
    expect(
      keeps(reachFilter("unknown", false, DEFAULT_LAYERS), { strahler: 1 }),
    ).toBe(true);
  });
});

describe("reachFeatureSelection", () => {
  it("opens the approved river first, then the stream, then the reach", () => {
    const both = { river: "limay", stream: "arroyo-blanco-7" };
    expect(reachFeatureSelection(both, 7)).toEqual({
      kind: "river",
      id: "limay",
    });
    expect(reachFeatureSelection({ stream: "arroyo-blanco-7" }, 7)).toEqual({
      kind: "stream",
      id: "arroyo-blanco-7",
    });
    expect(reachFeatureSelection({ strahler: 1 }, 7)).toEqual({
      kind: "reach",
      id: 7,
    });
  });
  it("ignores empty properties and invalid feature ids", () => {
    expect(reachFeatureSelection({ river: "", stream: "" }, "7")).toEqual({
      kind: "reach",
      id: 7,
    });
    expect(reachFeatureSelection({}, undefined)).toBeNull();
    expect(reachFeatureSelection({}, 0)).toBeNull();
  });
});

describe("reachOrder", () => {
  it("prefers a piece's rank, then the Strahler order, else 0", () => {
    expect(reachOrder({ rank: 3, strahler: 5 })).toBe(3);
    expect(reachOrder({ strahler: 5 })).toBe(5);
    expect(reachOrder({ piece: "a-1-0" })).toBe(0);
  });

  it("leaves a piece no reach matched to the line panel (no selection)", () => {
    expect(
      reachFeatureSelection(
        { piece: "a-1-0", src: "aprhi", rank: 1 },
        undefined,
      ),
    ).toBeNull();
  });
});

describe("buildStyle with the base map (satellite or OpenStreetMap)", () => {
  const options = {
    region: "nqn",
    origin: "http://localhost",
    dataAttribution: "",
    theme: "dark",
    hideEndorheic: false,
    visibleLand: 3,
    selection: null,
    viewMode: "basin",
    isolatedIds: null,
    layers: DEFAULT_LAYERS,
  } as const;
  const withBase = (baseLayer: "satellite" | "map") =>
    buildStyle({
      ...options,
      baseLayer,
      imageryUrl: "https://imagery.example/{z}/{x}/{y}.jpg",
    });
  const layer = (style: ReturnType<typeof withBase>, id: string) =>
    style.layers.find((l) => l.id === id);

  it("is a valid style with both bases", () => {
    expect(validateStyleMin(withBase("satellite"))).toEqual([]);
    expect(validateStyleMin(withBase("map"))).toEqual([]);
  });

  it("shows only the chosen base", () => {
    const sat = withBase("satellite");
    expect(layer(sat, BASEMAP_LAYER_ID)?.layout).toEqual({
      visibility: "none",
    });
    expect(layer(sat, IMAGERY_LAYER_ID)?.layout).toEqual({
      visibility: "visible",
    });
    const map = withBase("map");
    expect(layer(map, BASEMAP_LAYER_ID)?.layout).toEqual({
      visibility: "visible",
    });
    expect(layer(map, IMAGERY_LAYER_ID)?.layout).toEqual({
      visibility: "none",
    });
  });

  it("draws the OpenStreetMap base under the mask, with its credit", () => {
    const style = withBase("map");
    const basemap = style.sources.basemap as {
      tiles: string[];
      attribution: string;
    };
    expect(basemap.tiles).toEqual([BASEMAP_TILE_URL]);
    expect(basemap.attribution).toContain("OpenStreetMap");
    const i = style.layers.findIndex((l) => l.id === BASEMAP_LAYER_ID);
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(
      style.layers.findIndex((l) => l.id === maskLayerId(0)),
    );
  });
});
