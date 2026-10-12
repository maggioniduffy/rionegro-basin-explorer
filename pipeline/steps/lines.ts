/**
 * pipeline:lines — the lines the map displays (R3.3; DECISSIONS.md "R3 plan"). Needs
 * regions/<id>/lines.config.json; a region without it stops with a message.
 *
 * Precedence APRHI > IGN > HydroRIVERS (owner). Inside the province edge the lines are the
 * provincial agency's (APRHI CursosDeAgua, status "Eliminado" dropped); outside the edge but
 * inside the region outline they are IGN's (perennial and intermittent, config ign.classes).
 * The edge is the union of basin.config.json's clippedLayer, the same one pipeline:basin
 * (reference mode) uses; lines are cut exactly at it. Files and fields are read as
 * pipeline:lines-gate reads them (gate.config.json referenceLines, EPSG:22174 with always_xy).
 *
 * 1. Clip: APRHI ∩ edge; IGN \ edge ∩ outline. Exact duplicate geometries are dropped first.
 * 2. Root: a line is split at the root borders (data/work/<id>/basin/basins.geojson); each
 *    resulting linestring is a "line" (lineId = source:sourceId:part).
 * 3. Reaches: each line is cut into equal parts of about partM metres (South America Albers).
 *    A part takes the nearest reach of its own root within that reach's buffer of its midpoint
 *    (ties by HYRIV_ID), else none: bufferM, or bufferLargeM for reaches of Strahler order
 *    largeMinStrahler and up, whose 15″ paths drift further from the mapped channel. Consecutive parts with one reach become a piece; a piece shorter
 *    than minPieceM between two pieces of one reach joins them (lib/lines.ts).
 *
 * Output: data/work/<id>/lines/lines.parquet (pieceId, lineId, source, sourceId, name, class,
 * status, root, reach, network, strahler, length_m, geom EPSG:4326) and report.json with the
 * checks and the statistics. Distances are Albers (a few percent off); lengths are spheroid.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { layerTable, type LayerConfig } from "../lib/basin-reference";
import { type Row, lit, openDb, limitResources } from "../lib/duckdb";
import { envelope, lengthSpheroidKm } from "../lib/geo";
import {
  ALBERS,
  IGN_LINE_LAYERS,
  IGN_ST_READ_OPTIONS,
  createNameMap,
} from "../lib/ign";
import { requireInput } from "../lib/inputs";
import { round } from "../lib/lines-gate";
import { type StatusRules, mapStatus, pieceRuns } from "../lib/lines";
import { rawPath, regionFile, rel, REGION_ID, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface LinesConfig {
  aprhi: { dropStatus: string[]; statusMap: Record<string, string> };
  ign: { classes: string[] };
  partM: number;
  bufferM: number;
  bufferLargeM: number;
  largeMinStrahler: number;
  minPieceM: number;
  edgeToleranceM: number;
  conservationPct: number;
  hiddenMinStrahler: number;
}
interface GateConfig {
  referenceLines: {
    path: string;
    srs: string;
    nameField: string;
    classField: string;
    statusField: string;
  };
}

/** Grid cell (m) for the part/reach prefilter; any value works, the exact distance decides. */
const CELL_M = 5000;
/** Metres per degree at the equator: converts the edge tolerance for buffers in EPSG:4326. */
const M_PER_DEG = 111_320;
const TOP = 10;

const num = (v: unknown) => Number(v ?? 0);
const ident = (s: string) => {
  if (!/^\w+$/.test(s)) throw new Error(`unsafe column name in config: ${s}`);
  return s;
};
const toWgs84 = (g: string, srs: string) =>
  srs === "EPSG:4326"
    ? g
    : `ST_Transform(${g}, ${lit(srs)}, 'EPSG:4326', always_xy := true)`;
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
const fromAlbers = (g: string) =>
  `ST_Transform(${g}, ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)`;
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function main() {
  const configFile = regionFile("lines.config.json");
  if (!existsSync(configFile)) {
    console.error(
      `pipeline:lines has no settings for region "${REGION_ID}" (${rel(configFile)} missing); nothing to do.`,
    );
    process.exit(1);
  }
  const config = JSON.parse(await readFile(configFile, "utf8")) as LinesConfig;
  const gate = JSON.parse(
    await readFile(regionFile("gate.config.json"), "utf8"),
  ) as GateConfig;
  const basinConfig = JSON.parse(
    await readFile(regionFile("basin.config.json"), "utf8"),
  ) as {
    clippedLayer: LayerConfig;
    searchBbox: Parameters<typeof envelope>[0];
  };
  const ref = gate.referenceLines;
  const refFile = requireInput(rawPath(ref.path));
  const ignLayers = config.ign.classes.map((cls) => {
    const l = IGN_LINE_LAYERS.find((x) => x.cls === cls);
    if (!l) throw new Error(`ign.classes: unknown IGN class "${cls}"`);
    return { ...l, shp: requireInput(l.shp) };
  });
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const basinDir = workPath("basin");
  for (const f of ["basin.geojson", "basins.geojson"])
    requireInput(`${basinDir}/${f}`);

  const outDir = workPath("lines");
  const parquet = `${outDir}/lines.parquet`;
  await mkdir(outDir, { recursive: true });
  const previousSha = existsSync(parquet) ? await sha256(parquet) : null;

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const tolDeg = config.edgeToleranceM / M_PER_DEG;

  try {
    // 1. Province edge, region outline and roots.
    await layerTable(db, "clipped", basinConfig.clippedLayer);
    await db.conn.run(
      `CREATE TABLE prov AS SELECT ST_Union_Agg(geom) AS geom FROM clipped`,
    );
    await db.conn.run(`
      CREATE TABLE outline AS
      SELECT ST_Union_Agg(geom) AS geom FROM ST_Read(${lit(`${basinDir}/basin.geojson`)})`);
    await db.conn.run(`
      CREATE TABLE roots AS
      SELECT CAST(code AS VARCHAR) AS code, geom FROM ST_Read(${lit(`${basinDir}/basins.geojson`)})`);
    const rootCodes = (
      await db.all(`SELECT code FROM roots ORDER BY code`)
    ).map((r) => String(r.code));
    log(`roots ${rootCodes.join(",")}`);
    const bbox = envelope(basinConfig.searchBbox);

    // 2. APRHI lines touching the province.
    const nameF = ident(ref.nameField);
    const classF = ident(ref.classField);
    const statusF = ident(ref.statusField);
    await db.conn.run(`
      CREATE TABLE a_raw AS
      SELECT * FROM (
        SELECT CAST(ID AS BIGINT) AS id, NULLIF(trim(${nameF}), '') AS name, ${classF} AS class,
               ${statusF} AS st_raw,
               ST_Force2D(${toWgs84("geom", ref.srs)}) AS geom
        FROM ST_Read(${lit(`/vsizip/${refFile}`)})) t
      WHERE ST_Intersects(t.geom, (SELECT geom FROM prov))`);
    const rules: StatusRules = {
      drop: config.aprhi.dropStatus,
      map: config.aprhi.statusMap,
    };
    await db.conn.run(
      `CREATE TABLE st_map (raw VARCHAR, dropped BOOLEAN, status VARCHAR)`,
    );
    const statusValues = await db.all(
      `SELECT st_raw AS v, count(*) AS n FROM a_raw GROUP BY 1 ORDER BY 1 NULLS FIRST`,
    );
    const statusRaw: { value: string | null; n: number; action: string }[] = [];
    for (const r of statusValues) {
      const v = (r.v as string | null) ?? null;
      const m = mapStatus(v, rules);
      if (m.kind === "unknown")
        throw new Error(
          `APRHI status "${v}" has no rule in lines.config.json (aprhi.dropStatus / statusMap)`,
        );
      statusRaw.push({
        value: v,
        n: num(r.n),
        action: m.kind === "drop" ? "dropped" : `kept as ${m.status ?? "null"}`,
      });
      await db.conn.run(
        `INSERT INTO st_map VALUES (${lit(v ?? "")}, ${m.kind === "drop"}, ${
          m.kind === "keep" && m.status !== null ? lit(m.status) : "NULL"
        })`,
      );
    }
    // Ids repeat in APRHI, so the duplicate kept is chosen over every attribute.
    await db.conn.run(`
      CREATE TABLE a_dedup AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT 'aprhi' AS source, a.id, a.name, a.class, m.status, ST_AsHEXWKB(a.geom) AS wkb, a.geom,
               row_number() OVER (PARTITION BY ST_AsHEXWKB(a.geom)
                 ORDER BY a.id NULLS LAST, a.name NULLS LAST, a.class NULLS LAST, m.status NULLS LAST) AS rn
        FROM a_raw a JOIN st_map m ON m.raw = coalesce(a.st_raw, '') WHERE NOT m.dropped)
      WHERE rn = 1`);
    const [aCount] = await db.all(`
      SELECT (SELECT count(*) FROM a_raw) AS touching,
             (SELECT count(*) FROM a_raw a JOIN st_map m ON m.raw = coalesce(a.st_raw, '') WHERE m.dropped) AS dropped,
             (SELECT count(*) FROM a_dedup) AS kept`);

    // 3. IGN lines touching the outline.
    await db.conn.run(
      `CREATE TABLE i_raw (cls VARCHAR, gid BIGINT, fna VARCHAR, geom GEOMETRY)`,
    );
    for (const l of ignLayers)
      await db.conn.run(`
        INSERT INTO i_raw
        SELECT ${lit(l.cls)}, CAST(gid AS BIGINT), fna, ST_Force2D(geom)
        FROM ST_Read(${lit(l.shp)}, ${IGN_ST_READ_OPTIONS})
        WHERE ST_Intersects(geom, ${bbox}) AND ST_Intersects(geom, (SELECT geom FROM outline))`);
    await createNameMap(db, "i_raw", "fna");
    await db.conn.run(`
      CREATE TABLE i_dedup AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT 'ign' AS source, r.gid AS id, m.name, r.cls AS class, CAST(NULL AS VARCHAR) AS status,
               ST_AsHEXWKB(r.geom) AS wkb, r.geom,
               row_number() OVER (PARTITION BY r.cls, ST_AsHEXWKB(r.geom) ORDER BY r.gid) AS rn
        FROM i_raw r LEFT JOIN name_map m ON m.raw = r.fna)
      WHERE rn = 1`);
    const [iCount] = await db.all(
      `SELECT (SELECT count(*) FROM i_raw) AS touching, (SELECT count(*) FROM i_dedup) AS kept`,
    );
    log(`sources read: aprhi ${num(aCount?.kept)}, ign ${num(iCount?.kept)}`);

    // 4. Clip at the province edge, split at the roots.
    await db.conn.run(`
      CREATE TABLE clip AS
      SELECT row_number() OVER (ORDER BY source, id NULLS LAST, name NULLS LAST, class NULLS LAST,
                                status NULLS LAST, wkb) AS rid, *
      FROM (
        SELECT source, id, name, class, status, wkb, g AS geom FROM (
          SELECT a.*, ST_CollectionExtract(ST_Intersection(a.geom, p.geom), 2) AS g
          FROM a_dedup a, prov p
          UNION ALL
          SELECT i.*, ST_CollectionExtract(ST_Intersection(ST_Difference(i.geom, p.geom), o.geom), 2)
          FROM i_dedup i, prov p, outline o) t
        WHERE NOT ST_IsEmpty(g) AND ST_Length(g) > 0)`);
    await db.conn.run(`ALTER TABLE clip ADD COLUMN km DOUBLE`);
    await db.conn.run(`UPDATE clip SET km = ${lengthSpheroidKm("geom")}`);
    const clipKm = new Map(
      (
        await db.all(`SELECT source, sum(km) AS km FROM clip GROUP BY source`)
      ).map((r) => [String(r.source), num(r.km)]),
    );
    await db.conn.run(`
      CREATE TABLE split AS
      SELECT source, id, name, class, status, root,
             source || ':' || coalesce(CAST(id AS VARCHAR), 'null') || ':' ||
               CAST(row_number() OVER (PARTITION BY source, id
                      ORDER BY rid, root, ST_AsHEXWKB(geom)) - 1 AS VARCHAR) AS lineId,
             geom
      FROM (
        SELECT rid, source, id, name, class, status, root, d.geom AS geom FROM (
          SELECT rid, source, id, name, class, status, root, unnest(ST_Dump(ST_LineMerge(g))) AS d
          FROM (
            SELECT c.rid, c.source, c.id, c.name, c.class, c.status, r.code AS root,
                   ST_CollectionExtract(ST_Intersection(c.geom, r.geom), 2) AS g
            FROM clip c JOIN roots r ON ST_Intersects(c.geom, r.geom)) x
          WHERE NOT ST_IsEmpty(g)) y)
      WHERE ST_GeometryType(geom) = 'LINESTRING' AND ST_Length(geom) > 0`);
    log("clipped and split at the roots");

    // 5. Parts and the nearest reach of the same root.
    await db.conn.run(`
      CREATE TABLE seg AS
      SELECT lineId, source, id, name, class, status, root, ga, len_m,
             CAST(greatest(1, ceil(len_m / ${config.partM})) AS INTEGER) AS n
      FROM (SELECT *, ${albers("geom")} AS ga FROM split) s,
           LATERAL (SELECT ST_Length(s.ga) AS len_m)`);
    await db.conn.run(`
      CREATE TABLE part AS
      SELECT lineId, root, i AS idx,
             ST_X(ST_LineInterpolatePoint(ga, (i + 0.5) / n)) AS x,
             ST_Y(ST_LineInterpolatePoint(ga, (i + 0.5) / n)) AS y
      FROM (SELECT lineId, root, ga, n, unnest(range(n)) AS i FROM seg)`);
    await db.conn.run(`
      CREATE TABLE reach_a AS
      SELECT HYRIV_ID, root, network, ORD_STRA, LENGTH_KM,
             CASE WHEN ORD_STRA >= ${config.largeMinStrahler} THEN ${config.bufferLargeM}
                  ELSE ${config.bufferM} END AS buf,
             ${albers("geom")} AS ga
      FROM read_parquet(${lit(reachesFile)})`);
    const cell = (v: string) => `CAST(floor((${v}) / ${CELL_M}) AS BIGINT)`;
    await db.conn.run(`
      CREATE TABLE reach_cells AS
      SELECT HYRIV_ID, root, cx, unnest(range(y0, y1 + 1)) AS cy FROM (
        SELECT HYRIV_ID, root, ${cell(`ST_YMin(ga) - buf`)} AS y0,
               ${cell(`ST_YMax(ga) + buf`)} AS y1,
               unnest(range(${cell(`ST_XMin(ga) - buf`)},
                            ${cell(`ST_XMax(ga) + buf`)} + 1)) AS cx
        FROM reach_a)`);
    await db.conn.run(`
      CREATE TABLE cand AS
      SELECT * FROM (
        SELECT p.lineId, p.idx, r.HYRIV_ID, r.buf, ST_Distance(ST_Point(p.x, p.y), r.ga) AS d
        FROM part p
        JOIN reach_cells c ON c.root = p.root AND c.cx = ${cell("p.x")} AND c.cy = ${cell("p.y")}
        JOIN reach_a r ON r.HYRIV_ID = c.HYRIV_ID)
      WHERE d <= buf`);
    await db.conn.run(`
      CREATE TABLE pm AS
      SELECT lineId, idx, HYRIV_ID FROM (
        SELECT *, row_number() OVER (PARTITION BY lineId, idx ORDER BY d, HYRIV_ID) AS rn FROM cand)
      WHERE rn = 1`);
    log("parts matched");

    // 6. Pieces: runs of parts with one reach.
    const perLine = await db.all(`
      SELECT s.lineId, s.len_m, list(pm.HYRIV_ID ORDER BY p.idx) AS reaches
      FROM seg s JOIN part p USING (lineId)
      LEFT JOIN pm ON pm.lineId = p.lineId AND pm.idx = p.idx
      GROUP BY s.lineId, s.len_m ORDER BY s.lineId`);
    const csv: string[] = ["lineId,k,a,b,reach"];
    for (const l of perLine) {
      const reaches = (l.reaches as (number | string | null)[]).map((v) =>
        v === null ? null : Number(v),
      );
      pieceRuns(reaches, num(l.len_m), config.minPieceM).forEach((r, k) =>
        csv.push(`${l.lineId},${k},${r.from},${r.to},${r.reach ?? ""}`),
      );
    }
    const runsFile = `${outDir}/runs.csv`;
    await writeFile(runsFile, csv.join("\n") + "\n");
    await db.conn.run(`
      CREATE TABLE runs AS
      SELECT * FROM read_csv(${lit(runsFile)}, header = true, nullstr = '',
        columns = {'lineId': 'VARCHAR', 'k': 'INTEGER', 'a': 'INTEGER', 'b': 'INTEGER', 'reach': 'INTEGER'})`);
    await db.conn.run(`
      CREATE TABLE pieces AS
      SELECT s.lineId || '#' || CAST(r.k AS VARCHAR) AS pieceId, s.lineId, s.source, s.id AS sourceId,
             s.name, s.class, s.status, s.root, r.reach, ra.network, ra.ORD_STRA AS strahler,
             ${fromAlbers("ST_LineSubstring(s.ga, CAST(r.a AS DOUBLE) / s.n, CAST(r.b AS DOUBLE) / s.n)")} AS geom
      FROM runs r JOIN seg s USING (lineId) LEFT JOIN reach_a ra ON ra.HYRIV_ID = r.reach`);
    await db.conn.run(
      `COPY (
         SELECT pieceId, lineId, source, sourceId, name, class, status, root, reach, network, strahler,
                ${lengthSpheroidKm("geom")} * 1000 AS length_m, geom
         FROM pieces ORDER BY pieceId)
       TO ${lit(parquet)} (FORMAT parquet)`,
    );
    const sha = await sha256(parquet);
    log(`pieces written, sha256 ${sha.slice(0, 12)}`);

    // 7. Checks, on the written file. Parquet reads back as OGC:CRS84; the roots and the
    // edge are EPSG:4326 (same axes with always_xy), so only the label is changed.
    await db.conn.run(
      `CREATE VIEW out AS
       SELECT * REPLACE (ST_SetCRS(geom, 'EPSG:4326') AS geom) FROM read_parquet(${lit(parquet)})`,
    );
    const kmBySource = new Map(
      (
        await db.all(
          `SELECT source, sum(length_m) / 1000 AS km FROM out GROUP BY source`,
        )
      ).map((r) => [String(r.source), num(r.km)]),
    );
    const conservation: Record<string, unknown> = {};
    let conservationOk = clipKm.size > 0;
    for (const [s, ck] of clipKm) {
      const pk = kmBySource.get(s) ?? 0;
      const diffPct = ck > 0 ? (Math.abs(pk - ck) / ck) * 100 : 0;
      conservation[s] = {
        clippedKm: round(ck, 3),
        piecesKm: round(pk, 3),
        diffPct: round(diffPct, 4),
      };
      conservationOk &&= diffPct <= config.conservationPct;
    }
    await db.conn.run(`
      CREATE TABLE root_buf AS
      SELECT code, ST_Buffer(geom, ${tolDeg}) AS geom FROM roots`);
    const [rootBad] = await db.all(`
      SELECT count(*) FILTER (o.root IS NULL) AS no_root,
             count(*) FILTER (o.root IS NOT NULL AND (b.geom IS NULL OR NOT ST_Within(o.geom, b.geom))) AS outside_root
      FROM out o LEFT JOIN root_buf b ON b.code = o.root`);
    await db.conn.run(`
      CREATE TABLE edge AS
      SELECT ST_Buffer(geom, ${tolDeg}) AS wide, ST_Buffer(geom, ${-tolDeg}) AS narrow FROM prov`);
    const [edgeBad] = await db.all(`
      SELECT count(*) FILTER (o.source = 'aprhi' AND NOT ST_Within(o.geom, e.wide)) AS aprhi_outside,
             count(*) FILTER (o.source = 'ign' AND ST_Intersects(o.geom, e.narrow)) AS ign_inside
      FROM out o, edge e`);
    await db.conn.run(`
      CREATE TABLE out_a AS
      SELECT pieceId, lineId, ${albers("geom")} AS ga FROM out`);
    const [overlap] = await db.all(`
      SELECT count(*) AS pairs FROM out_a a JOIN out_a b
        ON a.lineId = b.lineId AND a.pieceId < b.pieceId
      WHERE ST_Intersects(a.ga, b.ga) AND ST_Length(ST_Intersection(a.ga, b.ga)) > ${config.edgeToleranceM}`);
    const [reachBad] = await db.all(`
      SELECT count(*) AS n FROM out o JOIN reach_a r ON r.HYRIV_ID = o.reach
      WHERE o.reach IS NOT NULL AND r.root <> o.root`);
    const [orphanReach] = await db.all(`
      SELECT count(*) AS n FROM out o WHERE o.reach IS NOT NULL
        AND o.reach NOT IN (SELECT HYRIV_ID FROM reach_a)`);
    const [ids] = await db.all(
      `SELECT count(*) AS n, count(DISTINCT pieceId) AS d FROM out`,
    );
    const checks = {
      kmConservedPerSource: conservationOk,
      everyPieceHasOneRoot:
        num(rootBad?.no_root) === 0 && num(rootBad?.outside_root) === 0,
      piecesOfOneLineDoNotOverlap: num(overlap?.pairs) === 0,
      noAprhiPieceOutsideProvince: num(edgeBad?.aprhi_outside) === 0,
      noIgnPieceInsideProvince: num(edgeBad?.ign_inside) === 0,
      matchedReachesInSameRoot:
        num(reachBad?.n) === 0 && num(orphanReach?.n) === 0,
      pieceIdsUnique: num(ids?.n) > 0 && num(ids?.n) === num(ids?.d),
    };
    const identicalToPreviousRun =
      previousSha === null ? null : previousSha === sha;
    const ok =
      Object.values(checks).every(Boolean) && identicalToPreviousRun !== false;

    // 8. Statistics.
    const kmTable = await db.all(`
      SELECT source, root, reach IS NOT NULL AS matched, count(*) AS pieces,
             sum(length_m) / 1000 AS km
      FROM out GROUP BY ALL ORDER BY source, root, matched DESC`);
    const byStatus = await db.all(`
      SELECT coalesce(status, '(none)') AS status, source, count(*) AS pieces, sum(length_m) / 1000 AS km
      FROM out GROUP BY ALL ORDER BY source, status`);
    const byStrahler = await db.all(`
      SELECT strahler, count(*) AS pieces, sum(length_m) / 1000 AS km,
             100 * sum(length_m) / sum(sum(length_m)) OVER () AS pct_of_matched
      FROM out WHERE reach IS NOT NULL GROUP BY strahler ORDER BY strahler`);
    const hidden = await db.all(`
      SELECT root, count(*) AS reaches, sum(LENGTH_KM) AS km
      FROM reach_a WHERE network = 'connected' AND ORD_STRA >= ${config.hiddenMinStrahler}
        AND HYRIV_ID NOT IN (SELECT reach FROM out WHERE reach IS NOT NULL)
      GROUP BY root ORDER BY root`);
    const connectedHigh = await db.all(`
      SELECT root, count(*) AS reaches, sum(LENGTH_KM) AS km
      FROM reach_a WHERE network = 'connected' AND ORD_STRA >= ${config.hiddenMinStrahler}
      GROUP BY root ORDER BY root`);
    const hiddenTop = await db.all(`
      SELECT HYRIV_ID AS reach, root, ORD_STRA AS strahler, LENGTH_KM AS km
      FROM reach_a WHERE network = 'connected' AND ORD_STRA >= ${config.hiddenMinStrahler}
        AND HYRIV_ID NOT IN (SELECT reach FROM out WHERE reach IS NOT NULL)
      ORDER BY LENGTH_KM DESC, HYRIV_ID LIMIT ${TOP}`);
    const unmatchedNamed = await db.all(`
      SELECT lineId, name, source, class, root, sum(length_m) / 1000 AS km
      FROM out WHERE reach IS NULL AND name IS NOT NULL
      GROUP BY ALL ORDER BY km DESC, lineId LIMIT ${TOP}`);
    const km = (r: Row) => round(num(r.km), 3);

    await writeReport("lines", {
      ok,
      checks,
      pendingChecks: {
        identicalToPreviousRun,
        note: "null on a first run (no earlier lines.parquet); run the step twice. false fails the step.",
      },
      config: {
        ...config,
        $comment: undefined,
        edgeSource:
          "union of basin.config.json clippedLayer (as pipeline:basin reference mode)",
      },
      distanceNote:
        "reach distances are in South America Albers (a few percent off); lengths are spheroid km",
      sha256: sha,
      previousSha256: previousSha,
      sources: {
        aprhi: {
          touchingProvince: num(aCount?.touching),
          droppedByStatus: num(aCount?.dropped),
          afterDuplicateRemoval: num(aCount?.kept),
          statusValues: statusRaw,
        },
        ign: {
          classes: config.ign.classes,
          touchingOutline: num(iCount?.touching),
          afterDuplicateRemoval: num(iCount?.kept),
        },
      },
      conservation,
      counts: {
        pieces: num(ids?.n),
        lines: num(
          (await db.all(`SELECT count(DISTINCT lineId) AS n FROM out`))[0]?.n,
        ),
      },
      failures: {
        pieceWithoutRoot: num(rootBad?.no_root),
        pieceOutsideItsRoot: num(rootBad?.outside_root),
        overlappingPiecePairs: num(overlap?.pairs),
        aprhiOutsideProvince: num(edgeBad?.aprhi_outside),
        ignInsideProvince: num(edgeBad?.ign_inside),
        matchedReachOtherRoot: num(reachBad?.n),
        matchedReachUnknown: num(orphanReach?.n),
      },
      stats: {
        kmBySourceRootMatched: kmTable.map((r) => ({
          source: r.source,
          root: r.root,
          matched: Boolean(r.matched),
          pieces: num(r.pieces),
          km: km(r),
        })),
        kmByStatus: byStatus.map((r) => ({
          status: r.status,
          source: r.source,
          pieces: num(r.pieces),
          km: km(r),
        })),
        matchedKmByStrahler: byStrahler.map((r) => ({
          strahler: r.strahler,
          pieces: num(r.pieces),
          km: km(r),
          pctOfMatched: round(num(r.pct_of_matched), 2),
        })),
        hiddenHighOrderReaches: {
          minStrahler: config.hiddenMinStrahler,
          note: "connected reaches with no displayed piece: modeled paths across the plains, hidden",
          connectedHighOrderByRoot: connectedHigh.map((r) => ({
            root: r.root,
            reaches: num(r.reaches),
            km: km(r),
          })),
          hiddenByRoot: hidden.map((r) => ({
            root: r.root,
            reaches: num(r.reaches),
            km: km(r),
          })),
          longest: hiddenTop.map((r) => ({
            reach: num(r.reach),
            root: r.root,
            strahler: num(r.strahler),
            km: km(r),
          })),
        },
        longestUnmatchedNamedLines: unmatchedNamed.map((r) => ({
          lineId: r.lineId,
          name: r.name,
          source: r.source,
          class: r.class,
          root: r.root,
          km: km(r),
        })),
      },
      outputs: [rel(parquet)],
    });
    if (!ok) throw new Error(`lines checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
