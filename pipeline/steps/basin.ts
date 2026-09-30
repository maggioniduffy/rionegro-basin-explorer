/**
 * pipeline:basin — delineate the Río Negro basin from HydroBASINS level 12.
 *
 * 1. Outlet: the sea-draining HydroRIVERS reach (NEXT_DOWN = 0) with the largest
 *    UPLAND_SKM inside `outletSearchBbox` (basin.config.json). Reported for review.
 * 2. Members: the level-12 polygon holding that reach (HYBAS_L12) plus everything
 *    upstream of it via NEXT_DOWN, cross-checked against grouping by MAIN_BAS.
 * 3. Dissolve, then compare three area figures: the outlet polygon's UP_AREA, the sum
 *    of SUB_AREA, and the geodesic area of the dissolved polygon (plus Albers).
 *
 * Outputs in data/work/basin/: basin.geojson, hybas_l12.parquet, report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { areaAlbersKm2, areaSpheroidKm2, envelope, pctDiff } from "../lib/geo";
import { difference, upstreamIndex, upstreamSet } from "../lib/graph";
import { INPUTS, requireInput } from "../lib/inputs";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface BasinConfig {
  outletSearchBbox: { xmin: number; ymin: number; xmax: number; ymax: number };
  reference: {
    areaKm2: number | null;
    source: string | null;
    tolerancePct: number;
  };
}

/** Area figures that describe the same polygon set must agree this closely. */
const AREA_AGREEMENT_PCT = 1;

async function main() {
  const config = JSON.parse(
    await readFile(`${ROOT}/pipeline/basin.config.json`, "utf8"),
  ) as BasinConfig;
  const rivers = lit(requireInput(INPUTS.hydroRivers));
  const lev12 = lit(requireInput(INPUTS.hydroBasins(12)));
  const outDir = workPath("basin");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    // 1. Outlet reach.
    const candidates = await db.all(`
      SELECT HYRIV_ID, UPLAND_SKM, DIS_AV_CMS, ORD_STRA, HYBAS_L12, MAIN_RIV,
             ST_X(ST_StartPoint(geom)) AS start_lon, ST_Y(ST_StartPoint(geom)) AS start_lat,
             ST_X(ST_EndPoint(geom)) AS end_lon, ST_Y(ST_EndPoint(geom)) AS end_lat
      FROM ST_Read(${rivers})
      WHERE NEXT_DOWN = 0 AND ST_Intersects(geom, ${envelope(config.outletSearchBbox)})
      ORDER BY UPLAND_SKM DESC
      LIMIT 3`);
    const outlet = candidates[0];
    if (!outlet)
      throw new Error("no sea-draining reach inside outletSearchBbox");
    const outletBasinId = String(outlet.HYBAS_L12);
    console.log(
      `outlet reach ${outlet.HYRIV_ID}, upland ${outlet.UPLAND_SKM} km²`,
    );

    // 2. Level-12 members: upstream traversal vs MAIN_BAS.
    await db.conn.run(`
      CREATE TABLE lev12 AS
      SELECT HYBAS_ID, NEXT_DOWN, NEXT_SINK, MAIN_BAS, SUB_AREA, UP_AREA, PFAF_ID, ENDO, COAST, geom
      FROM ST_Read(${lev12})`);
    const links = await db.all(
      `SELECT HYBAS_ID, NEXT_DOWN, MAIN_BAS, UP_AREA FROM lev12`,
    );
    const byId = new Map(links.map((r) => [String(r.HYBAS_ID), r]));
    const outletBasin = byId.get(outletBasinId);
    if (!outletBasin)
      throw new Error(`HYBAS_L12 ${outletBasinId} not found in level 12`);

    const index = upstreamIndex(
      links.map((r) => ({
        id: String(r.HYBAS_ID),
        nextDown: String(r.NEXT_DOWN),
      })),
    );
    const traversed = upstreamSet(index, outletBasinId);
    const mainBas = String(outletBasin.MAIN_BAS);
    const byMainBas = new Set(
      links
        .filter((r) => String(r.MAIN_BAS) === mainBas)
        .map((r) => String(r.HYBAS_ID)),
    );
    const onlyTraversal = difference(traversed, byMainBas);
    const onlyMainBas = difference(byMainBas, traversed);
    console.log(
      `level-12 members: ${traversed.size} (MAIN_BAS group: ${byMainBas.size})`,
    );

    await db.conn.run(
      `CREATE TABLE member_ids AS SELECT unnest([${[...traversed].join(",")}]::BIGINT[]) AS id`,
    );
    await db.conn.run(
      `CREATE TABLE members AS SELECT l.* FROM lev12 l JOIN member_ids m ON l.HYBAS_ID = m.id`,
    );
    const [attrs] = await db.all(`
      SELECT count(*) AS n, sum(SUB_AREA) AS sum_sub_area,
             sum(CASE WHEN ENDO = 0 THEN SUB_AREA ELSE 0 END) AS connected_area,
             sum(ENDO = 1)::INT AS endo_part_n, sum(ENDO = 2)::INT AS endo_sink_n,
             sum(CASE WHEN ENDO > 0 THEN SUB_AREA ELSE 0 END) AS endo_area,
             sum(COAST > 0)::INT AS coast_n
      FROM members`);

    // 3. Dissolve and measure. Two definitions, because HydroBASINS links some
    // endorheic sinks to the surrounding basin with a "virtual" NEXT_DOWN (ENDO = 2
    // and NEXT_DOWN > 0; HydroBASINS TechDoc v1c, attribute table). UP_AREA leaves
    // those regions out; SUB_AREA sums include them.
    //   total:     every traversed polygon (the default basin outline)
    //   connected: only polygons with surface flow to the outlet (ENDO = 0)
    await db.conn.run(
      `CREATE TABLE basin AS SELECT ST_Union_Agg(geom) AS geom FROM members`,
    );
    const [connected] = await db.all(`
      SELECT ${areaSpheroidKm2("g")} AS area, ST_NumGeometries(g) AS parts
      FROM (SELECT ST_Union_Agg(geom) AS g FROM members WHERE ENDO = 0)`);
    const [shape] = await db.all(`
      SELECT ST_IsValid(geom) AS valid, ST_GeometryType(geom)::VARCHAR AS type,
             ST_NumGeometries(geom) AS parts,
             ${areaSpheroidKm2("geom")} AS area_spheroid, ${areaAlbersKm2("geom")} AS area_albers,
             ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
      FROM basin`);
    // Holes: areas enclosed by the outline but outside the member set. Near-zero
    // total area means they are slivers between polygons, not real enclaves.
    const [holes] = await db.all(`
      WITH parts AS (SELECT unnest(ST_Dump(geom)).geom AS g FROM basin)
      SELECT sum(ST_NumInteriorRings(g))::INT AS n,
             sum(${areaSpheroidKm2("ST_MakePolygon(ST_ExteriorRing(g))")} - ${areaSpheroidKm2("g")}) AS area
      FROM parts`);

    const upArea = Number(outletBasin.UP_AREA);
    const sumSubArea = Number(attrs?.sum_sub_area);
    const connectedSubArea = Number(attrs?.connected_area);
    const areaSpheroid = Number(shape?.area_spheroid);
    const areaAlbers = Number(shape?.area_albers);
    const ref = config.reference;

    // Outputs.
    await db.conn.run(
      `COPY members TO ${lit(`${outDir}/hybas_l12.parquet`)} (FORMAT parquet)`,
    );
    const [gj] = await db.all(`SELECT ST_AsGeoJSON(geom) AS g FROM basin`);
    const feature = {
      type: "Feature",
      properties: {
        name: "Río Negro",
        outletHyrivId: outlet.HYRIV_ID,
        outletHybasId: outletBasinId,
        areaKm2: Math.round(areaSpheroid),
        source: "HydroBASINS v1c level 12, dissolved",
      },
      geometry: JSON.parse(String(gj?.g)),
    };
    const geojsonFile = `${outDir}/basin.geojson`;
    await writeFile(
      geojsonFile,
      JSON.stringify({ type: "FeatureCollection", features: [feature] }),
    );

    const checks = {
      outletBasinDrainsToSea: String(outletBasin.NEXT_DOWN) === "0",
      traversalMatchesMainBas:
        onlyTraversal.length === 0 && onlyMainBas.length === 0,
      polygonValid: shape?.valid === true,
      connectedSubAreaMatchesUpArea:
        Math.abs(pctDiff(connectedSubArea, upArea)) <= AREA_AGREEMENT_PCT,
      polygonMatchesSumSubArea:
        Math.abs(pctDiff(areaSpheroid, sumSubArea)) <= AREA_AGREEMENT_PCT,
      spheroidMatchesAlbers:
        Math.abs(pctDiff(areaAlbers, areaSpheroid)) <= AREA_AGREEMENT_PCT,
      withinReference:
        ref.areaKm2 === null
          ? "pending: no reference figure agreed yet"
          : Math.abs(pctDiff(areaSpheroid, ref.areaKm2)) <= ref.tolerancePct,
    };

    await writeReport("basin", {
      ok: Object.values(checks).every((v) => v === true),
      checks,
      outlet: {
        chosen: outlet,
        runnersUp: candidates.slice(1),
        searchBbox: config.outletSearchBbox,
        note: "HydroRIVERS lines are expected to run downstream, so end_* should be the mouth; verify on a map.",
      },
      level12: {
        outletHybasId: outletBasinId,
        mainBas,
        members: traversed.size,
        mainBasGroup: byMainBas.size,
        onlyTraversal: onlyTraversal.slice(0, 20),
        onlyMainBas: onlyMainBas.slice(0, 20),
        endorheicPartMembers: attrs?.endo_part_n,
        endorheicSinkMembers: attrs?.endo_sink_n,
        endorheicAreaKm2: attrs?.endo_area,
        coastalMembers: attrs?.coast_n,
      },
      areaKm2: {
        outletUpArea: upArea,
        sumSubArea,
        connectedSubArea,
        connectedPolygonSpheroid: Number(connected?.area),
        connectedPolygonParts: connected?.parts,
        polygonSpheroid: areaSpheroid,
        polygonAlbers: areaAlbers,
        diffPct: {
          connectedSubAreaVsUpArea: pctDiff(connectedSubArea, upArea),
          totalVsConnected: pctDiff(sumSubArea, connectedSubArea),
          polygonVsSumSubArea: pctDiff(areaSpheroid, sumSubArea),
          albersVsSpheroid: pctDiff(areaAlbers, areaSpheroid),
          vsReference:
            ref.areaKm2 === null ? null : pctDiff(areaSpheroid, ref.areaKm2),
        },
        reference: ref,
      },
      polygon: {
        type: shape?.type,
        parts: shape?.parts,
        holes: holes?.n,
        holesAreaKm2: holes?.area,
        bbox: {
          xmin: shape?.xmin,
          ymin: shape?.ymin,
          xmax: shape?.xmax,
          ymax: shape?.ymax,
        },
      },
      outputs: [rel(geojsonFile), rel(`${outDir}/hybas_l12.parquet`)],
    });
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
