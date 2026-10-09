/**
 * HydroLAKES v1.0 polygons in the basin bounding box, cached once from the global shapefile.
 * Shared by pipeline:named (lakes the river trace may cross) and pipeline:lakes, so either
 * can run first.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { type Db, lit } from "./duckdb";
import { envelope } from "./geo";
import { INPUTS, requireInput } from "./inputs";
import { workPath } from "./paths";

/** The cache: Hylak_id, Lake_name, Lake_type, Grand_id, Lake_area, geom. */
export const HYDROLAKES_BBOX = workPath("lakes/hydrolakes_bbox.parquet");

/**
 * Path of the cache, written on first use. The global file has ~1.4M polygons and this
 * DuckDB's ST_Read has no spatial filter, so it is scanned once; delete the cache if the
 * basin changes.
 */
export async function hydroLakesBbox(db: Db): Promise<string> {
  if (existsSync(HYDROLAKES_BBOX)) return HYDROLAKES_BBOX;
  const shp = lit(requireInput(INPUTS.hydroLakes));
  const basin = lit(requireInput(workPath("basin/basin.geojson")));
  const [bb] = await db.all(`
    SELECT ST_XMin(geom) AS x0, ST_YMin(geom) AS y0, ST_XMax(geom) AS x1, ST_YMax(geom) AS y1
    FROM ST_Read(${basin})`);
  await mkdir(dirname(HYDROLAKES_BBOX), { recursive: true });
  console.log("scanning global HydroLAKES once (cached afterwards)…");
  await db.conn.run(`
    COPY (SELECT Hylak_id, Lake_name, Lake_type, Grand_id, Lake_area, geom
          FROM ST_Read(${shp})
          WHERE ST_Intersects(geom, ${envelope({
            xmin: Number(bb?.x0),
            ymin: Number(bb?.y0),
            xmax: Number(bb?.x1),
            ymax: Number(bb?.y1),
          })}))
    TO ${lit(HYDROLAKES_BBOX)} (FORMAT parquet)`);
  return HYDROLAKES_BBOX;
}
