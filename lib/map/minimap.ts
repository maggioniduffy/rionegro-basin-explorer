import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { TILE_PATHS } from "./config";
import { FLOW_STYLE, THEME_COLORS, type Theme } from "./style";

export const MINIMAP_VIEW_SOURCE = "view";
export const MINIMAP_VIEW_FILL_LAYER_ID = "view-fill";
export const MINIMAP_VIEW_LINE_LAYER_ID = "view-outline";
export const MINIMAP_BACKGROUND_LAYER_ID = "background";
export const MINIMAP_OUTLINE_LAYER_ID = "basin-outline";
/** The current-view box; amber, like the selection halo, on both themes. */
export const MINIMAP_VIEW_COLOR = "#fde68a";
/** Rivers of this Strahler order and up: the main stems, present in every tile zoom. */
export const MINIMAP_MIN_STRAHLER = 5;
/** Padding around the basin in the overview, px. */
export const MINIMAP_PADDING = 8;
/** Zoomed in, the minimap follows so the view box spans at least this share of it. */
export const MINIMAP_VIEW_MIN_SHARE = 0.25;
/** Zoomed out, the minimap backs off so the view box spans at most this share of it. */
export const MINIMAP_VIEW_MAX_SHARE = 0.9;

type Bounds = [number, number, number, number];

/** MapLibre's world is 512 px wide at zoom 0. */
const WORLD_PX = 512;
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) =>
  (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;

/** a clamped into [lo, hi]; when lo > hi (the window is wider than the room), into [hi, lo]. */
function clampWindow(a: number, lo: number, hi: number): number {
  return lo <= hi
    ? Math.min(Math.max(a, lo), hi)
    : Math.min(Math.max(a, hi), lo);
}

/**
 * The minimap's camera for a main-map view. It shows the whole basin while the view box
 * fits there at a readable size. Zoomed in closer, it follows the view so the box keeps
 * MINIMAP_VIEW_MIN_SHARE of the minimap; zoomed out past the basin, it backs off so the
 * box stays inside. It centres on the view but stays inside the basin's bbox when it
 * can, so moving between the two is continuous.
 */
export function minimapCamera(o: {
  view: Bounds;
  basin: Bounds;
  /** Minimap size in px. */
  size: [number, number];
}): { center: [number, number]; zoom: number } {
  const [width, height] = o.size;
  const box = (b: Bounds) => ({
    x0: mercX(b[0]),
    x1: mercX(b[2]),
    // Mercator y grows southwards.
    y0: mercY(b[3]),
    y1: mercY(b[1]),
  });
  const v = box(o.view);
  const b = box(o.basin);
  // Zoom at which a box spans `share` of the minimap in its tighter dimension.
  const zoomFor = (r: typeof v, share: number, pad = 0) =>
    Math.log2(
      Math.min(
        (share * width - 2 * pad) / ((r.x1 - r.x0) * WORLD_PX),
        (share * height - 2 * pad) / ((r.y1 - r.y0) * WORLD_PX),
      ),
    );
  const fit = zoomFor(b, 1, MINIMAP_PADDING);
  const zoom = Math.max(
    zoomFor(v, MINIMAP_VIEW_MIN_SHARE),
    Math.min(fit, zoomFor(v, MINIMAP_VIEW_MAX_SHARE)),
  );

  const scale = WORLD_PX * 2 ** zoom;
  const hw = width / 2 / scale;
  const hh = height / 2 / scale;
  // Prefer the view's centre, kept inside the basin's bbox (padding included) …
  const pw = MINIMAP_PADDING / scale;
  let cx = clampWindow((v.x0 + v.x1) / 2, b.x0 - pw + hw, b.x1 + pw - hw);
  let cy = clampWindow((v.y0 + v.y1) / 2, b.y0 - pw + hh, b.y1 + pw - hh);
  // … but the view box always stays in sight.
  cx = clampWindow(cx, v.x1 - hw, v.x0 + hw);
  cy = clampWindow(cy, v.y1 - hh, v.y0 + hh);
  return { center: [lngOf(cx), latOf(cy)], zoom };
}

/** [west, south, east, north] → a closed ring for the view box source. */
export function viewPolygon(
  bounds: [number, number, number, number] | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!bounds) return { type: "FeatureCollection", features: [] };
  const [w, s, e, n] = bounds;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      },
    ],
  };
}

/**
 * The minimap: basin outline and main rivers from the rivers tiles, on the mask colour.
 * No imagery, so it adds no requests to the imagery provider.
 */
export function buildMinimapStyle(o: {
  origin: string;
  theme: Theme;
}): StyleSpecification {
  const { mask, outline } = THEME_COLORS[o.theme];
  return {
    version: 8,
    sources: {
      rivers: {
        type: "vector",
        url: `pmtiles://${o.origin}${TILE_PATHS.rivers}`,
      },
      [MINIMAP_VIEW_SOURCE]: { type: "geojson", data: viewPolygon(null) },
    },
    layers: [
      {
        id: MINIMAP_BACKGROUND_LAYER_ID,
        type: "background",
        paint: { "background-color": mask },
      },
      {
        id: MINIMAP_OUTLINE_LAYER_ID,
        type: "line",
        source: "rivers",
        "source-layer": "basin",
        paint: { "line-color": outline, "line-width": 1 },
      },
      {
        id: "rivers",
        type: "line",
        source: "rivers",
        "source-layer": "reaches",
        // Followed in closer, the smaller orders the tiles carry there join in
        // (reachMinzoomByStrahler, one zoom later so the overview stays clean).
        filter: [
          "step",
          ["zoom"],
          [">=", ["get", "strahler"], MINIMAP_MIN_STRAHLER],
          7,
          [">=", ["get", "strahler"], 4],
          8,
          [">=", ["get", "strahler"], 3],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": FLOW_STYLE.perennial.color,
          "line-width": [
            "interpolate",
            ["linear"],
            ["get", "strahler"],
            MINIMAP_MIN_STRAHLER,
            0.6,
            7,
            1.6,
          ],
        },
      },
      {
        id: MINIMAP_VIEW_FILL_LAYER_ID,
        type: "fill",
        source: MINIMAP_VIEW_SOURCE,
        paint: { "fill-color": MINIMAP_VIEW_COLOR, "fill-opacity": 0.15 },
      },
      {
        id: MINIMAP_VIEW_LINE_LAYER_ID,
        type: "line",
        source: MINIMAP_VIEW_SOURCE,
        paint: { "line-color": MINIMAP_VIEW_COLOR, "line-width": 1.5 },
      },
    ],
  };
}
