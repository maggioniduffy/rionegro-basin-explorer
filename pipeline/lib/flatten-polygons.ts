/**
 * Polygon-only geometries for tippecanoe (R3.8). GDAL's GeoJSON writer can turn a
 * MultiPolygon into a GeometryCollection nested in another, which tippecanoe rejects
 * outright ("feature without coordinates array"): the feature, here a whole Visible Land
 * level, goes missing from the tiles. Pure, so it is unit-tested without GDAL.
 */

export interface Geometry {
  type: string;
  coordinates?: unknown;
  geometries?: Geometry[];
}

/** The polygons of `g`, at any collection depth; lines and points are dropped. */
function polygonsOf(g: Geometry | null | undefined): unknown[] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates as unknown[];
  if (g.type === "GeometryCollection")
    return (g.geometries ?? []).flatMap(polygonsOf);
  return [];
}

/**
 * `g` unchanged when it is already a Polygon or MultiPolygon, else one MultiPolygon with
 * every polygon it holds (null when it holds none).
 */
export function flattenPolygons(g: Geometry | null): Geometry | null {
  if (!g || g.type === "Polygon" || g.type === "MultiPolygon") return g;
  const polygons = polygonsOf(g);
  return polygons.length === 0
    ? null
    : { type: "MultiPolygon", coordinates: polygons };
}
