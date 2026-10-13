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
 *
 * Reference regions (cba, R3.7) add, and only they (nqn's output is unchanged):
 *   - reach documents: `root` (level-1 sub-basin id of the reach's R3.2 root), `lineReview`
 *     (a displayed line piece matched to the reach is "en revisión" at APRHI) and `mouthKind`
 *     (where its water ends; stream documents too, from the mouth reach);
 *   - distanceToSeaKm null where the flow path ends in an endorheic sink or crosses a
 *     network-overrides.json link (reaches, stream mouths; lib/mouth-kind.ts seaDistance);
 *   - stream documents: `aliases` (pipeline:line-names aliases.json) and sub-basins placed
 *     with data/work/<r>/subbasins/reach_node.parquet (the deepest node owning the mouth reach);
 *   - tiles/reaches.geojson written from the display line pieces (ign.config.json
 *     "mapLines": "pieces") joined with lakes/line_geom.parquet. A matched piece carries its
 *     reach's id, river, stream, network, strahler, nonPerennial1d, uplandKm2 as a reach
 *     does; every piece also `piece` (pieceId), `src` ("aprhi" | "ign"), `km` (the piece's
 *     length before lake clipping), `name` (display name, absent when it has none) and
 *     `review` = 1 when APRHI has the line under review. An unmatched piece has no id and no
 *     strahler.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { loadMapLines } from "../lib/map-lines";
import {
  type NetworkReach,
  mouthKinds,
  overridePaths,
  seaDistance,
} from "../lib/mouth-kind";
import { loadNameSource, nameFile } from "../lib/name-source";
import { regionFile, OUT_DIR, REGION_ID, rel, workPath } from "../lib/paths";
import {
  type AliasesFile,
  pieceDisplayName,
  rawNameIndex,
  streamAliases,
} from "../lib/piece-names";
import { isReferenceRegion } from "../lib/region-mode";
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
  // `name` is added per region in main() (lib/name-source.ts).
  reachCount:
    "pipeline:ign-streams: named reaches plus the unnamed reaches absorbed between them",
  lengthKm: "HydroRIVERS v1.0 LENGTH_KM, summed over the stream's reaches",
  subbasin:
    // Provenance text seeded to Mongo: the old config path stays until the next re-export (Phase R1).
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

/** Provenance that differs or is added in a reference region (R3.7). */
const REFERENCE_STREAM_PROVENANCE = {
  subbasin:
    "Deepest sub-basin node (pipeline:subbasins, reference mode) that owns the stream's mouth reach: the APRHI subcuenca or unidad de gestión hídrica holding at least the reach's reachMinShare of its length, else its basin",
  "mouth.distanceToSeaKm":
    "HydroRIVERS v1.0 DIST_DN_KM at the mouth reach; null when the flow path ends in an endorheic sink (it would measure the distance to the sink, not to the sea) or crosses a link of regions/<id>/network-overrides.json (it would measure to the end HydroRIVERS had, and the link is not a channel)",
  mouthKind:
    "End of the flow path from the mouth reach along NEXT_DOWN (pipeline:rivers, edited at the region's edge and by network-overrides.json): region-edge = next_down_edit 'outside'; sink = HydroRIVERS ENDORHEIC = 1 or the endorheic network; sea otherwise",
  aliases:
    "pipeline:line-names aliases.json for the stream's name: the source's raw spellings, names in parentheses and names of the other agency's lines that run along it, without the name shown",
};

async function main() {
  const reference = await isReferenceRegion();
  const mapLines = await loadMapLines();
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  // Map geometry clipped out of lakes by pipeline:lakes: per reach (nqn) or per line piece (cba).
  const reachGeomFile =
    mapLines === "reaches"
      ? requireInput(workPath("lakes/reach_geom.parquet"))
      : null;
  const linesFile = reference
    ? requireInput(workPath("lines/lines.parquet"))
    : null;
  const lineGeomFile =
    mapLines === "pieces"
      ? requireInput(workPath("lakes/line_geom.parquet"))
      : null;
  // Names per reach, from the step the region's ign.config.json names (namesFrom); run it
  // before this step.
  const nameSource = await loadNameSource();
  const ignFile = requireInput(nameFile(nameSource, "reach_ign.parquet"));
  // Streams (pipeline:ign-streams) and the sub-basin / river inputs that place their mouths.
  const streamsFile = requireInput(workPath("ign-streams/streams.json"));
  // Named reaches off every IGN line (pipeline:ign-streams): their IGN name is not shown.
  const droppedFile = requireInput(workPath("ign-streams/dropped.json"));
  const riversNdjson = requireInput(`${OUT_DIR}/rivers.ndjson`);
  const streams = await readJson<StreamsFileEntry[]>(streamsFile);
  // Sub-basins: the nodes of the config (nqn), or in reference mode (cba, R3.5) the nodes
  // of data/out/<r>/subbasins.ndjson, which place a stream by the deepest node owning its
  // mouth reach (subbasins/reach_node.parquet).
  const subbasinsConfig = await readJson<{
    mode?: string;
    subbasins?: SubbasinNode[];
  }>(regionFile("subbasins.config.json"));
  const subbasinsFromReference = subbasinsConfig.mode === "reference";
  const reachNodeFile = subbasinsFromReference
    ? requireInput(workPath("subbasins/reach_node.parquet"))
    : null;
  if (!subbasinsFromReference && !subbasinsConfig.subbasins)
    throw new Error(
      `regions/${REGION_ID}/subbasins.config.json has no "subbasins" array and is not "mode": "reference"`,
    );
  const subbasinNodes = subbasinsConfig.subbasins ?? [];
  const rivers = subbasinsFromReference
    ? []
    : (await readFile(riversNdjson, "utf8"))
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as { _id: string; mouthReach: number });
  const nodeByMouth = subbasinsFromReference
    ? new Map<number, string>()
    : subbasinMouths(subbasinNodes, rivers);
  const endorheicNode =
    subbasinNodes.find((n) => n.kind === "endorheic")?.id ?? null;
  const aliasesFile: AliasesFile | null =
    nameSource.id === "line-names" && reference
      ? await readJson<AliasesFile>(nameFile(nameSource, "aliases.json"))
      : null;
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
  let pieceCounts: Record<string, unknown> | undefined;
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
    // Reference regions: per reach, the level-1 sub-basin of its root, where its water ends
    // (lib/mouth-kind.ts) and whether a matched line piece is under review (APRHI).
    if (reference) {
      const ids = await readJson<{ level1: Record<string, string> }>(
        regionFile("subbasin-ids.json"),
      );
      const rows = await db.all(`
        SELECT HYRIV_ID, NEXT_DOWN, next_down_edit, ENDORHEIC, network, root, DIST_DN_KM
        FROM read_parquet(${lit(reachesFile)})`);
      const network = rows.map((r): NetworkReach => ({
        id: Number(r.HYRIV_ID),
        nextDown: Number(r.NEXT_DOWN),
        nextDownEdit:
          r.next_down_edit == null ? null : String(r.next_down_edit),
        endorheic: Number(r.ENDORHEIC) === 1,
        network: String(r.network),
      }));
      const kinds = mouthKinds(network);
      const overridden = overridePaths(network);
      const refRows = rows.map((r) => {
        const root = ids.level1[String(r.root)];
        if (root === undefined)
          throw new Error(
            `reach ${r.HYRIV_ID}: root ${String(r.root)} is not in subbasin-ids.json level1`,
          );
        const id = Number(r.HYRIV_ID);
        const mouthKind = kinds.get(id);
        return {
          HYRIV_ID: id,
          root,
          mouthKind,
          distanceToSeaKm: seaDistance(
            mouthKind,
            overridden.has(id),
            Number(r.DIST_DN_KM),
          ),
        };
      });
      const refFile = workPath("export/reach_ref.json");
      await writeFile(refFile, JSON.stringify(refRows));
      await db.conn.run(`
        CREATE TABLE ref AS
        SELECT f.HYRIV_ID, f.root, f.mouthKind, f.distanceToSeaKm,
               (v.reach IS NOT NULL) AS lineReview
        FROM read_json(${lit(refFile)},
                       columns = {HYRIV_ID: 'BIGINT', root: 'VARCHAR', mouthKind: 'VARCHAR',
                                  distanceToSeaKm: 'DOUBLE'}) f
        LEFT JOIN (SELECT DISTINCT reach FROM read_parquet(${lit(linesFile!)})
                   WHERE status = 'en-revision' AND reach IS NOT NULL) v
          ON v.reach = f.HYRIV_ID`);
    }
    await db.conn.run(`
      CREATE TABLE out AS
      SELECT r.HYRIV_ID AS _id, m.river, r.network,
             r.NEXT_DOWN AS nextDown, r.MAIN_RIV AS mainRiv,
             round(r.LENGTH_KM::DOUBLE, 2) AS lengthKm, ${
               reference
                 ? "round(rf.distanceToSeaKm, 1)"
                 : "round(r.DIST_DN_KM, 1)"
             } AS distanceToSeaKm,
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
             CASE WHEN i.display AND d.HYRIV_ID IS NULL
                  THEN {name: i.name, confidence: i.confidence, reviewed: i.reviewed}
             END AS ign,
             rs.stream AS stream,
             ${reference ? "rf.root AS root, rf.lineReview AS lineReview, rf.mouthKind AS mouthKind," : ""}
             r.LENGTH_KM::DOUBLE AS length_raw,
             r.geom
      FROM ${lit(reachesFile)} r
      JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      LEFT JOIN ${lit(mappingFile)} m USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(ignFile)}) i USING (HYRIV_ID)
      LEFT JOIN read_json(${lit(droppedFile)},
                          columns = {HYRIV_ID: 'BIGINT', nameKey: 'VARCHAR'}) d
        USING (HYRIV_ID)
      LEFT JOIN read_json(${lit(reachStreamFile)},
                          columns = {HYRIV_ID: 'BIGINT', stream: 'VARCHAR'}) rs
        USING (HYRIV_ID)
      ${reference ? "LEFT JOIN ref rf ON rf.HYRIV_ID = r.HYRIV_ID" : ""}`);
    await db.conn.run(`
      COPY (SELECT * EXCLUDE (geom, length_raw) FROM out ORDER BY _id)
      TO ${lit(reachesNdjson)} (FORMAT json)`);
    // Map geometry: reaches that cross a lake use the clipped line from pipeline:lakes;
    // those left with no line are not drawn (their data stays in reaches.ndjson).
    if (reachGeomFile !== null) {
      await db.conn.run(`
        COPY (SELECT o._id AS id, o.river, o.stream, o.network, o.strahler, o.uplandKm2, o.nonPerennial1d,
                     coalesce(g.geom, o.geom) AS geom
              FROM out o LEFT JOIN read_parquet(${lit(reachGeomFile)}) g ON g.HYRIV_ID = o._id
              WHERE g.geom IS NULL OR NOT ST_IsEmpty(g.geom))
        TO ${lit(reachesGeojson)} WITH (FORMAT gdal, DRIVER 'GeoJSON')`);
    } else {
      // Display line pieces (R3.7). A piece matched to a reach carries that reach's values;
      // the geometry is the piece clipped out of lakes (lakes/line_geom.parquet), and a piece
      // left with no line is not drawn. Names: the display name pipeline:line-names decided.
      if (!aliasesFile || !linesFile || !lineGeomFile)
        throw new Error(
          'mapLines "pieces" needs namesFrom "line-names" and the display lines (pipeline:lines)',
        );
      const index = rawNameIndex(aliasesFile);
      const pieceRows = await db.all(
        `SELECT pieceId, source, name FROM read_parquet(${lit(linesFile)})`,
      );
      const pieceNames = pieceRows.flatMap((r) => {
        const name = pieceDisplayName(
          {
            source: String(r.source),
            name: r.name == null ? null : String(r.name),
          },
          index,
        );
        return name === null ? [] : [{ pieceId: String(r.pieceId), name }];
      });
      const pieceNameFile = workPath("export/piece_name.json");
      await writeFile(pieceNameFile, JSON.stringify(pieceNames));
      await db.conn.run(`
        CREATE TABLE piece_name AS
        SELECT * FROM read_json(${lit(pieceNameFile)},
                                columns = {pieceId: 'VARCHAR', name: 'VARCHAR'})`);
      await db.conn.run(`
        CREATE TABLE pieces AS
        SELECT l.pieceId, l.reach, l.source, l.class, l.status, l.length_m,
               o._id AS reach_found,
               o.river, o.stream, o.network, o.strahler, o.uplandKm2, o.nonPerennial1d,
               pn.name,
               coalesce(ST_SetCRS(g.geom, 'EPSG:4326'), ST_SetCRS(l.geom, 'EPSG:4326')) AS geom,
               coalesce(ST_IsEmpty(g.geom), false) AS not_drawn
        FROM read_parquet(${lit(linesFile)}) l
        LEFT JOIN out o ON o._id = l.reach
        LEFT JOIN piece_name pn ON pn.pieceId = l.pieceId
        LEFT JOIN read_parquet(${lit(lineGeomFile)}) g ON g.pieceId = l.pieceId`);
      await db.conn.run(`
        COPY (SELECT reach AS id, river, stream, network, strahler, uplandKm2, nonPerennial1d,
                     pieceId AS piece, source AS src, class AS cls,
                     round(length_m / 1000.0, 3) AS km, name,
                     CASE WHEN status = 'en-revision' THEN 1 END AS review, geom
              FROM pieces WHERE NOT not_drawn ORDER BY pieceId)
        TO ${lit(reachesGeojson)} WITH (FORMAT gdal, DRIVER 'GeoJSON')`);
      [pieceCounts] = await db.all(`
        SELECT count(*)::INT AS pieces,
               sum((reach IS NOT NULL)::INT)::INT AS matched,
               sum((reach IS NOT NULL AND reach_found IS NULL)::INT)::INT AS matched_missing,
               sum(not_drawn::INT)::INT AS not_drawn,
               sum((status = 'en-revision')::INT)::INT AS review,
               sum((name IS NOT NULL)::INT)::INT AS named,
               (SELECT count(*) FROM read_parquet(${lit(lineGeomFile)}))::INT AS line_geom_rows,
               (SELECT count(*) FROM read_parquet(${lit(lineGeomFile)}) g
                  WHERE g.pieceId NOT IN (SELECT pieceId FROM pieces))::INT AS line_geom_unknown,
               round(sum(length_m) / 1000.0, 1) AS km,
               round(sum(length_m) FILTER (reach IS NULL) / 1000.0, 1) AS unmatched_km,
               round(sum(length_m) FILTER (source = 'aprhi') / 1000.0, 1) AS aprhi_km,
               round(sum(length_m) FILTER (source = 'ign') / 1000.0, 1) AS ign_km
        FROM pieces`);
    }
    [counts] = await db.all(`
      SELECT count(*)::INT AS n, (SELECT count(*) FROM ${lit(reachesFile)})::INT AS source_n,
             sum((river IS NOT NULL)::INT)::INT AS named_n,
             ${
               reachGeomFile !== null
                 ? `(SELECT count(*) FROM read_parquet(${lit(reachGeomFile)}) WHERE ST_IsEmpty(geom))::INT`
                 : "NULL::INT"
             } AS not_drawn_n,
             sum((ign IS NOT NULL)::INT)::INT AS ign_named_n
      FROM out`);

    // Streams (pipeline:ign-streams): one document per stream, with the values of its
    // mouth reach. Their length is the sum of LENGTH_KM, rounded once, as in pipeline:named.
    const mouthIds = streams.map((s) => s.mouthReach);
    const mouthRows = await db.all(`
      SELECT _id, catchmentMinElevationM, dischargeM3s, uplandKm2, distanceToSeaKm, strahler,
             ${reference ? "mouthKind," : ""}
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
    // Reference mode: a stream belongs to the deepest sub-basin node that owns its mouth reach.
    const ownerByReach = new Map<number, string>();
    if (reachNodeFile !== null)
      for (const r of await db.all(
        `SELECT HYRIV_ID, node FROM read_parquet(${lit(reachNodeFile)})`,
      ))
        ownerByReach.set(Number(r.HYRIV_ID), String(r.node));
    const docs = streams.flatMap((s) => {
      const m = mouthById.get(s.mouthReach);
      const t = totalById.get(s.id);
      if (!m || !t) return [];
      const drainage = streamDrainage(s.mouthReach, drainNet);
      const receivingRiver = drainage.receivingRiver;
      const subbasin =
        reachNodeFile !== null
          ? (ownerByReach.get(s.mouthReach) ?? null)
          : drainage.subbasin;
      const aliases = aliasesFile ? streamAliases(s.name, aliasesFile) : [];
      return [
        {
          _id: s.id,
          name: s.name,
          mouthReach: s.mouthReach,
          reachCount: Number(t.n),
          lengthKm: round(Number(t.km)),
          subbasin,
          receivingRiver,
          ...(reference ? { mouthKind: String(m.mouthKind) } : {}),
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
          ...(aliases.length > 0 ? { aliases } : {}),
          modeled: STREAM_MODELED,
          provenance: {
            name: nameSource.streamNameProvenance,
            ...STREAM_PROVENANCE,
            ...(reference ? REFERENCE_STREAM_PROVENANCE : {}),
          },
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
  const { reference: basinReference } = await readJson<{ reference: unknown }>(
    regionFile("basin.config.json"),
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
    // Display line pieces (mapLines "pieces"): every piece is drawn or inside a lake, every
    // matched piece points at an exported reach, and the lake file knows only real pieces.
    ...(pieceCounts
      ? {
          everyPieceDrawnOrInLake:
            Number(pieceCounts.pieces) > 0 &&
            Number(pieceCounts.line_geom_unknown) === 0,
          everyMatchedPieceHasReach: Number(pieceCounts.matched_missing) === 0,
        }
      : {}),
  };
  const summary = {
    ok: Object.values(checks).every(Boolean),
    checks,
    basin: {
      areaKm2: Math.round(b.areaKm2.polygonSpheroid),
      connectedAreaKm2: Math.round(b.areaKm2.connectedPolygonSpheroid),
      reference: basinReference,
      vsReferencePct: Number(b.areaKm2.diffPct.vsReference.toFixed(2)),
    },
    reaches: {
      total: r.counts.reaches,
      connected: r.counts.connected,
      endorheic: r.counts.endorheic,
      inNamedRivers: counts?.named_n,
      withIgnName: counts?.ign_named_n,
      // IGN name not shown: off every IGN line (pipeline:ign-streams dropped.json).
      ignNameHiddenOffLine: (await readJson<unknown[]>(droppedFile)).length,
      // Entirely inside a lake, so not drawn on the map (pipeline:lakes); data kept.
      // (With map line pieces the count is of pieces, under `lines`.)
      ...(reachGeomFile !== null
        ? { notDrawnInsideLakes: counts?.not_drawn_n }
        : {}),
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
    ...(pieceCounts
      ? {
          lines: {
            pieces: pieceCounts.pieces,
            drawn: Number(pieceCounts.pieces) - Number(pieceCounts.not_drawn),
            notDrawnInsideLakes: pieceCounts.not_drawn,
            matchedToAReach: pieceCounts.matched,
            unmatched: Number(pieceCounts.pieces) - Number(pieceCounts.matched),
            underReview: pieceCounts.review,
            withName: pieceCounts.named,
            km: pieceCounts.km,
            unmatchedKm: pieceCounts.unmatched_km,
            aprhiKm: pieceCounts.aprhi_km,
            ignKm: pieceCounts.ign_km,
          },
        }
      : {}),
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
