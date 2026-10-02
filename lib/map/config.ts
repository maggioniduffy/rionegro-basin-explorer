import config from "@/pipeline/map.config.json";

/** Shared with the pipeline (pipeline/map.config.json); see its $comment. */
export const mapConfig = config;

type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number };
export const toLngLatBounds = (
  b: Bbox,
): [[number, number], [number, number]] => [
  [b.xmin, b.ymin],
  [b.xmax, b.ymax],
];

/** Visible Land levels: one per buffer width, plus the whole basin. */
export const MASK_LEVEL_COUNT = config.mask.baseHalfWidthKm.length + 1;

/** Tiles written by pipeline:tiles into /public/tiles. */
export const TILE_PATHS = {
  rivers: "/tiles/rivers.pmtiles",
  mask: "/tiles/mask.pmtiles",
  subbasins: "/tiles/subbasins.pmtiles",
  ign: "/tiles/ign.pmtiles",
  localities: "/tiles/localities.pmtiles",
} as const;

/** EOX Sentinel-2 tiles are ~10 m imagery; above this MapLibre overzooms. */
export const IMAGERY_MAXZOOM = 15;
/** HydroRIVERS is 15 arc-second data; closer than this the lines drift off the imagery. */
export const MAP_MAXZOOM = 13;
