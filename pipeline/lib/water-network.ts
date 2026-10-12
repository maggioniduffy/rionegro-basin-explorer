/**
 * The `network` flag ("connected" | "endorheic") of lakes, dams and dam walls in a region in
 * reference mode (R3.6). The map hides endorheic features with it, so it has to agree with the
 * flag of the reaches (pipeline:rivers, R3.2), which HydroBASINS' ENDO field does not do for
 * Córdoba (it marks 2,015 of 2,300 level-12 polygons as endorheic, most of them holding
 * reaches flagged connected).
 *
 * Rule: a point takes the flag of the HydroBASINS level-12 polygon that holds it: "connected"
 * when at least half of the length of the HydroRIVERS reaches of that polygon is flagged
 * connected. A polygon with no reaches uses HydroBASINS' own rule (ENDO = 0 is connected, as
 * pipeline:lakes does for nqn). A point in no polygon is "endorheic" and counted.
 */
import { type Db, lit } from "./duckdb";

export interface NetworkStats {
  polygons: number;
  fromReaches: number;
  fromEndoField: number;
}

/** Create the table `hybnet (hybas_id, network, geom)` from the region's level-12 polygons. */
export async function createHybasNetwork(
  db: Db,
  hybasFile: string,
  reachesFile: string,
): Promise<NetworkStats> {
  await db.conn.run(`
    CREATE OR REPLACE TABLE hybnet AS
    SELECT h.HYBAS_ID AS hybas_id,
           CASE WHEN r.km IS NULL THEN CASE WHEN h.ENDO = 0 THEN 'connected' ELSE 'endorheic' END
                WHEN 2 * r.connected_km >= r.km THEN 'connected' ELSE 'endorheic' END AS network,
           r.km IS NULL AS from_endo_field,
           ST_MakeValid(h.geom) AS geom
    FROM read_parquet(${lit(hybasFile)}) h
    LEFT JOIN (
      SELECT HYBAS_L12, sum(LENGTH_KM) AS km,
             coalesce(sum(LENGTH_KM) FILTER (network = 'connected'), 0) AS connected_km
      FROM read_parquet(${lit(reachesFile)}) GROUP BY HYBAS_L12) r
      ON r.HYBAS_L12 = h.HYBAS_ID`);
  const [s] = await db.all(`
    SELECT count(*)::INT AS polygons,
           count(*) FILTER (NOT from_endo_field)::INT AS from_reaches,
           count(*) FILTER (from_endo_field)::INT AS from_endo
    FROM hybnet`);
  return {
    polygons: Number(s?.polygons),
    fromReaches: Number(s?.from_reaches),
    fromEndoField: Number(s?.from_endo),
  };
}

/**
 * Create the table `<out> (id, network)` with the flag of each row of `table` (columns `id`
 * and the point expression `pointGeom`, e.g. "ST_PointOnSurface(geom)"). When a point lies
 * on the border of two polygons the lowest HYBAS_ID decides. Needs `hybnet`. Returns the
 * number of points that lie in no polygon.
 */
export async function assignNetwork(
  db: Db,
  table: string,
  pointGeom: string,
  out: string,
): Promise<number> {
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${out} AS
    SELECT t.id, coalesce(arg_min(n.network, n.hybas_id), 'endorheic') AS network,
           count(n.hybas_id) = 0 AS outside
    FROM (SELECT id, ${pointGeom} AS pt FROM ${table}) t
    LEFT JOIN hybnet n ON ST_Intersects(n.geom, t.pt)
    GROUP BY t.id`);
  const [o] = await db.all(
    `SELECT count(*) FILTER (outside)::INT AS n FROM ${out}`,
  );
  return Number(o?.n);
}
