/**
 * pipeline:export — final Phase 1 artifacts and the combined report.
 *
 *   data/out/reaches.ndjson        one document per basin reach (gitignored; seed input)
 *   data/work/tiles/reaches.geojson  reach lines with the few properties the map styles
 *                                  on (tippecanoe input), clipped out of lakes by
 *                                  pipeline:lakes
 *   data/work/tiles/basin.geojson  basin outline (tippecanoe input, Phase 2)
 *   data/out/report.json           combined report (committed): counts, km, orphans,
 *                                  area check, named rivers
 *
 * Only RiverATLAS fields whose units were checked in the catalog are exported:
 * ele_mt_cmn (m a.s.l.) and sgr_dk_rav (dm/km). Flooded %, lakes %, population and
 * dam regulation need their catalog sheets read first (Phase 3).
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { OUT_DIR, ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

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
  const tilesDir = workPath("tiles");
  await mkdir(tilesDir, { recursive: true });
  const db = await openDb();

  const reachesNdjson = `${OUT_DIR}/reaches.ndjson`;
  const reachesGeojson = `${tilesDir}/reaches.geojson`;
  let counts;
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
             r.predcat1 AS nonPerennial1d, round(r.predprob1::DOUBLE, 3) AS nonPerennialProb1d,
             r.predcat30 AS nonPerennial30d, round(r.predprob30::DOUBLE, 3) AS nonPerennialProb30d,
             r.geom
      FROM ${lit(reachesFile)} r
      JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      LEFT JOIN ${lit(mappingFile)} m USING (HYRIV_ID)`);
    await db.conn.run(`
      COPY (SELECT * EXCLUDE (geom) FROM out ORDER BY _id)
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
             (SELECT count(*) FROM read_parquet(${lit(reachGeomFile)}) WHERE ST_IsEmpty(geom))::INT AS not_drawn_n
      FROM out`);
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
    intermittence: r.gires.byNetworkAndClass1Day,
  };
  const outReport = `${OUT_DIR}/report.json`;
  await writeFile(outReport, JSON.stringify(summary, null, 2) + "\n");
  await writeReport("export", {
    ...summary,
    outputs: [
      rel(reachesNdjson),
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
