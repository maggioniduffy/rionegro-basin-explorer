/**
 * pipeline:export — final Phase 1 artifacts and the combined report.
 *
 *   data/out/reaches.ndjson        one document per basin reach (gitignored; seed input)
 *   data/out/ign-names.ndjson      one document per IGN name shown on unnamed reaches (search)
 *   data/work/tiles/reaches.geojson  reach lines with the few properties the map styles
 *                                  on (tippecanoe input), clipped out of lakes by
 *                                  pipeline:lakes
 *   data/work/tiles/basin.geojson  basin outline (tippecanoe input, Phase 2)
 *   data/out/report.json           combined report (committed): counts, km, orphans,
 *                                  area check, named rivers
 *
 * Only RiverATLAS fields whose units were checked in the catalog are exported:
 * ele_mt_cmn (m a.s.l.), sgr_dk_rav (dm/km), inu_pc_umn / inu_pc_umx (percent),
 * lka_pc_use (percent × 10), pop_ct_usu (thousands) and dor_pc_pva (percent × 10).
 * bbox is [west, south, east, north] of the reach's HydroRIVERS line.
 * The "upstream*" fields cover the whole watershed upstream of the reach's pour point.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { OUT_DIR, ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import { nameKey, slugify } from "../lib/names";

interface BasinReport {
  ok: boolean;
  areaKm2: {
    polygonSpheroid: number;
    connectedPolygonSpheroid: number;
    diffPct: { vsReference: number };
  };
}
interface RiversReport {
  ok: boolean;
  counts: { reaches: number; connected: number; endorheic: number };
  lengthKm: { total: number; connected: number; endorheic: number };
  topology: { orphans: number };
  gires: { byNetworkAndClass1Day: unknown };
}
interface NamedReport {
  ok: boolean;
  namedKm: number;
  rivers: unknown[];
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(requireInput(file), "utf8")) as T;
}

async function main() {
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const reachGeomFile = requireInput(workPath("lakes/reach_geom.parquet"));
  // IGN names per reach (pipeline:ign-match); run it before this step.
  const ignFile = requireInput(workPath("ign-match/reach_ign.parquet"));
  const tilesDir = workPath("tiles");
  await mkdir(tilesDir, { recursive: true });
  const db = await openDb();

  const reachesNdjson = `${OUT_DIR}/reaches.ndjson`;
  const reachesGeojson = `${tilesDir}/reaches.geojson`;
  const ignNamesNdjson = `${OUT_DIR}/ign-names.ndjson`;
  let counts;
  let ignNamesCheck: {
    names: number;
    uniqueSlugs: boolean;
    keysWithoutSlug: number;
    excludedApprovedRivers: number;
  } | null = null;
  try {
    await db.conn.run(`
      CREATE TABLE out AS
      SELECT r.HYRIV_ID AS _id, m.river, r.network,
             r.NEXT_DOWN AS nextDown, r.MAIN_RIV AS mainRiv,
             round(r.LENGTH_KM::DOUBLE, 2) AS lengthKm, round(r.DIST_DN_KM, 1) AS distanceToSeaKm,
             round(r.UPLAND_SKM, 1) AS uplandKm2, r.ORD_STRA AS strahler,
             round(r.DIS_AV_CMS::DOUBLE, 3) AS dischargeM3s,
             a.ele_mt_cmn AS catchmentMinElevationM,
             round(a.sgr_dk_rav / 10.0, 2) AS gradientMPerKm,
             a.inu_pc_umn AS upstreamFloodedMinPct, a.inu_pc_umx AS upstreamFloodedMaxPct,
             round(a.lka_pc_use / 10.0, 1) AS upstreamLakesPct,
             round(a.pop_ct_usu * 1000)::BIGINT AS upstreamPopulation,
             round(a.dor_pc_pva / 10.0, 1) AS regulationPct,
             r.predcat1 AS nonPerennial1d, round(r.predprob1::DOUBLE, 3) AS nonPerennialProb1d,
             r.predcat30 AS nonPerennial30d, round(r.predprob30::DOUBLE, 3) AS nonPerennialProb30d,
             [round(ST_XMin(r.geom), 5), round(ST_YMin(r.geom), 5),
              round(ST_XMax(r.geom), 5), round(ST_YMax(r.geom), 5)] AS bbox,
             CASE WHEN i.display
                  THEN {name: i.name, confidence: i.confidence, reviewed: i.reviewed}
             END AS ign,
             i.name_key AS ign_key,
             r.geom
      FROM ${lit(reachesFile)} r
      JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      LEFT JOIN ${lit(mappingFile)} m USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(ignFile)}) i USING (HYRIV_ID)`);
    await db.conn.run(`
      COPY (SELECT * EXCLUDE (geom, ign_key) FROM out ORDER BY _id)
      TO ${lit(reachesNdjson)} (FORMAT json)`);
    // Map geometry: reaches that cross a lake use the clipped line from pipeline:lakes;
    // those left with no line are not drawn (their data stays in reaches.ndjson).
    await db.conn.run(`
      COPY (SELECT o._id AS id, o.river, o.network, o.strahler, o.uplandKm2, o.nonPerennial1d,
                   coalesce(g.geom, o.geom) AS geom
            FROM out o LEFT JOIN read_parquet(${lit(reachGeomFile)}) g ON g.HYRIV_ID = o._id
            WHERE g.geom IS NULL OR NOT ST_IsEmpty(g.geom))
      TO ${lit(reachesGeojson)} WITH (FORMAT gdal, DRIVER 'GeoJSON')`);
    [counts] = await db.all(`
      SELECT count(*)::INT AS n, (SELECT count(*) FROM ${lit(reachesFile)})::INT AS source_n,
             sum((river IS NOT NULL)::INT)::INT AS named_n,
             (SELECT count(*) FROM read_parquet(${lit(reachGeomFile)}) WHERE ST_IsEmpty(geom))::INT AS not_drawn_n,
             sum((ign IS NOT NULL)::INT)::INT AS ign_named_n
      FROM out`);

    // IGN names that find reaches: one document per name key, longest reach first.
    // Names of the approved rivers are left out; those are found as rivers.
    const approvedKeys = new Set(
      (
        await readJson<{
          rivers: {
            name: string;
            shortName: string;
            slug?: string;
            aliases?: string[];
          }[];
        }>(`${ROOT}/pipeline/names.json`)
      ).rivers.flatMap((r) => [r.name, ...(r.aliases ?? [])].map(nameKey)),
    );
    const groups = await db.all(`
      SELECT ign_key AS key, any_value(ign.name) AS name, count(*)::INT AS reach_count,
             round(sum(lengthKm), 1) AS length_km, arg_max(_id, lengthKm) AS longest_reach,
             round(min(bbox[1]), 5) AS west, round(min(bbox[2]), 5) AS south,
             round(max(bbox[3]), 5) AS east, round(max(bbox[4]), 5) AS north
      FROM out WHERE ign IS NOT NULL GROUP BY ign_key ORDER BY sum(lengthKm) DESC, ign_key`);
    const ignNames = groups
      .filter((g) => !approvedKeys.has(String(g.key)))
      .map((g) => ({
        _id: slugify(String(g.key)),
        name: String(g.name),
        reachCount: Number(g.reach_count),
        lengthKm: Number(g.length_km),
        longestReach: Number(g.longest_reach),
        bbox: [
          Number(g.west),
          Number(g.south),
          Number(g.east),
          Number(g.north),
        ],
      }));
    const slugCount = new Set(ignNames.map((n) => n._id)).size;
    ignNamesCheck = {
      names: ignNames.length,
      uniqueSlugs: slugCount === ignNames.length,
      keysWithoutSlug: ignNames.filter((n) => n._id === "").length,
      excludedApprovedRivers: groups.length - ignNames.length,
    };
    await writeFile(
      ignNamesNdjson,
      ignNames.map((n) => JSON.stringify(n)).join("\n") + "\n",
    );
  } finally {
    db.close();
  }
  await copyFile(
    requireInput(workPath("basin/basin.geojson")),
    `${tilesDir}/basin.geojson`,
  );

  // Combined report from the step reports.
  const b = await readJson<BasinReport>(workPath("basin/report.json"));
  const r = await readJson<RiversReport>(workPath("rivers/report.json"));
  const n = await readJson<NamedReport>(workPath("named/report.json"));
  const { reference } = await readJson<{ reference: unknown }>(
    `${ROOT}/pipeline/basin.config.json`,
  );

  const checks = {
    basinChecks: b.ok,
    riversChecks: r.ok,
    namedChecks: n.ok,
    zeroOrphanReaches: r.topology.orphans === 0,
    everyReachExported: counts?.n === counts?.source_n,
    ignNamesUnique:
      ignNamesCheck?.uniqueSlugs === true &&
      ignNamesCheck.keysWithoutSlug === 0,
  };
  const summary = {
    ok: Object.values(checks).every(Boolean),
    checks,
    basin: {
      areaKm2: Math.round(b.areaKm2.polygonSpheroid),
      connectedAreaKm2: Math.round(b.areaKm2.connectedPolygonSpheroid),
      reference,
      vsReferencePct: Number(b.areaKm2.diffPct.vsReference.toFixed(2)),
    },
    reaches: {
      total: r.counts.reaches,
      connected: r.counts.connected,
      endorheic: r.counts.endorheic,
      inNamedRivers: counts?.named_n,
      withIgnName: counts?.ign_named_n,
      // Entirely inside a lake, so not drawn on the map (pipeline:lakes); data kept.
      notDrawnInsideLakes: counts?.not_drawn_n,
      orphans: r.topology.orphans,
    },
    lengthKm: {
      total: Number(r.lengthKm.total.toFixed(1)),
      connected: Number(r.lengthKm.connected.toFixed(1)),
      endorheic: Number(r.lengthKm.endorheic.toFixed(1)),
      namedRivers: n.namedKm,
    },
    namedRivers: n.rivers,
    ignNames: ignNamesCheck,
    intermittence: r.gires.byNetworkAndClass1Day,
  };
  const outReport = `${OUT_DIR}/report.json`;
  await writeFile(outReport, JSON.stringify(summary, null, 2) + "\n");
  await writeReport("export", {
    ...summary,
    outputs: [
      rel(reachesNdjson),
      rel(ignNamesNdjson),
      rel(reachesGeojson),
      rel(`${tilesDir}/basin.geojson`),
      rel(outReport),
    ],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
