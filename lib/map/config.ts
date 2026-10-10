import nqnMap from "@/regions/nqn/map.config.json";
import { DEFAULT_REGION, type RegionId } from "@/regions";

/** Each region's regions/<id>/map.config.json, shared with the pipeline; see its $comment. */
const MAP_CONFIGS: Record<RegionId, typeof nqnMap> = { nqn: nqnMap };

export const mapConfigFor = (region: RegionId) => MAP_CONFIGS[region];

/** Ids of every region with a map config (for tests). */
export const MAP_CONFIG_REGIONS = Object.keys(MAP_CONFIGS) as RegionId[];

type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number };
export const toLngLatBounds = (
  b: Bbox,
): [[number, number], [number, number]] => [
  [b.xmin, b.ymin],
  [b.xmax, b.ymax],
];

/**
 * Visible Land levels: one per buffer width, plus the whole basin. The slider and the mask
 * layers are built once for every region, so every region has the same number of levels
 * (widths may differ; tests/tile-paths.test.ts checks the count).
 */
export const MASK_LEVEL_COUNT =
  MAP_CONFIGS[DEFAULT_REGION].mask.baseHalfWidthKm.length + 1;

/**
 * Content hash of each region's public/tiles/<region>/, set at build time (next.config.ts).
 * The versioned path is rewritten to the file and cached for good, so a tile rebuild
 * changes the URL.
 */
const TILES_VERSIONS = parseTilesVersions(
  process.env.NEXT_PUBLIC_TILES_VERSIONS,
);

export function parseTilesVersions(
  raw: string | undefined,
): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** Tiles written by pipeline:tiles into /public/tiles/<region>/. */
export function tilePaths(region: RegionId, versions = TILES_VERSIONS) {
  const base = `/tiles/${region}/${versions[region] ?? "dev"}`;
  return {
    rivers: `${base}/rivers.pmtiles`,
    mask: `${base}/mask.pmtiles`,
    subbasins: `${base}/subbasins.pmtiles`,
    ign: `${base}/ign.pmtiles`,
    localities: `${base}/localities.pmtiles`,
  } as const;
}

/** EOX Sentinel-2 tiles are ~10 m imagery; above this MapLibre overzooms. */
export const IMAGERY_MAXZOOM = 15;
/** HydroRIVERS is 15 arc-second data; closer than this the lines drift off the imagery. */
export const MAP_MAXZOOM = 13;
