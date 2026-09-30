/**
 * pipeline:mask — polygons for the "Visible Land" slider.
 *
 * For each level in map.config.json (mask.baseHalfWidthKm), every reach is buffered by
 * baseHalfWidthKm × strahlerFactor[order] on each side, in South America Albers
 * (ESRI:102033, metres). Buffers are built per Strahler order, unioned, and clipped to
 * the basin; that is the "hole" of visible land. The mask is the map bounds rectangle
 * minus the hole. A final level uses the whole basin as the hole (plain silhouette).
 * All reaches are buffered, endorheic ones included; the map's endorheic filter hides
 * Lakes (pipeline:lakes, clipped to the basin) are part of the hole at every level, so
 * they are never masked.
 *
 * Endorheic overlay: the same holes built from connected reaches and lakes only, and
 * clipped to the connected part of the basin (HydroBASINS ENDO = 0, as pipeline:basin).
 * For each level, hole − connected hole is the land visible only because of endorheic
 * drainage. The map draws it in the mask colour when endorheic streams are hidden, so
 * lines and land disappear together (one small extra layer instead of a second set of
 * masks).
 *
 * Outputs: data/work/tiles/mask.geojson and mask_endorheic.geojson (one feature per
 * level, property `level`).
 */
import { mkdir, rm } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { areaAlbersKm2, envelope } from "../lib/geo";
import { requireInput } from "../lib/inputs";
import { mapConfig } from "../lib/map-config";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const TO_ALBERS = `'EPSG:4326', 'ESRI:102033', always_xy := true`;
const TO_WGS84 = `'ESRI:102033', 'EPSG:4326', always_xy := true`;
/** Segments per quarter circle in buffers; low keeps vertex counts down. */
const QUAD_SEGS = 4;

async function main() {
  const reaches = lit(requireInput(workPath("tiles/reaches.geojson")));
  const basin = lit(requireInput(workPath("tiles/basin.geojson")));
  const lakes = lit(requireInput(workPath("lakes/lakes.geojson")));
  const hybas = lit(requireInput(workPath("basin/hybas_l12.parquet")));
  const outFile = workPath("tiles/mask.geojson");
  const endoFile = workPath("tiles/mask_endorheic.geojson");
  await mkdir(workPath("tiles"), { recursive: true });
  const { basinBbox, bounds, mask } = mapConfig;
  const db = await openDb();

  try {
    await db.conn.run(`
      CREATE TABLE r AS
      SELECT strahler, network, ST_Transform(geom, ${TO_ALBERS}) AS g
      FROM ST_Read(${reaches})`);
    await db.conn.run(`
      CREATE TABLE b AS
      SELECT geom AS g4326, ST_Transform(geom, ${TO_ALBERS}) AS g,
             ${areaAlbersKm2("geom")} AS area_km2
      FROM ST_Read(${basin})`);
    await db.conn.run(`
      CREATE TABLE lk AS
      SELECT ST_Union_Agg(ST_Transform(geom, ${TO_ALBERS})) AS g,
             ST_Union_Agg(ST_Transform(geom, ${TO_ALBERS}))
               FILTER (WHERE network = 'connected') AS g_conn,
             count(*)::INT AS n
      FROM ST_Read(${lakes})`);
    await db.conn.run(`
      CREATE TABLE conn AS
      SELECT ST_Intersection(ST_Transform(ST_Union_Agg(ST_MakeValid(geom)), ${TO_ALBERS}),
                             (SELECT g FROM b)) AS g
      FROM read_parquet(${hybas}) WHERE ENDO = 0`);
    const orders = (
      await db.all(`SELECT DISTINCT strahler FROM r ORDER BY strahler`)
    ).map((row) => Number(row.strahler));
    for (const order of orders) {
      if (mask.strahlerFactor[String(order)] === undefined)
        throw new Error(`mask.strahlerFactor has no entry for order ${order}`);
    }

    // Buffers, one level at a time; the last level is the whole basin. Built per
    // (order, network) so the all-reaches and connected-only holes share the work.
    await db.conn.run(
      `CREATE TABLE holes (level INT, base_half_width_km DOUBLE, g GEOMETRY, g_conn GEOMETRY)`,
    );
    for (const [level, base] of mask.baseHalfWidthKm.entries()) {
      const factor = `CASE strahler ${orders
        .map((o) => `WHEN ${o} THEN ${mask.strahlerFactor[String(o)]}`)
        .join(" ")} END`;
      const started = Date.now();
      await db.conn.run(`
        CREATE OR REPLACE TABLE bufs AS
        SELECT network,
               ST_Buffer(ST_Collect(list(g)), ${base * 1000} * any_value(${factor}), ${QUAD_SEGS}) AS buf
        FROM r GROUP BY strahler, network`);
      await db.conn.run(`
        INSERT INTO holes
        SELECT ${level}, ${base},
               ST_Union(ST_Intersection(ST_Union_Agg(buf), (SELECT g FROM b)),
                        (SELECT g FROM lk)),
               ST_Intersection(
                 ST_Union(ST_Union_Agg(buf) FILTER (WHERE network = 'connected'),
                          (SELECT g_conn FROM lk)),
                 (SELECT g FROM conn))
        FROM bufs`);
      console.log(
        `level ${level} (${base} km base): ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    }
    const fullLevel = mask.baseHalfWidthKm.length;
    await db.conn.run(
      `INSERT INTO holes SELECT ${fullLevel}, NULL, (SELECT g FROM b), (SELECT g FROM conn)`,
    );

    // Land visible only because of endorheic drainage, per level.
    await db.conn.run(`
      CREATE TABLE endo AS
      SELECT level, ST_Difference(g, g_conn) AS g_albers,
             ST_Area(ST_Difference(g_conn, g)) / 1e6 AS conn_outside_km2
      FROM holes`);
    await db.conn.run(`
      ALTER TABLE endo ADD COLUMN geom GEOMETRY;
      UPDATE endo SET geom = ST_MakeValid(ST_Transform(g_albers, ${TO_WGS84}))`);
    const endoLevels = await db.all(`
      SELECT e.level, round(ST_Area(e.g_albers) / 1e6)::INT AS endorheicOnlyKm2,
             round(100 * ST_Area(h.g_conn) / 1e6 / (SELECT area_km2 FROM b), 1) AS connectedVisiblePctOfBasin,
             ST_NPoints(e.geom)::INT AS vertices, ST_IsValid(e.geom) AS valid,
             e.conn_outside_km2 AS connectedHoleOutsideHoleKm2
      FROM endo e JOIN holes h USING (level) ORDER BY level`);

    await db.conn.run(`
      CREATE TABLE masks AS
      SELECT level, base_half_width_km,
             ST_Area(g) / 1e6 AS hole_km2,
             ST_MakeValid(ST_Difference(${envelope(bounds)},
                                        ST_Transform(g, ${TO_WGS84}))) AS geom
      FROM holes`);
    const levels = await db.all(`
      SELECT level, base_half_width_km AS baseHalfWidthKm,
             round(hole_km2)::INT AS visibleKm2,
             round(100 * hole_km2 / (SELECT area_km2 FROM b), 1) AS visiblePctOfBasin,
             ST_NPoints(geom)::INT AS maskVertices,
             ST_IsValid(geom) AS valid, ST_GeometryType(geom)::VARCHAR AS type
      FROM masks ORDER BY level`);
    // Lake area left outside the hole, per level; should be ~0 (float noise only).
    const [lakeFit] = await db.all(`
      SELECT (SELECT n FROM lk) AS lakes,
             round((SELECT ST_Area(g) FROM lk) / 1e6, 1) AS lakes_km2,
             max(ST_Area(ST_Difference((SELECT g FROM lk), h.g)) / 1e6) AS worst_uncovered_km2
      FROM holes h`);
    const [basinRow] = await db.all(
      `SELECT round(area_km2)::INT AS km2 FROM b`,
    );
    // The mask must stay inside the bounds, and the basin must fit inside them.
    const [fit] = await db.all(`
      SELECT ST_Within((SELECT g4326 FROM b), ${envelope(bounds)}) AS basin_inside,
             (SELECT [ST_XMin(g4326), ST_YMin(g4326), ST_XMax(g4326), ST_YMax(g4326)] FROM b) AS extent,
             bool_and(ST_Within(geom, ST_Buffer(${envelope(bounds)}, 1e-9))) AS masks_inside
      FROM masks`);

    await rm(endoFile, { force: true });
    await db.conn.run(`
      COPY (SELECT level, geom FROM endo WHERE NOT ST_IsEmpty(geom) ORDER BY level)
      TO ${lit(endoFile)} WITH (FORMAT gdal, DRIVER 'GeoJSON',
                                LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);
    await rm(outFile, { force: true });
    await db.conn.run(`
      COPY (SELECT level, geom FROM masks ORDER BY level)
      TO ${lit(outFile)} WITH (FORMAT gdal, DRIVER 'GeoJSON',
                               LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);

    const extent = (fit?.extent as number[] | undefined) ?? [];
    const configBbox = [
      basinBbox.xmin,
      basinBbox.ymin,
      basinBbox.xmax,
      basinBbox.ymax,
    ];
    const visible = levels.map((l) => Number(l.visiblePctOfBasin));
    const checks = {
      allValid: levels.every((l) => l.valid === true),
      basinInsideBounds: fit?.basin_inside === true,
      masksInsideBounds: fit?.masks_inside === true,
      visibleAreaGrowsWithLevel: visible.every(
        (v, i) => i === 0 || v > (visible[i - 1] ?? 0),
      ),
      // basinBbox is typed into map.config.json for the app's initial view.
      basinBboxMatchesData: configBbox.every(
        (v, i) => Math.abs(v - (extent[i] ?? NaN)) < 1e-3,
      ),
      lakesVisibleAtEveryLevel:
        Number(lakeFit?.worst_uncovered_km2 ?? 1) < 0.01,
      endorheicOverlayValid: endoLevels.every((l) => l.valid === true),
      // The connected hole must lie inside the full hole, so the overlay is exactly
      // the land that hiding endorheic reaches should cover.
      connectedHoleInsideHole: endoLevels.every(
        (l) => Number(l.connectedHoleOutsideHoleKm2) < 0.01,
      ),
      connectedVisibleGrowsWithLevel: endoLevels.every(
        (l, i) =>
          i === 0 ||
          Number(l.connectedVisiblePctOfBasin) >
            Number(endoLevels[i - 1]?.connectedVisiblePctOfBasin ?? 0),
      ),
      lastLevelIsWholeBasin: Math.abs((visible.at(-1) ?? 0) - 100) < 0.1,
    };
    await writeReport("mask", {
      ok: Object.values(checks).every(Boolean),
      checks,
      basinKm2: basinRow?.km2,
      lakes: lakeFit,
      basinExtent: extent,
      strahlerFactor: mask.strahlerFactor,
      levels,
      endorheicOverlay: endoLevels,
      outputs: [rel(outFile), rel(endoFile)],
    });
    if (!Object.values(checks).every(Boolean))
      throw new Error(`mask checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
