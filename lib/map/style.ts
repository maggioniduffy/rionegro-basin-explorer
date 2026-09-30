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

export const THEME_COLORS: Record<Theme, { mask: string; outline: string }> = {
  dark: { mask: "#050607", outline: "rgba(230, 232, 234, 0.55)" },
  light: { mask: "#f3f2ee", outline: "rgba(31, 35, 40, 0.55)" },
};

export const maskLayerId = (level: number) => `mask-${level}`;
export const reachLayerId = (c: FlowClass) => `reaches-${c}`;
export const MASK_LAYER_IDS = Array.from({ length: MASK_LEVEL_COUNT }, (_, k) =>
  maskLayerId(k),
);
export const REACH_LAYER_IDS = FLOW_CLASSES.map(reachLayerId);
export const OUTLINE_LAYER_ID = "basin-outline";
export const IMAGERY_LAYER_ID = "imagery";
export const BACKGROUND_LAYER_ID = "background";

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

/** Line width in px, by Strahler order (1–7) and zoom. */
function reachWidth(scale: number): ExpressionSpecification {
  const s: ExpressionSpecification = ["get", "strahler"];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    ["*", 0.35 * scale, s],
    10,
    ["*", scale, ["+", 0.4, ["*", 0.8, s]]],
    14,
    ["*", scale, ["+", 1, ["*", 1.4, s]]],
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
}

export function buildStyle(o: StyleOptions): StyleSpecification {
  const { mask, outline } = THEME_COLORS[o.theme];
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
      paint: { "raster-opacity": 0 },
    });
  }
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
  layers.push({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: "rivers",
    "source-layer": "basin",
    paint: { "line-color": outline, "line-width": 1 },
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
    },
    layers,
  };
}
