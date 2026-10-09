/**
 * pipeline:export — final Phase 1 artifacts and the combined report.
 *
 *   data/out/reaches.ndjson        one document per basin reach (gitignored; seed input)
 *   data/out/streams.ndjson        one document per IGN stream (pipeline:ign-streams): search,
 *                                  panel; mouth-reach values like rivers.ndjson
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
 * `stream` on each reach (ndjson and tile GeoJSON) is its stream id from
 * pipeline:ign-streams, null when it is in none; it can be set together with `river`.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { OUT_DIR, ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import {
  type SubbasinNode,
  streamDrainage,
  subbasinMouths,
} from "../lib/streams";

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
/** One entry of data/work/ign-streams/streams.json (pipeline:ign-streams). */
interface StreamsFileEntry {
  id: string;
  name: string;
  mouthReach: number;
  reachIds: number[];
}
interface NamedReport {
  ok: boolean;
  namedKm: number;
  rivers: unknown[];
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(requireInput(file), "utf8")) as T;
}

/** Rounds like pipeline:named, which sums LENGTH_KM and rounds the total once. */
const round = (x: number, digits = 1) => Number(x.toFixed(digits));

/**
 * A DuckDB value as a number, keeping null as null so the seed's schema rejects a missing
 * value instead of storing 0 (CLAUDE.md rule 2).
 */
const orNull = (v: unknown) => (v == null ? null : Number(v));

const STREAM_PROVENANCE = {
  name: "pipeline:ign-streams: most frequent IGN spelling of the stream's name (pipeline:ign-match)",
  reachCount:
    "pipeline:ign-streams: named reaches plus the unnamed reaches absorbed between them",
  lengthKm: "HydroRIVERS v1.0 LENGTH_KM, summed over the stream's reaches",
  subbasin:
    "First sub-basin mouth reach (data/out/rivers.ndjson mouthReach of each river node in pipeline/subbasins.config.json) on the way down from the stream's mouth reach along HydroRIVERS NEXT_DOWN; the endorheic node for endorheic mouths",
  receivingRiver:
    "First approved-river reach (pipeline:named) strictly downstream of the mouth reach along HydroRIVERS NEXT_DOWN",
  "mouth.elevationM":
    "RiverATLAS v1.0 ele_mt_cmn of the mouth reach (EarthEnv-DEM90)",
  "mouth.dischargeM3s":
    "HydroRIVERS v1.0 DIS_AV_CMS at the mouth reach; modeled natural long-term average 1971–2000 (WaterGAP), does not reflect dam regulation",
  "mouth.uplandKm2": "HydroRIVERS v1.0 UPLAND_SKM at the mouth reach",
  "mouth.distanceToSeaKm": "HydroRIVERS v1.0 DIST_DN_KM at the mouth reach",
  "mouth.strahler": "HydroRIVERS v1.0 ORD_STRA at the mouth reach",
  "mouth.regulationPct":
    "RiverATLAS v1.0 dor_pc_pva / 10 at the mouth reach: degree of regulation, reservoir storage of GRanD v1.1 dams upstream as a percent of the modeled natural annual flow (capped at 1000 %)",
  "watershed.floodedMinPct":
    "RiverATLAS v1.0 inu_pc_umn at the mouth reach: mean annual minimum inundation extent of the upstream watershed, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  "watershed.floodedMaxPct":
    "RiverATLAS v1.0 inu_pc_umx at the mouth reach: mean annual maximum inundation extent of the upstream watershed, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  "watershed.lakesPct":
    "RiverATLAS v1.0 lka_pc_use / 10 at the mouth reach: percent lake area of the upstream watershed (HydroLAKES)",
  "watershed.population":
    "RiverATLAS v1.0 pop_ct_usu × 1000 at the mouth reach: population of the upstream watershed, GPWv4 estimate for 2010",
  bbox: "Union of the HydroRIVERS line extents of the stream's reaches",
};

/** Values of `mouth` and `watershed` that are modeled or estimated (CLAUDE.md rule 4). */
const STREAM_MODELED = [
  "mouth.dischargeM3s",
  "mouth.regulationPct",
  "watershed.floodedMinPct",
  "watershed.floodedMaxPct",
  "watershed.population",
];

async function main() {
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const reachGeomFile = requireInput(workPath("lakes/reach_geom.parquet"));
  // IGN names per reach (pipeline:ign-match); run it before this step.
  const ignFile = requireInput(workPath("ign-match/reach_ign.parquet"));
  // Streams (pipeline:ign-streams) and the sub-basin / river inputs that place their mouths.
  const streamsFile = requireInput(workPath("ign-streams/streams.json"));
  const riversNdjson = requireInput(`${OUT_DIR}/rivers.ndjson`);
  const streams = await readJson<StreamsFileEntry[]>(streamsFile);
  const subbasinNodes = (
    await readJson<{ subbasins: SubbasinNode[] }>(
      `${ROOT}/pipeline/subbasins.config.json`,
    )
  ).subbasins;
  const rivers = (await readFile(riversNdjson, "utf8"))
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { _id: string; mouthReach: number });
  const nodeByMouth = subbasinMouths(subbasinNodes, rivers);
  const endorheicNode =
    subbasinNodes.find((n) => n.kind === "endorheic")?.id ?? null;
  const tilesDir = workPath("tiles");
  await mkdir(tilesDir, { recursive: true });
  const db = await openDb();

  const reachesNdjson = `${OUT_DIR}/reaches.ndjson`;
  const reachesGeojson = `${tilesDir}/reaches.geojson`;
  const streamsNdjson = `${OUT_DIR}/streams.ndjson`;
  const reachStreamFile = workPath("export/reach_stream.json");
  await mkdir(workPath("export"), { recursive: true });
  await writeFile(
    reachStreamFile,
    JSON.stringify(
      streams.flatMap((s) =>
        s.reachIds.map((id) => ({ HYRIV_ID: id, stream: s.id })),
      ),
    ),
  );
  let counts;
  let streamsCheck: {
    streams: number;
    reachesInStreams: number;
    reachesOnStreamsAndRivers: number;
    uniqueValidIds: boolean;
    everyReachExported: boolean;
    reachCountsMatch: boolean;
    mouthsInStreams: boolean;
    reachesTaggedMatchFile: boolean;
    everyStreamHasSubbasin: boolean;
    withoutReceivingRiver: number;
    bySubbasin: Record<string, number>;
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
             rs.stream AS stream,
             r.LENGTH_KM::DOUBLE AS length_raw,
             r.geom
      FROM ${lit(reachesFile)} r
      JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      LEFT JOIN ${lit(mappingFile)} m USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(ignFile)}) i USING (HYRIV_ID)
      LEFT JOIN read_json(${lit(reachStreamFile)},
                          columns = {HYRIV_ID: 'BIGINT', stream: 'VARCHAR'}) rs
        USING (HYRIV_ID)`);
    await db.conn.run(`
      COPY (SELECT * EXCLUDE (geom, length_raw) FROM out ORDER BY _id)
      TO ${lit(reachesNdjson)} (FORMAT json)`);
    // Map geometry: reaches that cross a lake use the clipped line from pipeline:lakes;
    // those left with no line are not drawn (their data stays in reaches.ndjson).
    await db.conn.run(`
      COPY (SELECT o._id AS id, o.river, o.stream, o.network, o.strahler, o.uplandKm2, o.nonPerennial1d,
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

    // Streams (pipeline:ign-streams): one document per stream, with the values of its
    // mouth reach. Their length is the sum of LENGTH_KM, rounded once, as in pipeline:named.
    const mouthIds = streams.map((s) => s.mouthReach);
    const mouthRows = await db.all(`
      SELECT _id, catchmentMinElevationM, dischargeM3s, uplandKm2, distanceToSeaKm, strahler,
             regulationPct, upstreamFloodedMinPct, upstreamFloodedMaxPct,
             upstreamLakesPct, upstreamPopulation
      FROM out WHERE _id IN (${mouthIds.length ? mouthIds.join(",") : "NULL"})`);
    const mouthById = new Map(mouthRows.map((m) => [Number(m._id), m]));
    const totals = await db.all(`
      SELECT stream, count(*)::INT AS n, sum(length_raw) AS km,
             min(bbox[1]) AS west, min(bbox[2]) AS south,
             max(bbox[3]) AS east, max(bbox[4]) AS north,
             sum((river IS NOT NULL)::INT)::INT AS on_rivers
      FROM out WHERE stream IS NOT NULL GROUP BY stream`);
    const totalById = new Map(totals.map((t) => [String(t.stream), t]));
    const net = await db.all(`SELECT _id, nextDown, network, river FROM out`);
    const drainNet = {
      nextDown: new Map(net.map((r) => [Number(r._id), Number(r.nextDown)])),
      river: new Map(
        net.flatMap((r) =>
          r.river == null ? [] : [[Number(r._id), String(r.river)] as const],
        ),
      ),
      endorheic: new Set(
        net.filter((r) => r.network === "endorheic").map((r) => Number(r._id)),
      ),
      nodeByMouth,
      endorheicNode,
    };
    const docs = streams.flatMap((s) => {
      const m = mouthById.get(s.mouthReach);
      const t = totalById.get(s.id);
      if (!m || !t) return [];
      const { subbasin, receivingRiver } = streamDrainage(
        s.mouthReach,
        drainNet,
      );
      return [
        {
          _id: s.id,
          name: s.name,
          mouthReach: s.mouthReach,
          reachCount: Number(t.n),
          lengthKm: round(Number(t.km)),
          subbasin,
          receivingRiver,
          mouth: {
            elevationM: orNull(m.catchmentMinElevationM),
            dischargeM3s: orNull(m.dischargeM3s),
            uplandKm2: orNull(m.uplandKm2),
            distanceToSeaKm: orNull(m.distanceToSeaKm),
            strahler: orNull(m.strahler),
            regulationPct: orNull(m.regulationPct),
          },
          watershed: {
            floodedMinPct: orNull(m.upstreamFloodedMinPct),
            floodedMaxPct: orNull(m.upstreamFloodedMaxPct),
            lakesPct: orNull(m.upstreamLakesPct),
            population: orNull(m.upstreamPopulation),
          },
          bbox: [
            round(Number(t.west), 5),
            round(Number(t.south), 5),
            round(Number(t.east), 5),
            round(Number(t.north), 5),
          ],
          modeled: STREAM_MODELED,
          provenance: STREAM_PROVENANCE,
        },
      ];
    });
    const bySubbasin: Record<string, number> = {};
    for (const d of docs) {
      const k = d.subbasin ?? "none";
      bySubbasin[k] = (bySubbasin[k] ?? 0) + 1;
    }
    const taggedInOut = totals.reduce((n, t) => n + Number(t.n), 0);
    streamsCheck = {
      streams: docs.length,
      reachesInStreams: taggedInOut,
      reachesOnStreamsAndRivers: totals.reduce(
        (n, t) => n + Number(t.on_rivers),
        0,
      ),
      // A slug part is required ("-123" would be a name that slugifies to nothing); the
      // length limit is the API's (lib/data/params.ts parseStreamId).
      uniqueValidIds:
        new Set(streams.map((s) => s.id)).size === streams.length &&
        streams.every((s) => /^[a-z0-9][a-z0-9-]{0,127}$/.test(s.id)),
      everyReachExported: docs.length === streams.length,
      reachCountsMatch: streams.every(
        (s) => Number(totalById.get(s.id)?.n) === s.reachIds.length,
      ),
      mouthsInStreams: streams.every((s) => s.reachIds.includes(s.mouthReach)),
      // No reach in two streams, so the tagged total equals the file's total.
      reachesTaggedMatchFile:
        taggedInOut === streams.reduce((n, s) => n + s.reachIds.length, 0),
      everyStreamHasSubbasin: docs.every((d) => d.subbasin !== null),
      withoutReceivingRiver: docs.filter((d) => d.receivingRiver === null)
        .length,
      bySubbasin,
    };
    await writeFile(
      streamsNdjson,
      docs.map((d) => JSON.stringify(d)).join("\n") + "\n",
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
    streamIdsUnique: streamsCheck?.uniqueValidIds === true,
    everyStreamExported:
      streamsCheck?.everyReachExported === true &&
      streamsCheck.reachCountsMatch &&
      streamsCheck.mouthsInStreams,
    noReachInTwoStreams: streamsCheck?.reachesTaggedMatchFile === true,
    everyStreamHasSubbasin: streamsCheck?.everyStreamHasSubbasin === true,
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
    streams: streamsCheck,
    intermittence: r.gires.byNetworkAndClass1Day,
  };
  const outReport = `${OUT_DIR}/report.json`;
  await writeFile(outReport, JSON.stringify(summary, null, 2) + "\n");
  await writeReport("export", {
    ...summary,
    outputs: [
      rel(reachesNdjson),
      rel(streamsNdjson),
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
