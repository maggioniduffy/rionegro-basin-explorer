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
import type { ViewMode } from "../store";
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
/** Covers every sub-basin but the isolated ones, rivers included, in the mask colour. */
export const SUBBASIN_HIDE_LAYER_ID = "subbasins-hidden";

export function hiddenSubbasinsFilter(
  isolatedIds: string[] | null,
): FilterSpecification {
  return isolatedIds
    ? ["!", ["in", ["get", "id"], ["literal", isolatedIds]]]
    : ["boolean", false];
}

const selectedSubbasin = (sel: Selection | null) =>
  sel?.kind === "subbasin" ? sel.id : "";

/** Only the selected sub-basin is tinted; the others show by their borders. */
export function subbasinFillOpacity(
  mode: ViewMode,
  sel: Selection | null,
): ExpressionSpecification | number {
  if (mode === "basin") return 0;
  return ["case", ["==", ["get", "id"], selectedSubbasin(sel)], 0.12, 0];
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
    isolatedIds ? ["in", ["get", "id"], ["literal", isolatedIds]] : true,
  ];
}

/** The basin outline steps aside while sub-basins are isolated. */
export const basinOutlineOpacity = (isolatedIds: string[] | null) =>
  isolatedIds ? 0 : 1;

export function subbasinLineOpacity(mode: ViewMode): number {
  return mode === "basin" ? 0 : 0.9;
}

export function subbasinLineWidth(
  sel: Selection | null,
): ExpressionSpecification {
  return ["case", ["==", ["get", "id"], selectedSubbasin(sel)], 3, 1.5];
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
export const REACH_LAYER_IDS = FLOW_CLASSES.map(reachLayerId);
export const OUTLINE_LAYER_ID = "basin-outline";
export const LAKE_LAYER_ID = "lake-outline";
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

export function reachFilter(
  c: FlowClass,
  hideEndorheic: boolean,
): FilterSpecification {
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
    filter: lakeFilter(o.hideEndorheic),
    paint: {
      "line-color": lake,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 1.2],
    },
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
      "line-width": subbasinLineWidth(o.selection),
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
      filter: reachFilter(c, o.hideEndorheic),
      layout: { "line-cap": dash ? "butt" : "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": reachWidth(widthScale),
        ...(dash ? { "line-dasharray": dash } : {}),
      },
    });
  }
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
    },
    layers,
  };
}
