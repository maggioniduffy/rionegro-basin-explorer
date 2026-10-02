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
        filter: [">=", ["get", "strahler"], MINIMAP_MIN_STRAHLER],
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
