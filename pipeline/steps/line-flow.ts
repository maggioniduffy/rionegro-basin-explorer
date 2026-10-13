/**
 * pipeline:line-flow — the flow class the map draws for display line pieces (mapLines
 * "pieces", cba; owner, 2026-10-12). Needs regions/<id>/line-flow.config.json; a region
 * without it stops with a message.
 *
 * GIRES (a model of natural flow, 1971–2000) rates the dammed Córdoba rivers non-perennial;
 * IGN's cartography maps them perennial and is the authority. APRHI's lines carry no flow
 * class, so each APRHI piece takes the class of the IGN lines it runs along:
 *
 * 1. Points every partM metres along each APRHI piece (South America Albers).
 * 2. Each point takes the class of its nearest IGN line (perennial or intermittent) within
 *    bufferM (ties by class, perennial first, then IGN gid).
 * 3. lib/line-flow.ts pieceFlow: the class with more points when at least minShare of the
 *    points lie by an IGN line, else none (the map keeps GIRES's class).
 * IGN pieces keep their own class. Reach documents keep GIRES's values (display only).
 *
 * Output: data/work/<id>/line-flow/flow.parquet (pieceId, flow, points, perennialPts,
 * intermittentPts) for the pieces with a class, and report.json with the checks, km by
 * class and how the drawn class differs from GIRES's.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { lit, openDb, limitResources, type Row } from "../lib/duckdb";
import { ALBERS, IGN_LINE_LAYERS, IGN_ST_READ_OPTIONS } from "../lib/ign";
import { requireInput } from "../lib/inputs";
import { round } from "../lib/lines-gate";
import { LINE_FLOWS, pieceFlow } from "../lib/line-flow";
import { regionFile, rel, REGION_ID, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface FlowConfig {
  partM: number;
  bufferM: number;
  minShare: number;
}

/** Grid cell (m) for the point/IGN-line prefilter; the exact distance decides. */
const CELL_M = 5000;
const TOP = 15;

const num = (v: unknown) => Number(v ?? 0);
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function main() {
  const configFile = regionFile("line-flow.config.json");
  if (!existsSync(configFile)) {
    console.error(
      `pipeline:line-flow has no settings for region "${REGION_ID}" (${rel(configFile)} missing); nothing to do.`,
    );
    process.exit(1);
  }
  const config = JSON.parse(await readFile(configFile, "utf8")) as FlowConfig;
  const linesFile = requireInput(workPath("lines/lines.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const outlineFile = requireInput(workPath("basin/basin.geojson"));
  const ignLayers = IGN_LINE_LAYERS.map((l) => ({
    ...l,
    shp: requireInput(l.shp),
  }));

  const outDir = workPath("line-flow");
  const parquet = `${outDir}/flow.parquet`;
  await mkdir(outDir, { recursive: true });
  const previousSha = existsSync(parquet) ? await sha256(parquet) : null;

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const cell = (v: string) => `CAST(floor((${v}) / ${CELL_M}) AS BIGINT)`;

  try {
    // Parquet reads back as OGC:CRS84; same axes as EPSG:4326 with always_xy.
    await db.conn.run(`
      CREATE TABLE pieces AS
      SELECT pieceId, source, class, name, reach, length_m,
             ST_SetCRS(geom, 'EPSG:4326') AS geom
      FROM read_parquet(${lit(linesFile)})`);

    // 1. IGN lines over the outline, both classes, in Albers.
    await db.conn.run(`
      CREATE TABLE outline AS
      SELECT ST_Union_Agg(geom) AS geom FROM ST_Read(${lit(outlineFile)})`);
    await db.conn.run(
      `CREATE TABLE ign (cls VARCHAR, gid BIGINT, ga GEOMETRY)`,
    );
    for (const l of ignLayers)
      await db.conn.run(`
        INSERT INTO ign
        SELECT ${lit(l.cls)}, CAST(gid AS BIGINT), ${albers("ST_Force2D(geom)")}
        FROM ST_Read(${lit(l.shp)}, ${IGN_ST_READ_OPTIONS})
        WHERE ST_Intersects(geom, (SELECT ST_Envelope(geom) FROM outline))
          AND ST_Intersects(geom, (SELECT geom FROM outline))`);
    const buf = config.bufferM;
    await db.conn.run(`
      CREATE TABLE ign_cells AS
      SELECT cls, gid, cx, unnest(range(y0, y1 + 1)) AS cy FROM (
        SELECT cls, gid, ${cell(`ST_YMin(ga) - ${buf}`)} AS y0, ${cell(`ST_YMax(ga) + ${buf}`)} AS y1,
               unnest(range(${cell(`ST_XMin(ga) - ${buf}`)}, ${cell(`ST_XMax(ga) + ${buf}`)} + 1)) AS cx
        FROM ign)`);
    log("IGN lines read");

    // 2. Points along the APRHI pieces and their nearest IGN line.
    await db.conn.run(`
      CREATE TABLE pt AS
      SELECT pieceId, i,
             ST_X(ST_LineInterpolatePoint(ga, (i + 0.5) / n)) AS x,
             ST_Y(ST_LineInterpolatePoint(ga, (i + 0.5) / n)) AS y
      FROM (
        SELECT pieceId, ga, n, unnest(range(n)) AS i FROM (
          SELECT pieceId, ga, CAST(greatest(1, ceil(ST_Length(ga) / ${config.partM})) AS INTEGER) AS n
          FROM (SELECT pieceId, ${albers("geom")} AS ga FROM pieces WHERE source = 'aprhi')))`);
    await db.conn.run(`
      CREATE TABLE near AS
      SELECT pieceId, i, cls FROM (
        SELECT p.pieceId, p.i, g.cls,
               row_number() OVER (PARTITION BY p.pieceId, p.i
                 ORDER BY ST_Distance(ST_Point(p.x, p.y), g.ga), g.cls = 'intermittent', g.gid) AS rn
        FROM pt p
        JOIN ign_cells c ON c.cx = ${cell("p.x")} AND c.cy = ${cell("p.y")}
        JOIN ign g ON g.cls = c.cls AND g.gid = c.gid
        WHERE ST_Distance(ST_Point(p.x, p.y), g.ga) <= ${buf})
      WHERE rn = 1`);
    log("points matched");

    // 3. Class per piece (pure rule in lib/line-flow.ts).
    const counts = await db.all(`
      SELECT p.pieceId, count(*) AS points,
             count(*) FILTER (n.cls = 'perennial') AS per,
             count(*) FILTER (n.cls = 'intermittent') AS inter
      FROM pt p LEFT JOIN near n USING (pieceId, i)
      GROUP BY p.pieceId ORDER BY p.pieceId`);
    await db.conn.run(`
      CREATE TABLE flow (pieceId VARCHAR, flow VARCHAR, points INTEGER,
                         perennialPts INTEGER, intermittentPts INTEGER)`);
    const rows: string[] = [];
    for (const r of counts) {
      const f = pieceFlow(
        num(r.points),
        num(r.per),
        num(r.inter),
        config.minShare,
      );
      if (f)
        rows.push(
          `(${lit(String(r.pieceId))}, ${lit(f)}, ${num(r.points)}, ${num(r.per)}, ${num(r.inter)})`,
        );
    }
    for (let k = 0; k < rows.length; k += 1000)
      await db.conn.run(
        `INSERT INTO flow VALUES ${rows.slice(k, k + 1000).join(",")}`,
      );
    // IGN pieces keep their own class.
    await db.conn.run(`
      INSERT INTO flow
      SELECT pieceId, class, NULL, NULL, NULL FROM pieces
      WHERE source = 'ign' AND class IN (${LINE_FLOWS.map(lit).join(",")})`);
    await db.conn.run(
      `COPY (SELECT * FROM flow ORDER BY pieceId) TO ${lit(parquet)} (FORMAT parquet)`,
    );
    const sha = await sha256(parquet);
    log(`flow written, sha256 ${sha.slice(0, 12)}`);

    // 4. Checks and statistics, on the written file.
    await db.conn.run(`
      CREATE VIEW out AS
      SELECT p.pieceId, p.source, p.class, p.name, p.length_m / 1000 AS km, f.flow,
             r.predcat1 AS gires
      FROM pieces p
      LEFT JOIN read_parquet(${lit(parquet)}) f USING (pieceId)
      LEFT JOIN read_parquet(${lit(reachesFile)}) r ON r.HYRIV_ID = p.reach`);
    const [ids] = await db.all(`
      SELECT count(*) AS n, count(DISTINCT pieceId) AS d,
             count(*) FILTER (pieceId NOT IN (SELECT pieceId FROM pieces)) AS unknown,
             count(*) FILTER (flow NOT IN (${LINE_FLOWS.map(lit).join(",")})) AS bad
      FROM read_parquet(${lit(parquet)})`);
    const [ignBad] = await db.all(`
      SELECT count(*) AS n FROM out
      WHERE source = 'ign' AND class IN (${LINE_FLOWS.map(lit).join(",")})
        AND flow IS DISTINCT FROM class`);
    const checks = {
      pieceIdsUniqueAndKnown:
        num(ids?.n) > 0 &&
        num(ids?.n) === num(ids?.d) &&
        num(ids?.unknown) === 0,
      flowValuesValid: num(ids?.bad) === 0,
      ignPiecesKeepTheirClass: num(ignBad?.n) === 0,
    };
    const identicalToPreviousRun =
      previousSha === null ? null : previousSha === sha;
    const ok =
      Object.values(checks).every(Boolean) && identicalToPreviousRun !== false;

    const km = (r: Row) => round(num(r.km), 1);
    const bySource = (
      await db.all(`
        SELECT source, coalesce(flow, '(none)') AS flow, count(*) AS pieces, sum(km) AS km
        FROM out GROUP BY ALL ORDER BY source, flow`)
    ).map((r) => ({ ...r, pieces: num(r.pieces), km: km(r) }));
    // What the map drew before (GIRES) against what it draws now (IGN, else GIRES).
    const giresClass = `CASE gires WHEN 0 THEN 'perennial' WHEN 1 THEN 'non-perennial' ELSE '(none)' END`;
    const drawn = `CASE flow WHEN 'perennial' THEN 'perennial' WHEN 'intermittent' THEN 'non-perennial' ELSE ${giresClass} END`;
    const change = (
      await db.all(`
        SELECT ${giresClass} AS gires, ${drawn} AS drawn, sum(km) AS km
        FROM out GROUP BY ALL ORDER BY gires, drawn`)
    ).map((r) => ({ ...r, km: km(r) }));
    const namedRivers = (
      await db.all(`
        SELECT name, sum(km) AS km,
               sum(km) FILTER (gires = 1) AS gires_non_perennial_km,
               sum(km) FILTER (flow = 'perennial') AS ign_perennial_km,
               sum(km) FILTER (flow = 'intermittent') AS ign_intermittent_km,
               sum(km) FILTER (flow IS NULL) AS no_ign_km
        FROM out WHERE name ILIKE 'Río %' GROUP BY name ORDER BY km DESC LIMIT ${TOP}`)
    ).map((r) => ({
      name: r.name,
      km: km(r),
      giresNonPerennialKm: round(num(r.gires_non_perennial_km), 1),
      ignPerennialKm: round(num(r.ign_perennial_km), 1),
      ignIntermittentKm: round(num(r.ign_intermittent_km), 1),
      noIgnKm: round(num(r.no_ign_km), 1),
    }));

    await writeReport("line-flow", {
      ok,
      checks,
      pendingChecks: {
        identicalToPreviousRun,
        note: "null on a first run (no earlier flow.parquet); run the step twice. false fails the step.",
      },
      config: { ...config, $comment: undefined },
      distanceNote:
        "distances are in South America Albers (a few percent off); lengths are spheroid km",
      sha256: sha,
      previousSha256: previousSha,
      ignLines: num((await db.all(`SELECT count(*) AS n FROM ign`))[0]?.n),
      stats: {
        kmBySourceAndFlow: bySource,
        drawnClassAgainstGires: change,
        largestNamedRivers: namedRivers,
      },
    });
    if (!ok) {
      console.error("pipeline:line-flow checks failed; see the report");
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
