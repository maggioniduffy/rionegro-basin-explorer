/**
 * Shared by the IGN steps (pipeline:ign-gate, pipeline:ign, pipeline:ign-match): where the
 * IGN watercourse lines live, and the Albers candidate-pair prefilter.
 */
import { type Db, lit } from "./duckdb";
import { cleanName, nameKey } from "./names";
import { rawPath } from "./paths";

/** South America Albers Equal Area Conic: distances in metres, approximate to a few percent. */
export const ALBERS = "ESRI:102033";

/**
 * IGN "Corriente de agua" line layers, Shapefile in WGS84 with ISO-8859-1 text
 * (open_options=['ENCODING=ISO-8859-1']). Columns: gid, entidad, objeto, fna (full name),
 * gna (generic type), nam (short name), sag, fdc (confirmed 2026-10-01, pipeline/SOURCES.md).
 */
export const IGN_LINE_LAYERS = [
  {
    cls: "perennial",
    shp: rawPath(
      "ign/lineas_de_aguas_continentales_perenne/lineas_de_aguas_continentales_perenneLine.shp",
    ),
    required: true,
  },
  {
    cls: "intermittent",
    shp: rawPath(
      "ign/lineas_de_aguas_continentales_intermitente/lineas_de_aguas_continentales_intermitentes.shp",
    ),
    required: false,
  },
] as const;

export const IGN_ST_READ_OPTIONS = "open_options=['ENCODING=ISO-8859-1']";

/** Grid cell size (m) for the candidate-pair prefilter; any value >= the largest buffer works. */
const CELL_M = 5000;

/**
 * Candidate (IGN line, reach) pairs closer than `maxD` metres, into the table `pairs`
 * (iid, rid, dist). Needs the tables `ign_a (id, geom_a)` and `reaches_a (HYRIV_ID,
 * geom_a)` in Albers. A grid prefilter (bbox cells expanded by `maxD`) keeps this from
 * being a full cross join of IGN lines and reaches; `dist` is the exact planar distance.
 */
export async function buildPairs(db: Db, maxD: number) {
  for (const [name, table, key] of [
    ["ign", "ign_a", "id"],
    ["reach", "reaches_a", "HYRIV_ID"],
  ] as const) {
    const cell = (v: string) => `CAST(floor((${v}) / ${CELL_M}) AS BIGINT)`;
    await db.conn.run(`
      CREATE TABLE ${name}_cx AS
      SELECT ${key} AS k, ${cell(`ST_YMin(geom_a) - ${maxD}`)} AS y0,
             ${cell(`ST_YMax(geom_a) + ${maxD}`)} AS y1,
             unnest(range(${cell(`ST_XMin(geom_a) - ${maxD}`)},
                          ${cell(`ST_XMax(geom_a) + ${maxD}`)} + 1)) AS cx
      FROM ${table}`);
    await db.conn.run(`
      CREATE TABLE ${name}_cells AS
      SELECT k, cx, unnest(range(y0, y1 + 1)) AS cy FROM ${name}_cx`);
    await db.conn.run(`DROP TABLE ${name}_cx`);
  }
  await db.conn.run(`
    CREATE TABLE pairs AS
    SELECT c.iid, c.rid, ST_Distance(i.geom_a, r.geom_a) AS dist
    FROM (SELECT DISTINCT i.k AS iid, r.k AS rid
          FROM ign_cells i JOIN reach_cells r USING (cx, cy)) c
    JOIN ign_a i ON i.id = c.iid JOIN reaches_a r ON r.HYRIV_ID = c.rid
    WHERE ST_Distance(i.geom_a, r.geom_a) <= ${maxD}`);
  await db.conn.run(`DROP TABLE ign_cells; DROP TABLE reach_cells`);
}

/**
 * Create the table `name_map (raw, name, name_key)` for the distinct non-null `column`
 * values of `table`: names are cleaned in JS (one definition, unit-tested) and joined back
 * by raw value. Values that clean to nothing are left out.
 */
export async function createNameMap(db: Db, table: string, column: string) {
  const distinct = await db.all(
    `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL`,
  );
  await db.conn.run(
    `CREATE OR REPLACE TABLE name_map (raw VARCHAR, name VARCHAR, name_key VARCHAR)`,
  );
  for (const { v } of distinct) {
    const name = cleanName(String(v));
    if (name)
      await db.conn.run(
        `INSERT INTO name_map VALUES (${lit(String(v))}, ${lit(name)}, ${lit(nameKey(name))})`,
      );
  }
}

/** Thresholds of pipeline:ign-layers (pipeline/ign.config.json, key "water"). */
export interface WaterConfig {
  /** An IGN polygon names a HydroLAKES lake when it covers at least this share of the lake. */
  lakeNameMinOverlap: number;
  /** IGN water polygons covered less than this by HydroLAKES are added as extra lakes. */
  extraLakeMaxCoverage: number;
  /** Extra lakes (after removing what HydroLAKES covers) smaller than this are dropped. */
  minExtraLakeKm2: number;
}
