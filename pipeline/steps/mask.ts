/**
 * pipeline:mask — polygons for the "Visible Land" slider.
 *
 * For each level in map.config.json (mask.baseHalfWidthKm), every reach is buffered by
 * baseHalfWidthKm × strahlerFactor[order] on each side, in South America Albers
 * (ESRI:102033, metres). Buffers are built per Strahler order, unioned, and clipped to
 * the basin; that is the "hole" of visible land. The mask is the map bounds rectangle
 * minus the hole. A final level uses the whole basin as the hole (plain silhouette).
 * All reaches are buffered, endorheic ones included; the map's endorheic filter hides
 * lines only.
 *
 * Output: data/work/tiles/mask.geojson (one feature per level, property `level`).
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
  const outFile = workPath("tiles/mask.geojson");
  await mkdir(workPath("tiles"), { recursive: true });
  const { bounds, mask } = mapConfig;
  const db = await openDb();

  try {
    await db.conn.run(`
      CREATE TABLE r AS
      SELECT strahler, ST_Transform(geom, ${TO_ALBERS}) AS g FROM ST_Read(${reaches})`);
    await db.conn.run(`
      CREATE TABLE b AS
      SELECT geom AS g4326, ST_Transform(geom, ${TO_ALBERS}) AS g,
             ${areaAlbersKm2("geom")} AS area_km2
      FROM ST_Read(${basin})`);
    const orders = (
      await db.all(`SELECT DISTINCT strahler FROM r ORDER BY strahler`)
    ).map((row) => Number(row.strahler));
    for (const order of orders) {
      if (mask.strahlerFactor[String(order)] === undefined)
        throw new Error(`mask.strahlerFactor has no entry for order ${order}`);
    }

    // Buffers, one level at a time; the last level is the whole basin.
    await db.conn.run(
      `CREATE TABLE holes (level INT, base_half_width_km DOUBLE, g GEOMETRY)`,
    );
    for (const [level, base] of mask.baseHalfWidthKm.entries()) {
      const factor = `CASE strahler ${orders
        .map((o) => `WHEN ${o} THEN ${mask.strahlerFactor[String(o)]}`)
        .join(" ")} END`;
      const started = Date.now();
      await db.conn.run(`
        INSERT INTO holes
        SELECT ${level}, ${base},
               ST_Intersection(ST_Union_Agg(buf), (SELECT g FROM b))
        FROM (
          SELECT ST_Buffer(ST_Collect(list(g)), ${base * 1000} * any_value(${factor}), ${QUAD_SEGS}) AS buf
          FROM r GROUP BY strahler
        )`);
      console.log(
        `level ${level} (${base} km base): ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    }
    const fullLevel = mask.baseHalfWidthKm.length;
    await db.conn.run(`INSERT INTO holes SELECT ${fullLevel}, NULL, g FROM b`);

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
    const [basinRow] = await db.all(
      `SELECT round(area_km2)::INT AS km2 FROM b`,
    );
    // The mask must stay inside the bounds, and the basin must fit inside them.
    const [fit] = await db.all(`
      SELECT ST_Within((SELECT g4326 FROM b), ${envelope(bounds)}) AS basin_inside,
             bool_and(ST_Within(geom, ST_Buffer(${envelope(bounds)}, 1e-9))) AS masks_inside
      FROM masks`);

    await rm(outFile, { force: true });
    await db.conn.run(`
      COPY (SELECT level, geom FROM masks ORDER BY level)
      TO ${lit(outFile)} WITH (FORMAT gdal, DRIVER 'GeoJSON',
                               LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);

    const visible = levels.map((l) => Number(l.visiblePctOfBasin));
    const checks = {
      allValid: levels.every((l) => l.valid === true),
      basinInsideBounds: fit?.basin_inside === true,
      masksInsideBounds: fit?.masks_inside === true,
      visibleAreaGrowsWithLevel: visible.every(
        (v, i) => i === 0 || v > (visible[i - 1] ?? 0),
      ),
      lastLevelIsWholeBasin: Math.abs((visible.at(-1) ?? 0) - 100) < 0.1,
    };
    await writeReport("mask", {
      ok: Object.values(checks).every(Boolean),
      checks,
      basinKm2: basinRow?.km2,
      strahlerFactor: mask.strahlerFactor,
      levels,
      outputs: [rel(outFile)],
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
