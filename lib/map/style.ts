import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import {
  IMAGERY_MAXZOOM,
  MASK_LEVEL_COUNT,
  mapConfig,
  TILE_PATHS,
} from "./config";
import type { LayerVisibility, ViewMode } from "../store";
import type { Selection } from "../url-state";
import { maskOpacities } from "./mask";

export type Theme = "dark" | "light";

/** Flow-regime classes from GIRES `predcat1` (exported as `nonPerennial1d`). */
export const FLOW_CLASSES = ["perennial", "nonPerennial", "unknown"] as const;
export type FlowClass = (typeof FLOW_CLASSES)[number];

/** Same river colours in both themes: they sit on satellite imagery, not on the UI. */
export const FLOW_STYLE: Record<
  FlowClass,
  { color: string; dash?: [number, number]; widthScale: number }
> = {
  perennial: { color: "#38bdf8", widthScale: 1 },
  nonPerennial: { color: "#f0c27b", dash: [2, 1.5], widthScale: 0.9 },
  unknown: { color: "#9aa3ab", widthScale: 0.6 },
};

export const THEME_COLORS: Record<
  Theme,
  { mask: string; outline: string; lake: string }
> = {
  dark: {
    mask: "#050607",
    outline: "rgba(230, 232, 234, 0.55)",
    lake: "rgba(230, 232, 234, 0.35)",
  },
  light: {
    mask: "#f3f2ee",
    outline: "rgba(31, 35, 40, 0.55)",
    lake: "rgba(31, 35, 40, 0.35)",
  },
};

/**
 * One colour for every sub-basin, in both themes: they are told apart by their
 * borders and the selection's stronger tint, not by hue.
 */
export const SUBBASIN_COLOR = "#ffffff";
export const SUBBASIN_FILL_LAYER_ID = "subbasins-fill";
export const SUBBASIN_LINE_LAYER_ID = "subbasins-outline";
/** The selected node's whole border, from the `outlines` layer (no inner borders). */
export const SUBBASIN_SELECTED_LAYER_ID = "subbasins-selected";
/** Covers every sub-basin but the isolated ones, rivers included, in the mask colour. */
export const SUBBASIN_HIDE_LAYER_ID = "subbasins-hidden";

/**
 * Own-area features in the subtree of any of `ids`: each feature's `path` property is
 * ",negro,limay,collon-cura," (pipeline:subbasins), so one substring test per id.
 */
export function inSubtrees(ids: readonly string[]): ExpressionSpecification {
  return [
    "any",
    ...ids.map((id): ExpressionSpecification => [
      "in",
      `,${id},`,
      ["get", "path"],
    ]),
  ];
}

export function hiddenSubbasinsFilter(
  isolatedIds: string[] | null,
): FilterSpecification {
  return isolatedIds ? ["!", inSubtrees(isolatedIds)] : ["boolean", false];
}

const selectedSubbasin = (sel: Selection | null) =>
  sel?.kind === "subbasin" ? sel.id : "";

/**
 * The selected sub-basin is tinted with all its descendants (they are its land too);
 * the others show by their borders.
 */
export function subbasinFillOpacity(
  mode: ViewMode,
  sel: Selection | null,
): ExpressionSpecification | number {
  const id = selectedSubbasin(sel);
  if (mode === "basin" || !id) return 0;
  return ["case", inSubtrees([id]), 0.12, 0];
}

/**
 * Sub-basins drawn: endorheic land hides with the endorheic streams, and while some
 * are isolated only those keep their tint and border (a border's outer half would
 * otherwise show past the hiding layer).
 */
export function subbasinFilter(
  hideEndorheic: boolean,
  isolatedIds: string[] | null = null,
): FilterSpecification {
  return [
    "all",
    hideEndorheic ? ["!=", ["get", "kind"], "endorheic"] : true,
    isolatedIds ? inSubtrees(isolatedIds) : true,
  ];
}

/** The basin outline steps aside while sub-basins are isolated. */
export const basinOutlineOpacity = (isolatedIds: string[] | null) =>
  isolatedIds ? 0 : 1;

export function subbasinLineOpacity(mode: ViewMode): number {
  return mode === "basin" ? 0 : 0.9;
}

/** Only the selected node's whole outline; nothing when no sub-basin is selected. */
export function selectedOutlineFilter(
  sel: Selection | null,
): FilterSpecification {
  return ["==", ["get", "id"], selectedSubbasin(sel)];
}

export const maskLayerId = (level: number) => `mask-${level}`;
export const reachLayerId = (c: FlowClass) => `reaches-${c}`;
export const MASK_LAYER_IDS = Array.from({ length: MASK_LEVEL_COUNT }, (_, k) =>
  maskLayerId(k),
);
export const endoMaskLayerId = (level: number) => `mask-endorheic-${level}`;
export const ENDO_MASK_LAYER_IDS = Array.from(
  { length: MASK_LEVEL_COUNT },
  (_, k) => endoMaskLayerId(k),
);

/**
 * Opacity of each endorheic overlay level: the mask level's own opacity when endorheic
 * streams are hidden (so their land disappears with them), otherwise 0. The overlay of
 * level k is disjoint from mask level k (pipeline:mask), so the two never double up.
 */
export function endoMaskOpacities(
  visibleLand: number,
  hideEndorheic: boolean,
): number[] {
  return maskOpacities(visibleLand, MASK_LEVEL_COUNT).map((o) =>
    hideEndorheic ? o : 0,
  );
}

/** Lake outlines: endorheic lakes hide with the endorheic streams. */
export function lakeFilter(hideEndorheic: boolean): FilterSpecification {
  return hideEndorheic
    ? ["!=", ["get", "network"], "endorheic"]
    : ["literal", true];
}

/**
 * Water-body `kind`s per Display toggle (pipeline:ign-layers). A HydroLAKES controlled
 * lake (type 3) has a regulating structure, so it counts as artificial (owner). IGN
 * water bodies follow IGN: "espejo de agua perenne" (`waterbody`) is natural, its
 * `Embalse` layer (`reservoir`) artificial. The two never overlap: the IGN extra
 * layer has the HydroLAKES part cut out.
 */
export const NATURAL_WATER_KINDS = ["lake", "waterbody"];
export const ARTIFICIAL_WATER_KINDS = ["reservoir", "controlled-lake"];

/** Lake layers (not dams): the endorheic rule plus the natural/artificial toggles. */
export function waterFilter(
  hideEndorheic: boolean,
  layers: Pick<LayerVisibility, "naturalLakes" | "artificialLakes">,
): FilterSpecification {
  const kinds = [
    ...(layers.naturalLakes ? NATURAL_WATER_KINDS : []),
    ...(layers.artificialLakes ? ARTIFICIAL_WATER_KINDS : []),
  ];
  if (kinds.length === 0) return ["boolean", false];
  return [
    "all",
    lakeFilter(hideEndorheic) as ExpressionSpecification,
    ["in", ["get", "kind"], ["literal", kinds]],
  ];
}
export const REACH_LAYER_IDS = FLOW_CLASSES.map(reachLayerId);
export const OUTLINE_LAYER_ID = "basin-outline";
export const LAKE_LAYER_ID = "lake-outline";
/** Invisible fill over every lake, so a click inside a lake finds it. */
export const LAKE_HIT_LAYER_ID = "lake-hit";
/** IGN layers (pipeline:ign-layers). Detail lines and extra lakes sit below the mask. */
export const IGN_DETAIL_LAYER_ID = "ign-detail";
export const IGN_LAKE_FILL_LAYER_ID = "ign-lakes-extra-fill";
export const IGN_LAKE_LINE_LAYER_ID = "ign-lakes-extra-outline";
export const DAM_WALL_LAYER_ID = "dam-walls";
export const DAM_LAYER_ID = "dams";
/** OSM cities, towns and villages (pipeline:localities), drawn above the dams. */
export const LOCALITY_LAYER_ID = "localities";
export const LOCALITY_COLOR = "#fb923c";

/** Localities: hidden by the Display toggle. */
export function localityFilter(show: boolean): FilterSpecification {
  return show ? ["literal", true] : ["boolean", false];
}

/** Colour of the IGN detail lines, also used by the legend. */
export const IGN_DETAIL_COLOR = "#67e8f9";

export const IMAGERY_LAYER_ID = "imagery";
export const BACKGROUND_LAYER_ID = "background";
/** Halo under the selected river or reach, drawn below the flow-class lines. */
export const SELECTED_LAYER_ID = "reaches-selected";
export const SELECTED_COLOR = "#fde68a";

/** Tile features carry the reach id as feature id and the river slug as `river`. */
export function selectionFilter(sel: Selection | null): FilterSpecification {
  if (!sel || sel.kind === "subbasin") return ["boolean", false];
  return sel.kind === "river"
    ? ["==", ["get", "river"], sel.id]
    : ["==", ["id"], sel.id];
}

// tippecanoe omits null attributes, so "no GIRES prediction" is a missing property.
const CLASS_FILTER: Record<FlowClass, ExpressionSpecification> = {
  perennial: ["==", ["get", "nonPerennial1d"], 0],
  nonPerennial: ["==", ["get", "nonPerennial1d"], 1],
  unknown: ["!", ["has", "nonPerennial1d"]],
};

/** One flow class's reaches; hidden with all rivers or by its own toggle. */
export function reachFilter(
  c: FlowClass,
  hideEndorheic: boolean,
  layers: Pick<LayerVisibility, "rivers" | "flow">,
): FilterSpecification {
  if (!layers.rivers || !layers.flow[c]) return ["boolean", false];
  return hideEndorheic
    ? ["all", CLASS_FILTER[c], ["!=", ["get", "network"], "endorheic"]]
    : CLASS_FILTER[c];
}

/** Line width in px, by Strahler order (1–7) and zoom, plus `extra` px. */
function reachWidth(scale: number, extra = 0): ExpressionSpecification {
  const s: ExpressionSpecification = ["get", "strahler"];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    ["+", extra, ["*", 0.35 * scale, s]],
    10,
    ["+", extra, ["*", scale, ["+", 0.4, ["*", 0.8, s]]]],
    14,
    ["+", extra, ["*", scale, ["+", 1, ["*", 1.4, s]]]],
  ];
}

export interface StyleOptions {
  /** Absolute origin for the pmtiles:// URLs, e.g. window.location.origin. */
  origin: string;
  imageryUrl?: string;
  imageryAttribution?: string;
  /** HTML for the rivers source credit (HydroSHEDS, GIRES). */
  dataAttribution: string;
  theme: Theme;
  hideEndorheic: boolean;
  visibleLand: number;
  selection: Selection | null;
  viewMode: ViewMode;
  isolatedIds: string[] | null;
  layers: LayerVisibility;
}

export function buildStyle(o: StyleOptions): StyleSpecification {
  const { mask, outline, lake } = THEME_COLORS[o.theme];
  // Everything outside the basin is always masked, so no imagery is needed there.
  const { xmin, ymin, xmax, ymax } = mapConfig.basinBbox;
  const opacities = maskOpacities(o.visibleLand, MASK_LEVEL_COUNT);

  const layers: LayerSpecification[] = [
    {
      id: BACKGROUND_LAYER_ID,
      type: "background",
      paint: { "background-color": mask },
    },
  ];
  if (o.imageryUrl) {
    layers.push({
      id: IMAGERY_LAYER_ID,
      type: "raster",
      source: "imagery",
      // Transparent until the mask has loaded (MapView fades it in), so the imagery
      // outside the basin never shows on first load or after a locale switch.
      // No cross-fade between zoom levels: fading draws parent and child tiles
      // together on every frame of a zoom (perf:zoom, 4x CPU throttle).
      paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
    });
  }
  // Below the mask, so sub-basins are tinted only on the visible land.
  layers.push({
    id: SUBBASIN_FILL_LAYER_ID,
    type: "fill",
    source: "subbasins",
    "source-layer": "subbasins",
    filter: subbasinFilter(o.hideEndorheic, o.isolatedIds),
    paint: {
      "fill-color": SUBBASIN_COLOR,
      "fill-opacity": subbasinFillOpacity(o.viewMode, o.selection),
    },
  });
  // Below the mask like the sub-basin tint: IGN water bodies and streams that
  // HydroLAKES / HydroRIVERS lack show only on the visible land.
  layers.push(
    {
      id: IGN_LAKE_FILL_LAYER_ID,
      type: "fill",
      source: "ign",
      "source-layer": "lakes_extra",
      filter: waterFilter(o.hideEndorheic, o.layers),
      paint: { "fill-color": IGN_DETAIL_COLOR, "fill-opacity": 0.25 },
    },
    {
      id: IGN_LAKE_LINE_LAYER_ID,
      type: "line",
      source: "ign",
      "source-layer": "lakes_extra",
      filter: waterFilter(o.hideEndorheic, o.layers),
      paint: {
        "line-color": lake,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 1],
      },
    },
    {
      id: IGN_DETAIL_LAYER_ID,
      type: "line",
      source: "ign",
      "source-layer": "detail",
      filter: lakeFilter(o.hideEndorheic),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": IGN_DETAIL_COLOR,
        "line-opacity": 0.85,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 12, 1.4],
      },
    },
  );
  for (let k = 0; k < MASK_LEVEL_COUNT; k++) {
    const opacity = opacities[k] ?? 0;
    layers.push({
      id: maskLayerId(k),
      type: "fill",
      source: "mask",
      "source-layer": "mask",
      filter: ["==", ["get", "level"], k],
      // Always visible, driven by opacity only: toggling visibility makes MapLibre
      // re-process the source's tiles, and while it does the level isn't drawn, so the
      // imagery outside the basin flashes through.
      paint: {
        "fill-color": mask,
        "fill-opacity": opacity,
        // Follow the slider exactly; the default 300 ms fade lags behind a drag.
        "fill-opacity-transition": { duration: 0, delay: 0 },
      },
    });
  }
  const endoOpacities = endoMaskOpacities(o.visibleLand, o.hideEndorheic);
  for (let k = 0; k < MASK_LEVEL_COUNT; k++) {
    layers.push({
      id: endoMaskLayerId(k),
      type: "fill",
      source: "mask",
      "source-layer": "endorheic",
      filter: ["==", ["get", "level"], k],
      // Same rules as the mask levels: always visible, opacity only, no fade.
      paint: {
        "fill-color": mask,
        "fill-opacity": endoOpacities[k] ?? 0,
        "fill-opacity-transition": { duration: 0, delay: 0 },
      },
    });
  }
  // Lakes are never masked (pipeline:mask) and have no river lines inside
  // (pipeline:lakes); a thin outline marks their shore.
  layers.push({
    id: LAKE_LAYER_ID,
    type: "line",
    source: "rivers",
    "source-layer": "lakes",
    filter: waterFilter(o.hideEndorheic, o.layers),
    paint: {
      "line-color": lake,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 1.2],
    },
  });
  layers.push({
    id: LAKE_HIT_LAYER_ID,
    type: "fill",
    source: "rivers",
    "source-layer": "lakes",
    filter: waterFilter(o.hideEndorheic, o.layers),
    paint: { "fill-opacity": 0 },
  });
  layers.push({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: "rivers",
    "source-layer": "basin",
    paint: {
      "line-color": outline,
      "line-width": 1,
      "line-opacity": basinOutlineOpacity(o.isolatedIds),
    },
  });
  // Above the mask: sub-basin borders show at every Visible Land level.
  layers.push({
    id: SUBBASIN_LINE_LAYER_ID,
    type: "line",
    source: "subbasins",
    "source-layer": "subbasins",
    filter: subbasinFilter(o.hideEndorheic, o.isolatedIds),
    layout: { "line-join": "round" },
    paint: {
      "line-color": SUBBASIN_COLOR,
      "line-opacity": subbasinLineOpacity(o.viewMode),
      "line-width": 1.5,
    },
  });
  layers.push({
    id: SUBBASIN_SELECTED_LAYER_ID,
    type: "line",
    source: "subbasins",
    "source-layer": "outlines",
    filter: selectedOutlineFilter(o.selection),
    layout: { "line-join": "round" },
    paint: {
      "line-color": SUBBASIN_COLOR,
      "line-opacity": subbasinLineOpacity(o.viewMode),
      "line-width": 3,
    },
  });
  layers.push({
    id: SELECTED_LAYER_ID,
    type: "line",
    source: "rivers",
    "source-layer": "reaches",
    filter: selectionFilter(o.selection),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": SELECTED_COLOR,
      "line-opacity": 0.9,
      "line-width": reachWidth(1, 5),
      "line-blur": 1,
    },
  });
  // Drawn smallest class first so perennial rivers sit on top.
  for (const c of ["unknown", "nonPerennial", "perennial"] as const) {
    const { color, dash, widthScale } = FLOW_STYLE[c];
    layers.push({
      id: reachLayerId(c),
      type: "line",
      source: "rivers",
      "source-layer": "reaches",
      filter: reachFilter(c, o.hideEndorheic, o.layers),
      layout: { "line-cap": dash ? "butt" : "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": reachWidth(widthScale),
        ...(dash ? { "line-dasharray": dash } : {}),
      },
    });
  }
  // Dams stand at reservoirs, which are visible at every Visible Land level.
  layers.push(
    {
      id: DAM_WALL_LAYER_ID,
      type: "line",
      source: "ign",
      "source-layer": "dam_walls",
      filter: lakeFilter(o.hideEndorheic),
      paint: {
        "line-color": "#f1f5f9",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 12, 3],
      },
    },
    {
      id: DAM_LAYER_ID,
      type: "circle",
      source: "ign",
      "source-layer": "dams",
      filter: lakeFilter(o.hideEndorheic),
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 6],
        "circle-color": "#f1f5f9",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 1.5,
      },
    },
  );
  layers.push({
    id: LOCALITY_LAYER_ID,
    type: "circle",
    source: "localities",
    "source-layer": "localities",
    filter: localityFilter(o.layers.localities),
    paint: {
      // Bigger for a bigger class: city, town, village.
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        ["match", ["get", "place"], "city", 3.5, 2.5],
        12,
        ["match", ["get", "place"], "city", 8, "town", 6.5, 5],
      ],
      "circle-color": LOCALITY_COLOR,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 1.25,
    },
  });
  // On top of everything, so the hidden sub-basins lose their rivers too.
  layers.push({
    id: SUBBASIN_HIDE_LAYER_ID,
    type: "fill",
    source: "subbasins",
    "source-layer": "subbasins",
    filter: hiddenSubbasinsFilter(o.isolatedIds),
    paint: { "fill-color": mask, "fill-opacity": 1 },
  });

  return {
    version: 8,
    sources: {
      ...(o.imageryUrl
        ? {
            imagery: {
              type: "raster",
              tiles: [o.imageryUrl],
              tileSize: 256,
              maxzoom: IMAGERY_MAXZOOM,
              bounds: [xmin, ymin, xmax, ymax],
              attribution: o.imageryAttribution ?? "",
            },
          }
        : {}),
      rivers: {
        type: "vector",
        url: `pmtiles://${o.origin}${TILE_PATHS.rivers}`,
        attribution: o.dataAttribution,
      },
      mask: { type: "vector", url: `pmtiles://${o.origin}${TILE_PATHS.mask}` },
      subbasins: {
        type: "vector",
        url: `pmtiles://${o.origin}${TILE_PATHS.subbasins}`,
      },
      ign: { type: "vector", url: `pmtiles://${o.origin}${TILE_PATHS.ign}` },
      localities: {
        type: "vector",
        url: `pmtiles://${o.origin}${TILE_PATHS.localities}`,
      },
    },
    layers,
  };
}
