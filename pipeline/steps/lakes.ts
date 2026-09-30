/**
 * pipeline:lakes — HydroLAKES polygons in the basin, and river lines clipped out of them.
 *
 * HydroRIVERS draws flow paths across lakes. On the map those lines are removed inside
 * every lake, except in the reservoirs approved in pipeline/lakes.json, which keep the
 * line of their main river (e.g. the Limay through El Chocón). Everything else inside
 * a lake, tributary lines included, is cut away. Reach data (lengths etc.) is not
 * changed: this only affects the geometry drawn on the map.
 *
 * - Lakes: HydroLAKES polygons that intersect the basin, clipped to it.
 * - A lake's main river is the named river (pipeline:named) of the reach with the
 *   largest UPLAND_SKM that intersects it, i.e. the lake's outflow path. Lakes with
 *   Lake_type 2 (reservoir) or 3 (controlled lake) and a named main river are listed
 *   in candidates.json for review; approved ones go into pipeline/lakes.json.
 *
 * Outputs in data/work/lakes/:
 *   lakes.parquet, lakes.geojson  clipped lake polygons (mask hole, outline tiles)
 *   reach_geom.parquet            HYRIV_ID → clipped geometry for reaches that touch a
 *                                 lake (empty geometry = drawn nowhere)
 *   candidates.json, report.json
 *   hydrolakes_bbox.parquet       cache of the global file's basin-bbox subset (delete
 *                                 it if the basin changes)
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { envelope, lengthSpheroidKm } from "../lib/geo";
import { INPUTS, requireInput } from "../lib/inputs";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface KeepEntry {
  hylakId: number;
  name: string;
  river: string;
  evidence?: string;
}

/** Clipped pieces shorter than this (metres) are dropped as shoreline slivers. */
const MIN_PIECE_M = 50;

/** Trunk lines inside an approved reservoir may differ from the original by this much. */
const KEEP_TOLERANCE_PCT = 0.5;

async function main() {
  const lakesShp = lit(requireInput(INPUTS.hydroLakes));
  const basinFile = lit(requireInput(workPath("basin/basin.geojson")));
  const hybasFile = lit(requireInput(workPath("basin/hybas_l12.parquet")));
  const reachesFile = lit(requireInput(workPath("rivers/reaches.parquet")));
  const mappingFile = lit(
    requireInput(workPath("named/river_reaches.parquet")),
  );
  const keepFile = `${ROOT}/pipeline/lakes.json`;
  const keep: KeepEntry[] = existsSync(keepFile)
    ? (
        JSON.parse(await readFile(keepFile, "utf8")) as {
          keepMainStem: KeepEntry[];
        }
      ).keepMainStem
    : [];
  const outDir = workPath("lakes");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    await db.conn.run(
      `CREATE TABLE basin AS SELECT geom FROM ST_Read(${basinFile})`,
    );
    const [bb] = await db.all(`
      SELECT ST_XMin(geom) AS x0, ST_YMin(geom) AS y0, ST_XMax(geom) AS x1, ST_YMax(geom) AS y1
      FROM basin`);
    // The global file has ~1.4M polygons and this DuckDB's ST_Read has no spatial
    // filter, so the first run scans it once and caches the basin bbox subset.
    const cache = `${outDir}/hydrolakes_bbox.parquet`;
    if (!existsSync(cache)) {
      console.log("scanning global HydroLAKES once (cached afterwards)…");
      await db.conn.run(`
        COPY (SELECT Hylak_id, Lake_name, Lake_type, Grand_id, Lake_area, geom
              FROM ST_Read(${lakesShp})
              WHERE ST_Intersects(geom, ${envelope({
                xmin: Number(bb?.x0),
                ymin: Number(bb?.y0),
                xmax: Number(bb?.x1),
                ymax: Number(bb?.y1),
              })}))
        TO ${lit(cache)} (FORMAT parquet)`);
    }
    await db.conn.run(`
      CREATE TABLE lakes AS
      SELECT l.Hylak_id AS hylak_id, NULLIF(trim(l.Lake_name), '') AS name,
             l.Lake_type AS type, l.Grand_id AS grand_id, l.Lake_area AS area_km2,
             ST_Intersection(ST_MakeValid(l.geom), b.geom) AS geom
      FROM read_parquet(${lit(cache)}) l, basin b
      WHERE ST_Intersects(l.geom, b.geom)`);
    // network: connected if the lake lies in the part of the basin with surface flow to
    // the outlet (HydroBASINS ENDO = 0, as pipeline:basin); the map's endorheic filter
    // hides the others' outlines.
    await db.conn.run(`
      CREATE TABLE connected AS
      SELECT ST_Union_Agg(ST_MakeValid(geom)) AS geom
      FROM read_parquet(${hybasFile}) WHERE ENDO = 0`);
    await db.conn.run(`
      ALTER TABLE lakes ADD COLUMN network VARCHAR;
      UPDATE lakes SET network = CASE
        WHEN ST_Intersects(ST_PointOnSurface(geom), (SELECT geom FROM connected))
        THEN 'connected' ELSE 'endorheic' END`);

    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT r.HYRIV_ID, r.UPLAND_SKM, m.river, r.geom
      FROM read_parquet(${reachesFile}) r
      LEFT JOIN read_parquet(${mappingFile}) m USING (HYRIV_ID)`);
    await db.conn.run(`
      CREATE TABLE hits AS
      SELECT l.hylak_id, r.HYRIV_ID, r.river, r.UPLAND_SKM,
             ${lengthSpheroidKm("ST_Intersection(r.geom, l.geom)")} AS km_inside
      FROM lakes l JOIN reaches r ON ST_Intersects(l.geom, r.geom)`);
    // Main river: the named river of the lake's largest-upland (outflow) reach.
    await db.conn.run(`
      CREATE TABLE trunk AS
      SELECT hylak_id, arg_max(river, UPLAND_SKM) AS river,
             arg_max(HYRIV_ID, UPLAND_SKM) AS outflow_reach
      FROM hits GROUP BY hylak_id`);

    // Approved reservoirs must exist and name the river the data finds.
    await db.conn.run(
      `CREATE TABLE keep (hylak_id BIGINT, name VARCHAR, river VARCHAR)`,
    );
    for (const k of keep)
      await db.conn.run(
        `INSERT INTO keep VALUES (${k.hylakId}, ${lit(k.name)}, ${lit(k.river)})`,
      );
    const keepMismatches = await db.all(`
      SELECT k.hylak_id, k.name, k.river AS approved, t.river AS found
      FROM keep k LEFT JOIN trunk t USING (hylak_id)
      WHERE t.river IS DISTINCT FROM k.river`);

    // For each reach: cut out every lake it crosses, except approved reservoirs whose
    // main river is this reach's river.
    await db.conn.run(`
      CREATE TABLE cut AS
      SELECT h.HYRIV_ID, ST_Union_Agg(l.geom) AS geom
      FROM hits h JOIN lakes l USING (hylak_id)
      LEFT JOIN keep k USING (hylak_id)
      WHERE NOT (k.hylak_id IS NOT NULL AND h.river IS NOT DISTINCT FROM k.river)
      GROUP BY h.HYRIV_ID`);
    await db.conn.run(`
      CREATE TABLE clipped AS
      SELECT r.HYRIV_ID, ST_Difference(r.geom, c.geom) AS geom,
             ${lengthSpheroidKm("r.geom")} AS km_before
      FROM reaches r JOIN cut c USING (HYRIV_ID)`);
    // Drop slivers left where a line grazes a shore: pieces under MIN_PIECE_M are
    // artifacts at 15 arc-second resolution, not river.
    await db.conn.run(`
      CREATE TABLE pieces AS
      SELECT HYRIV_ID, unnest(ST_Dump(geom)).geom AS g FROM clipped`);
    await db.conn.run(`
      CREATE TABLE reach_geom AS
      SELECT c.HYRIV_ID, c.km_before,
             coalesce((SELECT ST_Collect(list(p.g)) FROM pieces p
                       WHERE p.HYRIV_ID = c.HYRIV_ID
                         AND ${lengthSpheroidKm("p.g")} * 1000 >= ${MIN_PIECE_M}),
                      ST_GeomFromText('LINESTRING EMPTY')) AS geom
      FROM clipped c`);
    const [slivers] = await db.all(`
      SELECT count(*)::INT AS pieces, round(sum(${lengthSpheroidKm("g")}) * 1000)::INT AS metres
      FROM pieces WHERE ${lengthSpheroidKm("g")} * 1000 < ${MIN_PIECE_M}`);
    await db.conn.run(`
      ALTER TABLE reach_geom ADD COLUMN km_after DOUBLE;
      UPDATE reach_geom SET km_after = CASE WHEN ST_IsEmpty(geom) THEN 0
                                            ELSE ${lengthSpheroidKm("geom")} END`);

    // Checks.
    const [intact] = await db.all(`
      SELECT count(*)::INT AS lakes,
             coalesce(max(100 * abs(kept - orig) / nullif(orig, 0)), 0) AS worst_pct
      FROM (
        SELECT k.hylak_id,
               sum(h.km_inside) AS orig,
               sum(${lengthSpheroidKm("ST_Intersection(coalesce(g.geom, r.geom), l.geom)")}) AS kept
        FROM keep k
        JOIN lakes l USING (hylak_id)
        JOIN hits h ON h.hylak_id = k.hylak_id AND h.river = k.river
        JOIN reaches r USING (HYRIV_ID)
        LEFT JOIN reach_geom g USING (HYRIV_ID)
        GROUP BY k.hylak_id)`);
    const [counts] = await db.all(`
      SELECT (SELECT count(*) FROM lakes)::INT AS lakes,
             (SELECT count(*) FROM lakes WHERE type = 2)::INT AS reservoirs,
             (SELECT count(*) FROM lakes WHERE type = 3)::INT AS controlled,
             (SELECT count(*) FROM lakes WHERE network = 'endorheic')::INT AS endorheic,
             (SELECT round(sum(area_km2), 1) FROM lakes) AS area_km2_hydrolakes,
             (SELECT count(DISTINCT hylak_id) FROM hits)::INT AS lakes_with_lines,
             (SELECT count(*) FROM reach_geom)::INT AS reaches_clipped,
             (SELECT count(*) FROM reach_geom WHERE km_after = 0)::INT AS reaches_removed,
             (SELECT round(sum(km_before - km_after), 1) FROM reach_geom) AS km_removed,
             (SELECT count(*) FROM lakes WHERE NOT ST_IsValid(geom))::INT AS invalid`);
    const candidates = await db.all(`
      SELECT l.hylak_id AS hylakId, l.name, l.type, l.grand_id AS grandId,
             round(l.area_km2, 1) AS areaKm2, t.river, t.outflow_reach AS outflowReach,
             round(sum(h.km_inside) FILTER (WHERE h.river = t.river), 1) AS riverKmInside,
             (k.hylak_id IS NOT NULL) AS approved
      FROM lakes l JOIN trunk t USING (hylak_id) JOIN hits h USING (hylak_id)
      LEFT JOIN keep k USING (hylak_id)
      WHERE l.type IN (2, 3) AND t.river IS NOT NULL
      GROUP BY ALL ORDER BY areaKm2 DESC`);
    const byLake = await db.all(`
      SELECT l.hylak_id AS hylakId, l.name, l.type, round(l.area_km2, 1) AS areaKm2,
             t.river AS mainRiver, (k.hylak_id IS NOT NULL) AS keepsMainRiver,
             round(sum(h.km_inside), 1) AS lineKmInside
      FROM lakes l JOIN trunk t USING (hylak_id) JOIN hits h USING (hylak_id)
      LEFT JOIN keep k USING (hylak_id)
      GROUP BY ALL ORDER BY areaKm2 DESC LIMIT 25`);

    // Outputs.
    const lakesParquet = `${outDir}/lakes.parquet`;
    const lakesGeojson = `${outDir}/lakes.geojson`;
    const reachGeom = `${outDir}/reach_geom.parquet`;
    await db.conn.run(`
      COPY (SELECT l.*, (k.hylak_id IS NOT NULL) AS keeps_main_river
            FROM lakes l LEFT JOIN keep k USING (hylak_id) ORDER BY hylak_id)
      TO ${lit(lakesParquet)} (FORMAT parquet)`);
    await rm(lakesGeojson, { force: true });
    await db.conn.run(`
      COPY (SELECT hylak_id AS id, name, type, network, geom FROM lakes ORDER BY hylak_id)
      TO ${lit(lakesGeojson)} WITH (FORMAT gdal, DRIVER 'GeoJSON',
                                    LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);
    await db.conn.run(`
      COPY (SELECT HYRIV_ID, geom, km_before, km_after FROM reach_geom ORDER BY HYRIV_ID)
      TO ${lit(reachGeom)} (FORMAT parquet)`);
    const candidatesFile = `${outDir}/candidates.json`;
    await writeFile(
      candidatesFile,
      JSON.stringify(
        {
          $comment:
            "Reservoirs (Lake_type 2) and controlled lakes (3) with a named main river. Approve the ones whose main river line should stay drawn by copying them into pipeline/lakes.json (keepMainStem: hylakId, name, river, evidence).",
          candidates,
        },
        null,
        2,
      ) + "\n",
    );

    const checks = {
      noInvalidLakes: counts?.invalid === 0,
      approvedLakesMatchData: keepMismatches.length === 0,
      mainRiverIntactInApprovedLakes:
        Number(intact?.worst_pct ?? 0) <= KEEP_TOLERANCE_PCT,
    };
    await writeReport("lakes", {
      ok: Object.values(checks).every(Boolean),
      checks,
      counts,
      approved: keep.length,
      slivers: { ...slivers, minPieceM: MIN_PIECE_M },
      keepMismatches,
      mainRiverIntact: intact,
      largestLakes: byLake,
      candidates: candidates.length,
      outputs: [lakesParquet, lakesGeojson, reachGeom, candidatesFile].map(rel),
    });
    if (!Object.values(checks).every(Boolean))
      throw new Error(`lakes checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
