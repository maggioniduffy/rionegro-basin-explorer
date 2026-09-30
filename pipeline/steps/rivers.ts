/**
 * pipeline:rivers — select the basin's HydroRIVERS reaches and join RiverATLAS.
 *
 * Selection is by attribute: every reach whose HYBAS_L12 is one of the basin's
 * level-12 polygons (data/work/basin/hybas_l12.parquet). That keeps reaches in the
 * endorheic parts of the basin, which have their own MAIN_RIV. Each reach gets:
 *   network: "connected" (drains to the Río Negro outlet) or "endorheic"
 * so the map can hide endorheic reaches and network traversal can skip them.
 * Intermittent streams are not filtered: HydroRIVERS keeps any reach with more than
 * 10 km² upstream area OR 0.1 m³/s modeled discharge (TechDoc v1.0), and no
 * intermittency attribute exists in HydroRIVERS or RiverATLAS v1.0.
 *
 * Checks: orphans, completeness of the connected network, a spatial cross-check
 * against the basin polygon, and a 1:1 RiverATLAS join with matching shared fields.
 *
 * Outputs in data/work/rivers/: reaches.parquet (geometry + HydroRIVERS fields +
 * flags), riveratlas_basin.parquet (all RiverATLAS columns for these reaches; cached
 * because the global scan takes minutes), report.json.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { lengthSpheroidKm, pctDiff } from "../lib/geo";
import { INPUTS, requireInput } from "../lib/inputs";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

/** Summed LENGTH_KM and geodesic line length must agree this closely (%). */
const LENGTH_AGREEMENT_PCT = 2;
/**
 * Shared HydroRIVERS/RiverATLAS fields that must agree after the join. Integer fields
 * must be identical. RiverATLAS stores the decimal ones as float32 (1.16 → 1.1599999),
 * so those are compared with a relative tolerance just above float32 precision.
 */
const SHARED_FIELDS = [
  "NEXT_DOWN",
  "MAIN_RIV",
  "LENGTH_KM",
  "UPLAND_SKM",
  "ORD_STRA",
];
const FLOAT_FIELDS = new Set(["LENGTH_KM", "UPLAND_SKM"]);
const FLOAT_REL_TOLERANCE = 1e-6;

async function main() {
  const rivers = lit(requireInput(INPUTS.hydroRivers));
  const atlas = lit(requireInput(INPUTS.riverAtlas));
  const basinDir = workPath("basin");
  const members = requireInput(`${basinDir}/hybas_l12.parquet`);
  const basinGeojson = requireInput(`${basinDir}/basin.geojson`);
  const basinReport = JSON.parse(
    await readFile(`${basinDir}/report.json`, "utf8"),
  ) as {
    outlet: { chosen: { HYRIV_ID: number; MAIN_RIV: number } };
  };
  const outlet = basinReport.outlet.chosen;
  const outDir = workPath("rivers");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    // 1. Select reaches by level-12 membership and flag them.
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT r.* EXCLUDE (OGC_FID),
             CASE WHEN r.MAIN_RIV = ${outlet.MAIN_RIV} THEN 'connected' ELSE 'endorheic' END AS network
      FROM ST_Read(${rivers}) r
      JOIN ${lit(members)} m ON r.HYBAS_L12 = m.HYBAS_ID`);

    const [counts] = await db.all(`
      SELECT count(*) AS n,
             sum(network = 'connected')::INT AS connected_n,
             sum(network = 'endorheic')::INT AS endorheic_n,
             sum(LENGTH_KM) AS km,
             sum(CASE WHEN network = 'connected' THEN LENGTH_KM ELSE 0 END) AS connected_km,
             sum(CASE WHEN network = 'endorheic' THEN LENGTH_KM ELSE 0 END) AS endorheic_km,
             ${lengthSpheroidKm("ST_Collect(list(geom))")} AS geodesic_km,
             sum(DIS_AV_CMS = 0)::INT AS zero_flow_n,
             sum(CASE WHEN DIS_AV_CMS = 0 THEN LENGTH_KM ELSE 0 END) AS zero_flow_km,
             count(DISTINCT MAIN_RIV) AS systems
      FROM reaches`);
    console.log(`reaches: ${counts?.n} (${counts?.connected_n} connected)`);

    // Consistency of the network flag with HydroRIVERS' own ENDORHEIC field.
    const flagVsEndorheic = await db.all(`
      SELECT network, ENDORHEIC, count(*) AS n FROM reaches GROUP BY ALL ORDER BY ALL`);
    const byOrder = await db.all(`
      SELECT ORD_STRA AS strahler, count(*) AS n, round(sum(LENGTH_KM), 1) AS km
      FROM reaches GROUP BY ALL ORDER BY ALL`);

    // 2. Topology. An orphan points downstream to a reach outside the selection.
    // Terminal reaches (NEXT_DOWN = 0) are allowed: the outlet, and endorheic sinks.
    const [topology] = await db.all(`
      SELECT
        (SELECT count(*) FROM reaches r
          WHERE r.NEXT_DOWN <> 0
            AND r.NEXT_DOWN NOT IN (SELECT HYRIV_ID FROM reaches))::INT AS orphans,
        (SELECT count(*) FROM reaches
          WHERE network = 'connected' AND NEXT_DOWN = 0
            AND HYRIV_ID <> ${outlet.HYRIV_ID})::INT AS extra_connected_terminals,
        (SELECT count(*) FROM reaches r
          WHERE r.network = 'connected'
            AND r.NEXT_DOWN IN (SELECT HYRIV_ID FROM reaches WHERE network = 'endorheic'))::INT
          AS connected_into_endorheic`);
    const orphanSample = await db.all(`
      SELECT HYRIV_ID, NEXT_DOWN, network, LENGTH_KM FROM reaches
      WHERE NEXT_DOWN <> 0 AND NEXT_DOWN NOT IN (SELECT HYRIV_ID FROM reaches)
      LIMIT 20`);

    // Completeness: all of the outlet's MAIN_RIV network must be selected.
    const [completeness] = await db.all(`
      SELECT count(*)::INT AS main_riv_total,
             sum(HYBAS_L12 NOT IN (SELECT HYBAS_ID FROM ${lit(members)}))::INT AS outside_basin
      FROM ST_Read(${rivers}) WHERE MAIN_RIV = ${outlet.MAIN_RIV}`);

    // 3. Spatial cross-check against the dissolved basin polygon, by reach midpoint.
    await db.conn.run(
      `CREATE TABLE basin AS SELECT geom FROM ST_Read(${lit(basinGeojson)})`,
    );
    const [spatial] = await db.all(`
      WITH b AS (SELECT geom, ST_Envelope(geom) AS env FROM basin)
      SELECT
        (SELECT count(*) FROM reaches, b
          WHERE NOT ST_Within(ST_PointOnSurface(reaches.geom), b.geom))::INT AS selected_outside,
        (SELECT count(*) FROM ST_Read(${rivers}) r, b
          WHERE ST_Intersects(r.geom, b.env)
            AND ST_Within(ST_PointOnSurface(r.geom), b.geom)
            AND r.HYRIV_ID NOT IN (SELECT HYRIV_ID FROM reaches))::INT AS unselected_inside`);

    // 4. RiverATLAS join (cached basin subset of the global FileGDB).
    const ids = (
      await db.all(`SELECT HYRIV_ID FROM reaches ORDER BY HYRIV_ID`)
    ).map((r) => Number(r.HYRIV_ID));
    const idsHash = createHash("sha256").update(ids.join(",")).digest("hex");
    const atlasFile = `${outDir}/riveratlas_basin.parquet`;
    const atlasHashFile = `${atlasFile}.ids-sha256`;
    const cached =
      existsSync(atlasFile) &&
      existsSync(atlasHashFile) &&
      (await readFile(atlasHashFile, "utf8")).trim() === idsHash;
    if (!cached) {
      console.log("scanning global RiverATLAS (takes a few minutes)...");
      await db.conn.run(`
        COPY (
          SELECT a.* EXCLUDE (Shape) FROM ST_Read(${atlas}, layer='RiverATLAS_v10') a
          WHERE a.HYRIV_ID IN (SELECT HYRIV_ID FROM reaches)
        ) TO ${lit(atlasFile)} (FORMAT parquet)`);
      await writeFile(atlasHashFile, idsHash + "\n");
    } else {
      console.log("RiverATLAS basin subset: cached");
    }
    const mismatchCases = SHARED_FIELDS.map((f) =>
      FLOAT_FIELDS.has(f)
        ? `sum((abs(r.${f} - a.${f}) > ${FLOAT_REL_TOLERANCE} * greatest(abs(r.${f}), 1)
                 OR (r.${f} IS NULL) <> (a.${f} IS NULL))::INT) AS ${f}`
        : `sum((r.${f} IS DISTINCT FROM a.${f})::INT) AS ${f}`,
    ).join(", ");
    const [join] = await db.all(`
      SELECT count(*)::INT AS matched, count(DISTINCT a.HYRIV_ID)::INT AS distinct_matched,
             ${mismatchCases}
      FROM reaches r JOIN ${lit(atlasFile)} a USING (HYRIV_ID)`);
    const [atlasRows] = await db.all(
      `SELECT count(*)::INT AS n FROM ${lit(atlasFile)}`,
    );

    const reachesFile = `${outDir}/reaches.parquet`;
    await db.conn.run(`COPY reaches TO ${lit(reachesFile)} (FORMAT parquet)`);

    const n = Number(counts?.n);
    const km = Number(counts?.km);
    const geodesicKm = Number(counts?.geodesic_km);
    const mismatches = Object.fromEntries(
      SHARED_FIELDS.map((f) => [f, Number(join?.[f])]),
    );
    const checks = {
      zeroOrphans: topology?.orphans === 0,
      singleConnectedOutlet: topology?.extra_connected_terminals === 0,
      noConnectedIntoEndorheic: topology?.connected_into_endorheic === 0,
      connectedNetworkComplete: completeness?.outside_basin === 0,
      connectedCountMatchesMainRiv:
        completeness?.main_riv_total === counts?.connected_n,
      lengthKmMatchesGeodesic:
        Math.abs(pctDiff(km, geodesicKm)) <= LENGTH_AGREEMENT_PCT,
      riverAtlasJoinOneToOne:
        join?.matched === n &&
        join?.distinct_matched === n &&
        atlasRows?.n === n,
      riverAtlasSharedFieldsMatch: Object.values(mismatches).every(
        (v) => v === 0,
      ),
    };

    await writeReport("rivers", {
      ok: Object.values(checks).every(Boolean),
      checks,
      counts: {
        reaches: n,
        connected: counts?.connected_n,
        endorheic: counts?.endorheic_n,
        endorheicSystems: Number(counts?.systems) - 1,
        zeroModeledFlow: counts?.zero_flow_n,
      },
      lengthKm: {
        total: km,
        connected: counts?.connected_km,
        endorheic: counts?.endorheic_km,
        zeroModeledFlow: counts?.zero_flow_km,
        geodesicTotal: geodesicKm,
        diffPct: pctDiff(km, geodesicKm),
      },
      byStrahlerOrder: byOrder,
      networkFlagVsEndorheicField: flagVsEndorheic,
      topology: { ...topology, orphanSample },
      completeness,
      spatialCrossCheck: {
        ...spatial,
        note: "Midpoint test against the dissolved polygon; boundary reaches may land either side.",
      },
      riverAtlasJoin: { ...join, subsetRows: atlasRows?.n, cached, mismatches },
      notes: [
        "DIS_AV_CMS is modeled long-term natural discharge (1971–2000); zero means no modeled flow, not observed dryness.",
        "No intermittency attribute exists in HydroRIVERS or RiverATLAS v1.0; intermittent streams are included but unlabeled.",
      ],
      outputs: [rel(reachesFile), rel(atlasFile)],
    });
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
