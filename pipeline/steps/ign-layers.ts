/**
 * pipeline:ign-layers — IGN lakes, dams and the detail lines, as inputs for the tiles
 * (Phase 5, after pipeline:ign-match).
 *
 * Inputs: IGN water polygons ("Embalse" BH130 and "Espejo de agua perenne"), dam points
 * (BH051 "Dique") and dam-wall lines (BI020 "Muro de embalse") in data/raw/ign/, the
 * HydroLAKES polygons from pipeline:lakes, the detail lines from pipeline:ign-match,
 * the basin and its HydroBASINS level-12 polygons (for the endorheic flag), and the
 * `water` thresholds of pipeline/ign.config.json.
 *
 * What it does:
 *  - Names: a HydroLAKES lake takes the IGN name (`fna`, e.g. "Embalse Alicurá") of the IGN
 *    polygons that cover at least `lakeNameMinOverlap` of it; the IGN name wins over
 *    HydroLAKES' own (owner decision, 2026-10-01), which is kept only where IGN has none.
 *  - Extra lakes: IGN water polygons that HydroLAKES covers less than `extraLakeMaxCoverage`,
 *    with the HydroLAKES part removed, at least `minExtraLakeKm2` each.
 *  - Detail lines: the pieces from pipeline:ign-match, with the parts inside any lake
 *    (HydroLAKES or extra) removed, as pipeline:lakes does for HydroRIVERS, and again
 *    dropping pieces shorter than `minDetailPieceM`.
 *  - Dams: BH051 points and BI020 lines inside the basin.
 *  Every feature carries `network` ("connected" | "endorheic"), by the same rule as
 *  pipeline:lakes, so the map's endorheic filter covers them. Areas are Albers, so
 *  approximate; no hydrology is attached to any of it.
 *
 * Outputs: data/work/tiles/ign_lakes.geojson (HydroLAKES, named), ign_lakes_extra.geojson,
 * ign_detail.geojson, ign_dams.geojson, ign_dam_walls.geojson; data/work/ign-layers/report.json.
 */
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { lengthSpheroidKm } from "../lib/geo";
import {
  ALBERS,
  IGN_ST_READ_OPTIONS,
  type WaterConfig,
  createNameMap,
} from "../lib/ign";
import type { MatchConfig } from "../lib/ign-match";
import { requireInput } from "../lib/inputs";
import { ROOT, rawPath, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

const SHP = {
  reservoirs: rawPath(
    "ign/areas_de_aguas_continentales_BH130/areas_de_aguas_continentales_BH130Polygon.shp",
  ),
  waterBodies: rawPath(
    "ign/areas_de_aguas_continentales_perenne/areas_de_aguas_continentales_perennePolygon.shp",
  ),
  damPoints: rawPath(
    "ign/puntos_de_aguas_continentales_BH051/puntos_de_aguas_continentales_BH051Point.shp",
  ),
  damWalls: rawPath(
    "ign/lineas_de_aguas_continentales_BI020/lineas_de_aguas_continentales_BI020Line.shp",
  ),
};
const read = (shp: string) =>
  `ST_Read(${lit(requireInput(shp))}, ${IGN_ST_READ_OPTIONS})`;

async function main() {
  const cfg = JSON.parse(
    await readFile(`${ROOT}/pipeline/ign.config.json`, "utf8"),
  ) as MatchConfig & { water: WaterConfig };
  const water = cfg.water;
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const hybasFile = requireInput(workPath("basin/hybas_l12.parquet"));
  const lakesFile = requireInput(workPath("lakes/lakes.parquet"));
  const detailFile = requireInput(workPath("ign-match/detail.parquet"));
  const tilesDir = workPath("tiles");
  const outDir = workPath("ign-layers");
  await mkdir(tilesDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='8GB'; SET threads=4; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const toAlbers = (g: string) =>
    `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
  const fromAlbers = (g: string) =>
    `ST_Transform(${g}, ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)`;

  try {
    await db.conn.run(
      `CREATE TABLE basin AS SELECT geom FROM ST_Read(${lit(basinFile)})`,
    );
    // Same endorheic rule as pipeline:lakes: connected = in HydroBASINS ENDO = 0.
    await db.conn.run(`
      CREATE TABLE connected AS
      SELECT ST_Union_Agg(ST_MakeValid(geom)) AS geom FROM read_parquet(${lit(hybasFile)})
      WHERE ENDO = 0`);
    const network = (pointGeom: string) =>
      `CASE WHEN ST_Intersects(${pointGeom}, (SELECT geom FROM connected))
            THEN 'connected' ELSE 'endorheic' END`;

    // 1. IGN water polygons inside the basin, clipped to it.
    log("water polygons…");
    await db.conn.run(`
      CREATE TABLE poly_raw AS
      SELECT * FROM (
        SELECT kind, gid, fna,
               ST_CollectionExtract(ST_Intersection(ST_MakeValid(w.geom), b.geom), 3) AS geom
        FROM (SELECT 'reservoir' AS kind, gid, NULLIF(trim(fna), '') AS fna, geom
              FROM ${read(SHP.reservoirs)}
              UNION ALL
              SELECT 'waterbody', gid, NULLIF(trim(fna), ''), geom
              FROM ${read(SHP.waterBodies)}) w, basin b
        WHERE ST_Intersects(w.geom, b.geom))
      WHERE NOT ST_IsEmpty(geom)`);
    await createNameMap(db, "poly_raw", "fna");
    await db.conn.run(`
      CREATE TABLE poly_a AS
      SELECT CAST(row_number() OVER (ORDER BY kind, gid) AS INTEGER) AS id, kind, gid,
             m.name, m.name_key, ${toAlbers("p.geom")} AS g
      FROM poly_raw p LEFT JOIN name_map m ON m.raw = p.fna`);
    await db.conn.run(`ALTER TABLE poly_a ADD COLUMN area_m2 DOUBLE`);
    await db.conn.run(`UPDATE poly_a SET area_m2 = ST_Area(g)`);
    await db.conn.run(`
      CREATE TABLE hl AS
      SELECT hylak_id, name AS hl_name, type, area_km2, network, geom,
             ${toAlbers("ST_MakeValid(geom)")} AS g
      FROM read_parquet(${lit(lakesFile)})`);
    await db.conn.run(`ALTER TABLE hl ADD COLUMN area_m2 DOUBLE`);
    await db.conn.run(`UPDATE hl SET area_m2 = ST_Area(g)`);

    // 2. Names for HydroLAKES lakes: the IGN name covering most of the lake.
    log("lake names…");
    await db.conn.run(`
      CREATE TABLE lake_name AS
      SELECT hylak_id, name, name_key, overlap FROM (
        SELECT u.hylak_id, u.name, u.name_key,
               ST_Area(ST_Intersection(h.g, u.g)) / h.area_m2 AS overlap,
               row_number() OVER (PARTITION BY u.hylak_id
                 ORDER BY ST_Area(ST_Intersection(h.g, u.g)) DESC, u.name_key) AS rn
        FROM (SELECT h.hylak_id, p.name_key, any_value(p.name) AS name,
                     ST_Union_Agg(p.g) AS g
              FROM hl h JOIN poly_a p ON p.name IS NOT NULL AND ST_Intersects(h.g, p.g)
              GROUP BY h.hylak_id, p.name_key) u
        JOIN hl h USING (hylak_id))
      WHERE rn = 1 AND overlap >= ${water.lakeNameMinOverlap}`);

    // 3. Extra lakes: IGN water that HydroLAKES barely covers, minus what it covers.
    log("extra lakes…");
    await db.conn.run(`
      CREATE TABLE extra_a AS
      SELECT id, kind, name, area_m2,
             CASE WHEN u.g IS NULL THEN p.g
                  ELSE ST_CollectionExtract(ST_Difference(p.g, u.g), 3) END AS g,
             CASE WHEN u.g IS NULL THEN 0
                  ELSE ST_Area(ST_Intersection(p.g, u.g)) / p.area_m2 END AS coverage
      FROM poly_a p
      LEFT JOIN (SELECT p2.id, ST_Union_Agg(h.g) AS g
                 FROM poly_a p2 JOIN hl h ON ST_Intersects(p2.g, h.g) GROUP BY p2.id) u
        USING (id)
      WHERE p.area_m2 > 0`);
    await db.conn.run(`
      CREATE TABLE extra AS
      SELECT CAST(row_number() OVER (ORDER BY id) AS INTEGER) AS id, kind, name,
             area_km2, geom, ${network("ST_PointOnSurface(geom)")} AS network
      FROM (
        SELECT id, kind, name, ST_Area(g) / 1e6 AS area_km2, ${fromAlbers("g")} AS geom
        FROM extra_a
        WHERE coverage < ${water.extraLakeMaxCoverage}
          AND NOT ST_IsEmpty(g) AND ST_Area(g) / 1e6 >= ${water.minExtraLakeKm2})`);

    // 4. HydroLAKES with the IGN name (or HydroLAKES' own where IGN has none).
    await db.conn.run(`
      CREATE TABLE lakes_named AS
      SELECT h.hylak_id AS id,
             coalesce(n.name, h.hl_name) AS name,
             CASE WHEN n.name IS NOT NULL THEN 'ign'
                  WHEN h.hl_name IS NOT NULL THEN 'hydrolakes' END AS name_source,
             CASE h.type WHEN 1 THEN 'lake' WHEN 2 THEN 'reservoir'
                         ELSE 'controlled-lake' END AS kind,
             round(h.area_km2, 3) AS area_km2, h.network, h.geom
      FROM hl h LEFT JOIN lake_name n USING (hylak_id)`);

    // 5. Detail lines: the match step's pieces, cut out of every lake.
    log("detail lines…");
    await db.conn.run(`
      CREATE TABLE water_u AS
      SELECT ST_Union_Agg(geom) AS g FROM (
        SELECT ST_GeomFromWKB(ST_AsWKB(geom)) AS geom FROM read_parquet(${lit(lakesFile)})
        UNION ALL SELECT ST_GeomFromWKB(ST_AsWKB(geom)) FROM extra)`);
    await db.conn.run(`
      CREATE TABLE detail_in AS
      SELECT id, line_id, name, km, ST_GeomFromWKB(ST_AsWKB(geom)) AS geom
      FROM read_parquet(${lit(detailFile)})`);
    await db.conn.run(`
      CREATE TABLE detail_pieces AS
      SELECT line_id, name, d.geom AS geom FROM (
        SELECT line_id, name,
               unnest(ST_Dump(ST_LineMerge(CASE WHEN ST_Intersects(geom, w.g)
                 THEN ST_CollectionExtract(ST_Difference(geom, w.g), 2) ELSE geom END))) AS d
        FROM detail_in, water_u w)`);
    await db.conn.run(`
      CREATE TABLE detail AS
      SELECT CAST(row_number() OVER (ORDER BY line_id, ST_AsHEXWKB(geom)) AS INTEGER) AS id,
             name, round(km, 3) AS km, geom,
             ${network("ST_LineInterpolatePoint(geom, 0.5)")} AS network
      FROM (SELECT line_id, name, geom, ${lengthSpheroidKm("geom")} AS km
            FROM detail_pieces)
      WHERE km * 1000 >= ${cfg.minDetailPieceM}`);

    // 6. Dams.
    log("dams…");
    await db.conn.run(`
      CREATE TABLE dam_pts_raw AS
      SELECT gid, NULLIF(trim(fna), '') AS fna, geom FROM ${read(SHP.damPoints)}
      WHERE ST_Intersects(geom, (SELECT geom FROM basin))`);
    await createNameMap(db, "dam_pts_raw", "fna");
    await db.conn.run(`
      CREATE TABLE dams AS
      SELECT CAST(row_number() OVER (ORDER BY gid) AS INTEGER) AS id, m.name,
             ${network("p.geom")} AS network, p.geom
      FROM dam_pts_raw p LEFT JOIN name_map m ON m.raw = p.fna`);
    await db.conn.run(`
      CREATE TABLE wall_raw AS
      SELECT gid, NULLIF(trim(fna), '') AS fna, geom FROM ${read(SHP.damWalls)}
      WHERE ST_Intersects(geom, (SELECT geom FROM basin))`);
    await createNameMap(db, "wall_raw", "fna");
    await db.conn.run(`
      CREATE TABLE walls AS
      SELECT CAST(row_number() OVER (ORDER BY gid) AS INTEGER) AS id, m.name,
             ${network("ST_LineInterpolatePoint(w.geom, 0.5)")} AS network, w.geom
      FROM wall_raw w LEFT JOIN name_map m ON m.raw = w.fna`);

    // 7. GeoJSON for tippecanoe.
    const outputs: [string, string, string][] = [
      [
        "ign_lakes",
        "id, name, name_source AS nameSource, kind, area_km2 AS areaKm2, network, geom",
        "lakes_named",
      ],
      [
        "ign_lakes_extra",
        "id, name, kind, round(area_km2, 3) AS areaKm2, network, geom",
        "extra",
      ],
      ["ign_detail", "id, name, km, network, geom", "detail"],
      ["ign_dams", "id, name, network, geom", "dams"],
      ["ign_dam_walls", "id, name, network, geom", "walls"],
    ];
    const sizes: Record<string, number> = {};
    for (const [file, cols, table] of outputs) {
      const target = `${tilesDir}/${file}.geojson`;
      await rm(target, { force: true });
      await db.conn.run(`
        COPY (SELECT ${cols} FROM ${table} ORDER BY id) TO ${lit(target)}
        WITH (FORMAT gdal, DRIVER 'GeoJSON',
              LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);
      sizes[rel(target)] = (await stat(target)).size;
    }

    // 8. Report and checks.
    const [names] = await db.all(`
      SELECT count(*) AS lakes,
             count(*) FILTER (n.name IS NOT NULL) AS ign_named,
             count(*) FILTER (n.name IS NULL AND h.hl_name IS NOT NULL) AS hydrolakes_only_named,
             count(*) FILTER (n.name IS NOT NULL AND h.hl_name IS NOT NULL) AS both_named
      FROM hl h LEFT JOIN lake_name n USING (hylak_id)`);
    const renamed = await db.all(`
      SELECT h.hylak_id, h.hl_name, n.name AS ign_name, round(n.overlap, 2) AS overlap
      FROM hl h JOIN lake_name n USING (hylak_id)
      WHERE h.hl_name IS NOT NULL ORDER BY h.hylak_id`);
    const [multi] = await db.all(`
      SELECT count(*) AS n FROM (SELECT hylak_id FROM lake_name GROUP BY 1 HAVING count(*) > 1)`);
    const extraByKind = await db.all(`
      SELECT kind, count(*) AS n, round(sum(area_km2), 2) AS km2,
             count(name) AS named, count(*) FILTER (network = 'endorheic') AS endorheic
      FROM extra GROUP BY kind ORDER BY kind`);
    const [extraTotal] = await db.all(`SELECT sum(area_km2) AS km2 FROM extra`);
    const [extraCheck] = await db.all(`
      SELECT (SELECT count(*) FROM extra WHERE NOT ST_IsValid(geom)) AS invalid,
             coalesce(sum(ST_Area(ST_Intersection(${toAlbers("e.geom")}, h.g))), 0) / 1e6 AS overlap_km2
      FROM extra e JOIN hl h ON ST_Intersects(${toAlbers("e.geom")}, h.g)`);
    const [detailCheck] = await db.all(`
      SELECT count(*) AS pieces, sum(km) AS km,
             count(*) FILTER (name IS NOT NULL) AS named_pieces,
             count(*) FILTER (network = 'endorheic') AS endorheic_pieces,
             count(*) FILTER (ST_Intersects(geom, (SELECT g FROM water_u))
               AND ST_Length(ST_Intersection(geom, (SELECT g FROM water_u))) > 1e-6) AS in_lake
      FROM detail`);
    const [detailIn] = await db.all(
      `SELECT count(*) AS pieces, sum(km) AS km FROM detail_in`,
    );
    const [dam] = await db.all(`
      SELECT (SELECT count(*) FROM dams) AS points,
             (SELECT count(*) FILTER (name IS NOT NULL) FROM dams) AS points_named,
             (SELECT count(*) FROM walls) AS walls,
             (SELECT count(*) FILTER (name IS NOT NULL) FROM walls) AS walls_named,
             (SELECT list(DISTINCT name ORDER BY name) FROM dams WHERE name IS NOT NULL) AS point_names,
             (SELECT list(DISTINCT name ORDER BY name) FROM walls WHERE name IS NOT NULL) AS wall_names`);
    const [polys] = await db.all(`
      SELECT count(*) AS n, count(*) FILTER (kind = 'reservoir') AS reservoirs,
             count(*) FILTER (kind = 'waterbody') AS water_bodies,
             count(name) AS named FROM poly_a`);

    const checks = {
      eachLakeHasOneName: num(multi?.n) === 0,
      extraLakesValid: num(extraCheck?.invalid) === 0,
      // Tolerance: the geometry makes a round trip Albers -> EPSG:4326 -> Albers here.
      extraLakesOutsideHydroLakes:
        num(extraCheck?.overlap_km2) <= 0.001 * num(extraTotal?.km2),
      detailOutsideLakes: num(detailCheck?.in_lake) === 0,
      detailNotLongerThanInput:
        num(detailCheck?.km) <= num(detailIn?.km) + 1e-6,
      everyHydroLakeKept:
        num((await db.all(`SELECT count(*) AS n FROM lakes_named`))[0]?.n) ===
        num(names?.lakes),
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("ign-layers", {
      ok,
      checks,
      water,
      ignWaterPolygons: {
        inBasin: num(polys?.n),
        reservoirs: num(polys?.reservoirs),
        waterBodies: num(polys?.water_bodies),
        named: num(polys?.named),
      },
      hydroLakes: {
        lakes: num(names?.lakes),
        namedByIgn: num(names?.ign_named),
        namedByHydroLakesOnly: num(names?.hydrolakes_only_named),
        namedByBoth: num(names?.both_named),
        /** HydroLAKES' own names compared with the IGN name that replaces them. */
        renamed,
      },
      extraLakes: {
        byKind: extraByKind,
        overlapWithHydroLakesKm2: round(num(extraCheck?.overlap_km2), 4),
      },
      detail: {
        piecesFromMatchStep: num(detailIn?.pieces),
        kmFromMatchStep: round(num(detailIn?.km)),
        pieces: num(detailCheck?.pieces),
        km: round(num(detailCheck?.km)),
        named: num(detailCheck?.named_pieces),
        endorheic: num(detailCheck?.endorheic_pieces),
        removedInLakesKm: round(num(detailIn?.km) - num(detailCheck?.km)),
      },
      dams: {
        points: num(dam?.points),
        pointsNamed: num(dam?.points_named),
        walls: num(dam?.walls),
        wallsNamed: num(dam?.walls_named),
        pointNames: dam?.point_names,
        wallNames: dam?.wall_names,
      },
      geojsonBytes: sizes,
      outputs: Object.keys(sizes),
    });
    if (!ok)
      throw new Error(`ign-layers checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
