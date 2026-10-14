/**
 * pipeline:river-lines — each approved river's course assembled from the display lines
 * (WP 5.1). Needs regions/<id>/river-lines.config.json; a region without it stops with a
 * message (nqn has none). Runs after pipeline:named, pipeline:lines and pipeline:lakes.
 *
 * The 15″ HydroRIVERS path of a river is far from the mapped channel on the plains. For each
 * river of regions/<id>/names.json this step chains the drawn display pieces (APRHI inside the
 * province, IGN outside; precedence APRHI > IGN > HydroRIVERS, owner) from the river's source
 * to its mouth, preferring pieces that carry the river's own name (lib/river-course.ts holds
 * the rules: snapping, weights, virtual gap edges, anchors, extensions, claims):
 *
 * 1. Candidates: drawn pieces of the river's root(s) (a river's course never leaves them) within
 *    corridorM of its reaches, plus every own-named piece of that root. A piece with an empty
 *    geometry in lakes/line_geom.parquet is not drawn and is left out, as pipeline:export does.
 *    Classes in excludeClasses are left out.
 * 2. Anchors: the source anchor comes from the upstream end of the river's most upstream reach
 *    (max path_order), the mouth anchor from the downstream end of its mouth reach (path_order
 *    0), both from named/river_reaches.parquet; each takes the nearest node touching an
 *    own-named piece within anchorMaxM, else the nearest node with a real piece.
 * 3. Rivers are processed receivers first: a river whose mouth reach drains (NEXT_DOWN chain in
 *    rivers/reaches.parquet) into another approved river comes after it, ties in names.json
 *    order. A later river's course is cut where it reaches a piece of its receiver (the river it
 *    flows into): at a shared junction, or at a line end within attachM of the interior of such a
 *    piece; a cut that meets any other river is a failed check. Gaps (no line connects) are
 *    recorded in gaps.json and filled (5).
 * 4. Two passes per river: the first gives the main course; the step then measures how far the
 *    own-named line ends outside it lie from the interior of the course pieces (attachM), and
 *    the second pass lets those lines join the course there (main course pieces only), as arms
 *    or as the continuation of the mouth extension. Pieces are never split: attachments only
 *    add connectivity.
 * 5. Gap fill (WP 5.2): each path gap of the course, and the break between a river's course and
 *    its receiver's when no line joins them, gets one fill piece. IGN first (owner exception to
 *    R3.3: the raw IGN lines, inside the province too, but only here): the cheapest chain of IGN
 *    line parts within fillCorridorM of the gap that joins both ends (ends within fillSnapM),
 *    cutting a line where it passes a gap end; else the river's HydroRIVERS reaches between the
 *    ends, cut at the points nearest them, with straight connectors to the exact ends (counted
 *    as HydroRIVERS km). Arms farther than armMaxFromCourseM from the course (pieces and fill)
 *    are not part of the river.
 *
 * Output: data/work/<id>/river-lines/course.parquet (pieceId, river, order, role; order 0 is the
 * mouth end; role own | bridge for the course, arm for own-named pieces joined to it, with a
 * null order), fill.parquet (pieceId fill:ign:<n> | fill:hr:<n>, river, order = order of the
 * course piece just downstream of the gap (null below the course), upOrder, kind gap | join,
 * src ign | hydrorivers, form chain | route | connector, fill = true, sourceIds = IGN features /
 * HYRIV_IDs it comes from (for a connector, the nearest reaches, not the geometry's source),
 * connectorM = straight metres inside the piece (the whole piece for a connector), lengthKm, geom EPSG:4326), gaps.json (path gaps with the piece that fills them, extension
 * breaks and attachments) and report.json. The intermediate course.csv is removed. Outputs are
 * sorted, so two runs give the same files.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { ALBERS, createNameMap } from "../lib/ign";
import { lengthSpheroidKm } from "../lib/geo";
import { ignLayersOf, readIgnLines } from "../lib/ign-lines";
import { requireInput } from "../lib/inputs";
import { round } from "../lib/lines-gate";
import { loadNameSource, nameFile } from "../lib/name-source";
import { riverSlug } from "../lib/names";
import { regionFile, rel, REGION_ID, workPath } from "../lib/paths";
import {
  type AliasesFile,
  pieceDisplayName,
  rawNameIndex,
} from "../lib/piece-names";
import { writeReport } from "../lib/report";
import {
  type CoursePiece,
  type CourseResult,
  type Endpoint,
  type FillEdge,
  type NearPiece,
  buildCourse,
  classExcluded,
  endKey,
  findReceiver,
  joinLines,
  lineWkt,
  ownNameKeys,
  parseLineWkt,
  parseRiverLinesConfig,
  pieceKind,
  planGapFill,
  processingOrder,
  receiverPieces,
} from "../lib/river-course";

interface NameEntry {
  name: string;
  shortName: string;
  type: string;
  slug?: string;
  aliases?: string[];
  mouthReach: number;
}

const TOP = 10;
const TOP_LEFT_OUT = 5;
const num = (v: unknown) => Number(v ?? 0);
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

interface PieceRow {
  id: string;
  lineId: string;
  source: string;
  name: string | null;
  cls: string | null;
  root: string;
  lengthM: number;
  display: string | null;
  a: Endpoint;
  b: Endpoint;
}

async function main() {
  const configFile = regionFile("river-lines.config.json");
  if (!existsSync(configFile)) {
    throw new Error(
      `pipeline:river-lines has no settings for region "${REGION_ID}" (${rel(configFile)} missing); nothing to do.`,
    );
  }
  const config = parseRiverLinesConfig(
    JSON.parse(await readFile(configFile, "utf8")),
  );
  const rivers = (
    JSON.parse(await readFile(regionFile("names.json"), "utf8")) as {
      rivers: NameEntry[];
    }
  ).rivers;
  const ignLayers = ignLayersOf(
    (
      JSON.parse(await readFile(regionFile("lines.config.json"), "utf8")) as {
        ign: { classes: string[] };
      }
    ).ign.classes,
  );
  const nameSource = await loadNameSource();
  if (nameSource.id !== "line-names")
    throw new Error(
      `pipeline:river-lines needs namesFrom "line-names" in regions/${REGION_ID}/ign.config.json`,
    );
  const aliases = JSON.parse(
    await readFile(requireInput(nameFile(nameSource, "aliases.json")), "utf8"),
  ) as AliasesFile;
  const linesFile = requireInput(workPath("lines/lines.parquet"));
  const lineGeomFile = requireInput(workPath("lakes/line_geom.parquet"));
  const lakesFile = requireInput(workPath("lakes/lakes.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const riverReachesFile = requireInput(
    workPath("named/river_reaches.parquet"),
  );

  const outDir = workPath("river-lines");
  const parquet = `${outDir}/course.parquet`;
  const fillParquet = `${outDir}/fill.parquet`;
  await mkdir(outDir, { recursive: true });
  const previousSha = existsSync(parquet) ? await sha256(parquet) : null;
  const previousFillSha = existsSync(fillParquet)
    ? await sha256(fillParquet)
    : null;

  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='2GB'; SET threads=2; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  try {
    // 1. Drawn pieces (Albers metres for distances, lon/lat for the gaps).
    await db.conn.run(`
      CREATE TABLE piece0 AS
      SELECT l.pieceId, l.lineId, l.source, l.name, l.class, l.root, l.length_m,
             ST_X(ST_StartPoint(l.geom)) AS alon, ST_Y(ST_StartPoint(l.geom)) AS alat,
             ST_X(ST_EndPoint(l.geom)) AS blon, ST_Y(ST_EndPoint(l.geom)) AS blat,
             ${albers("ST_SetCRS(l.geom, 'EPSG:4326')")} AS ga
      FROM read_parquet(${lit(linesFile)}) l
      LEFT JOIN read_parquet(${lit(lineGeomFile)}) g ON g.pieceId = l.pieceId
      WHERE g.geom IS NULL OR NOT ST_IsEmpty(g.geom)`);
    await db.conn.run(`
      CREATE TABLE piece AS
      SELECT *, ST_X(ST_StartPoint(ga)) AS x0, ST_Y(ST_StartPoint(ga)) AS y0,
             ST_X(ST_EndPoint(ga)) AS x1, ST_Y(ST_EndPoint(ga)) AS y1,
             ST_XMin(ga) AS xmin, ST_YMin(ga) AS ymin, ST_XMax(ga) AS xmax, ST_YMax(ga) AS ymax
      FROM piece0`);
    // Pieces with an empty geometry in line_geom.parquet are drawn nowhere; the report counts
    // them per river corridor (they can split an own-named line).
    await db.conn.run(`
      CREATE TABLE undrawn AS
      SELECT l.pieceId, l.root, l.length_m, ga, ST_XMin(ga) AS xmin, ST_YMin(ga) AS ymin,
             ST_XMax(ga) AS xmax, ST_YMax(ga) AS ymax
      FROM (SELECT pieceId, root, length_m,
                   ${albers("ST_SetCRS(geom, 'EPSG:4326')")} AS ga
            FROM read_parquet(${lit(linesFile)})) l
      JOIN read_parquet(${lit(lineGeomFile)}) g ON g.pieceId = l.pieceId
      WHERE g.geom IS NOT NULL AND ST_IsEmpty(g.geom)`);
    const [counts] = await db.all(`
      SELECT (SELECT count(*) FROM read_parquet(${lit(linesFile)})) AS lines,
             (SELECT count(*) FROM piece) AS drawn`);

    // 2. Mouth lakes and the endpoints that touch them.
    const lakeIds = config.mouthLakeIds.map(lit).join(", ");
    await db.conn.run(`
      CREATE TABLE mouth_lake AS
      SELECT id, ${albers("ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326'))")} AS ga
      FROM read_parquet(${lit(lakesFile)}) WHERE id IN (${lakeIds || "NULL"})`);
    const lakesFound = (
      await db.all(`SELECT id FROM mouth_lake ORDER BY id`)
    ).map((r) => String(r.id));
    const missingLakes = config.mouthLakeIds.filter(
      (id) => !lakesFound.includes(id),
    );
    if (missingLakes.length > 0)
      throw new Error(
        `mouthLakeIds not in lakes/lakes.parquet: ${missingLakes.join(", ")}`,
      );
    const touch = config.lakeTouchM;
    const endLakeRows = await db.all(`
      SELECT pieceId, end_, id, d FROM (
        SELECT pieceId, e.end_, l.id, ST_Distance(ST_Point(e.x, e.y), l.ga) AS d,
               row_number() OVER (PARTITION BY pieceId, e.end_
                                  ORDER BY ST_Distance(ST_Point(e.x, e.y), l.ga), l.id) AS rn
        FROM piece p
        JOIN mouth_lake l ON p.xmax >= ST_XMin(l.ga) - ${touch} AND p.xmin <= ST_XMax(l.ga) + ${touch}
                         AND p.ymax >= ST_YMin(l.ga) - ${touch} AND p.ymin <= ST_YMax(l.ga) + ${touch},
             LATERAL (SELECT 0 AS end_, p.x0 AS x, p.y0 AS y UNION ALL SELECT 1, p.x1, p.y1) e
        ) WHERE rn = 1 AND d <= ${touch}`);
    const endLake = new Map<string, { id: string; distM: number }>();
    for (const r of endLakeRows)
      endLake.set(`${r.pieceId}|${r.end_}`, {
        id: String(r.id),
        distM: num(r.d),
      });
    log(
      `pieces drawn ${num(counts?.drawn)} of ${num(counts?.lines)}, endpoints at a mouth lake ${endLake.size}`,
    );

    // 3. Rivers' reaches and anchors.
    await db.conn.run(`
      CREATE TABLE river_reach AS
      SELECT rr.river, rr.path_order, r.HYRIV_ID, r.root, r.LENGTH_KM, ga,
             ST_XMin(ga) AS xmin, ST_YMin(ga) AS ymin, ST_XMax(ga) AS xmax, ST_YMax(ga) AS ymax
      FROM read_parquet(${lit(riverReachesFile)}) rr
      JOIN (SELECT HYRIV_ID, root, LENGTH_KM, ${albers("geom")} AS ga
            FROM read_parquet(${lit(reachesFile)})) r ON r.HYRIV_ID = rr.HYRIV_ID`);
    const reachRows = await db.all(`
      SELECT river, path_order, HYRIV_ID, root,
             ST_X(ST_StartPoint(ga)) AS sx, ST_Y(ST_StartPoint(ga)) AS sy,
             ST_X(ST_EndPoint(ga)) AS ex, ST_Y(ST_EndPoint(ga)) AS ey
      FROM river_reach ORDER BY river, path_order`);

    // 4. Piece rows, with display names.
    const pieceRows = await db.all(`
      SELECT pieceId, lineId, source, name, class, root, length_m, x0, y0, x1, y1, alon, alat, blon, blat
      FROM piece ORDER BY pieceId`);
    const index = rawNameIndex(aliases);
    const pieces = new Map<string, PieceRow>();
    for (const r of pieceRows) {
      const id = String(r.pieceId);
      const name = r.name == null ? null : String(r.name);
      pieces.set(id, {
        id,
        lineId: String(r.lineId),
        source: String(r.source),
        name,
        cls: r.class == null ? null : String(r.class),
        root: String(r.root),
        lengthM: num(r.length_m),
        display: pieceDisplayName({ source: String(r.source), name }, index),
        a: {
          x: num(r.x0),
          y: num(r.y0),
          lon: num(r.alon),
          lat: num(r.alat),
          lake: endLake.get(`${id}|0`) ?? null,
        },
        b: {
          x: num(r.x1),
          y: num(r.y1),
          lon: num(r.blon),
          lat: num(r.blat),
          lake: endLake.get(`${id}|1`) ?? null,
        },
      });
    }

    // 5. One course per river, receivers first (ties in names.json order).
    const nextDown = new Map(
      (
        await db.all(
          `SELECT HYRIV_ID, NEXT_DOWN FROM read_parquet(${lit(reachesFile)})`,
        )
      ).map((r) => [num(r.HYRIV_ID), num(r.NEXT_DOWN)]),
    );
    const riverOfReach = new Map(
      reachRows.map((r) => [num(r.HYRIV_ID), String(r.river)]),
    );
    const receivers = rivers.map((entry) => ({
      slug: riverSlug(entry),
      receiver: findReceiver(
        riverSlug(entry),
        entry.mouthReach,
        nextDown,
        riverOfReach,
      ),
    }));
    const order = processingOrder(receivers);
    const entryOf = new Map(rivers.map((e) => [riverSlug(e), e]));
    log(`processing order: ${order.join(", ")}`);

    /**
     * For the endpoints of `candIds`, the nearest `targetIds` piece within attachM of the
     * endpoint (a piece other than its own): distance and the point on that piece.
     */
    const near = async (
      candIds: readonly string[],
      targetIds: readonly string[],
    ) => {
      const out: Record<string, NearPiece> = {};
      if (candIds.length === 0 || targetIds.length === 0) return out;
      const list = (ids: readonly string[]) => `[${ids.map(lit).join(", ")}]`;
      const rows = await db.all(`
        SELECT pieceId, end_, target, d, lon, lat FROM (
          SELECT pieceId, end_, target, d,
                 ST_X(ST_Transform(ST_ClosestPoint(tga, ST_Point(x, y)), ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)) AS lon,
                 ST_Y(ST_Transform(ST_ClosestPoint(tga, ST_Point(x, y)), ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)) AS lat,
                 row_number() OVER (PARTITION BY pieceId, end_ ORDER BY d, target) AS rn
          FROM (
            SELECT c.pieceId, e.end_, e.x, e.y, t.pieceId AS target, t.ga AS tga,
                   ST_Distance(ST_Point(e.x, e.y), t.ga) AS d
            FROM (SELECT * FROM piece WHERE list_contains(${list(candIds)}, pieceId)) c,
                 LATERAL (SELECT 0 AS end_, c.x0 AS x, c.y0 AS y UNION ALL SELECT 1, c.x1, c.y1) e,
                 (SELECT * FROM piece WHERE list_contains(${list(targetIds)}, pieceId)) t
            WHERE t.pieceId <> c.pieceId
              AND e.x >= t.xmin - ${config.attachM} AND e.x <= t.xmax + ${config.attachM}
              AND e.y >= t.ymin - ${config.attachM} AND e.y <= t.ymax + ${config.attachM}))
        WHERE rn = 1 AND d <= ${config.attachM}`);
      for (const r of rows)
        out[endKey(String(r.pieceId), num(r.end_))] = {
          piece: String(r.target),
          distM: num(r.d),
          lon: num(r.lon),
          lat: num(r.lat),
        };
      return out;
    };

    // Gap fill (WP 5.2): one fill piece per path gap, and one joining a course to its receiver
    // when no line does. Geometry is built in Albers metres and transformed at the end.
    type XY = [number, number];
    await db.conn.run(`
      CREATE TABLE fill_rows (
        key INTEGER, river VARCHAR, ord INTEGER, upOrd INTEGER, kind VARCHAR, src VARCHAR, form VARCHAR,
        sourceIds VARCHAR[], connectorM DOUBLE, stretch DOUBLE, endsOffM DOUBLE, ga GEOMETRY)`);
    let nextFillKey = 0;
    const xyOf = (p: readonly [number, number]) => `ST_Point(${p[0]}, ${p[1]})`;
    const dist = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const toAlbers = async (p: readonly [number, number]): Promise<XY> => {
      const [r] = await db.all(
        `SELECT ST_X(g) AS x, ST_Y(g) AS y FROM (SELECT ${albers(`ST_Point(${p[0]}, ${p[1]})`)} AS g)`,
      );
      return [num(r?.x), num(r?.y)];
    };
    const nearestReach = async (slug: string, p: XY) => {
      const [r] = await db.all(`
        SELECT path_order, HYRIV_ID, ST_LineLocatePoint(ga, ${xyOf(p)}) AS f
        FROM river_reach WHERE river = ${lit(slug)}
        ORDER BY ST_Distance(ga, ${xyOf(p)}), HYRIV_ID LIMIT 1`);
      if (!r) throw new Error(`${slug}: no reaches to fill from`);
      return { po: num(r.path_order), id: num(r.HYRIV_ID), f: num(r.f) };
    };
    /** The vertices of reach `po` between the fractions f0 and f1 of its length. */
    const reachPart = async (
      slug: string,
      po: number,
      f0: number,
      f1: number,
    ): Promise<XY[]> => {
      if (!(f1 > f0)) return [];
      const [r] = await db.all(`
        SELECT ST_AsText(ST_LineSubstring(ga, ${f0}, ${f1})) AS wkt
        FROM river_reach WHERE river = ${lit(slug)} AND path_order = ${po}`);
      return r ? parseLineWkt(String(r.wkt)) : [];
    };
    interface Hr {
      /** From the gap's upstream end to its downstream end, connectors included. */
      points: XY[];
      reachIds: number[];
      /** The reaches nearest the two ends, the sources of a straight connector. */
      nearIds: number[];
      connectorM: number;
      /** No HydroRIVERS path joins the ends in flow order: the line is the straight connector. */
      straight: boolean;
    }
    /**
     * The river's reaches between A (upstream) and B (downstream), cut at the points nearest
     * them, with straight connectors to the exact ends.
     */
    const hrBetween = async (slug: string, a: XY, b: XY): Promise<Hr> => {
      const ra = await nearestReach(slug, a);
      const rb = await nearestReach(slug, b);
      const parts: XY[][] = [];
      let reachIds: number[] = [];
      if (ra.po > rb.po) {
        parts.push(await reachPart(slug, ra.po, ra.f, 1));
        const mids = await db.all(`
          SELECT path_order, HYRIV_ID FROM river_reach
          WHERE river = ${lit(slug)} AND path_order < ${ra.po} AND path_order > ${rb.po}
          ORDER BY path_order DESC`);
        for (const m of mids)
          parts.push(await reachPart(slug, num(m.path_order), 0, 1));
        parts.push(await reachPart(slug, rb.po, 0, rb.f));
        reachIds = [ra.id, ...mids.map((m) => num(m.HYRIV_ID)), rb.id];
      } else if (ra.po === rb.po && ra.f < rb.f) {
        parts.push(await reachPart(slug, ra.po, ra.f, rb.f));
        reachIds = [ra.id];
      } else {
        reachIds = ra.id === rb.id ? [ra.id] : [ra.id, rb.id];
      }
      const hr = joinLines(parts);
      const points = joinLines([[a], hr, [b]]);
      const straight = hr.length === 0;
      const connectorM = straight
        ? dist(a, b)
        : dist(a, hr[0]!) + dist(hr[hr.length - 1]!, b);
      const nearIds = ra.id === rb.id ? [ra.id] : [ra.id, rb.id];
      return { points, reachIds, nearIds, connectorM, straight };
    };
    /**
     * From the course end A down the river's HydroRIVERS chain (its mouth reach, then the reaches
     * no approved river holds) to where the receiver's first reach starts; ends at that point.
     */
    const hrToReceiver = async (
      slug: string,
      mouthReach: number,
      a: XY,
    ): Promise<{ points: XY[]; reachIds: number[] }> => {
      const m = await nearestReachOf(slug, mouthReach, a);
      const parts: XY[][] = [await reachPart(slug, 0, m, 1)];
      const reachIds = [mouthReach];
      const chain: number[] = [];
      const seen = new Set<number>(reachIds);
      for (
        let id = nextDown.get(mouthReach) ?? 0;
        id > 0 && !seen.has(id) && !riverOfReach.has(id);
        id = nextDown.get(id) ?? 0
      ) {
        seen.add(id);
        chain.push(id);
      }
      if (chain.length > 0) {
        const rows = await db.all(`
          SELECT HYRIV_ID, ST_AsText(${albers("geom")}) AS wkt
          FROM read_parquet(${lit(reachesFile)})
          WHERE HYRIV_ID IN (${chain.join(", ")})`);
        const byId = new Map(rows.map((r) => [num(r.HYRIV_ID), String(r.wkt)]));
        for (const id of chain) {
          parts.push(parseLineWkt(byId.get(id)!));
          reachIds.push(id);
        }
      }
      return { points: joinLines([[a], ...parts]), reachIds };
    };
    /** Fraction along the mouth reach (path_order 0) nearest to p. */
    const nearestReachOf = async (slug: string, reach: number, p: XY) => {
      const [r] = await db.all(`
        SELECT ST_LineLocatePoint(ga, ${xyOf(p)}) AS f FROM river_reach
        WHERE river = ${lit(slug)} AND HYRIV_ID = ${reach}`);
      return num(r?.f);
    };

    interface FillTask {
      kind: "gap" | "join";
      a: XY;
      /** SQL for the downstream end: a point, or the receiver's course. */
      bSql: string;
      /** The downstream end as a point (the closest point of the receiver for a join). */
      b: XY;
      ord: number | null;
      upOrd: number | null;
      hr: Hr;
      /** The fill_rows key, set once filled. */
      key?: number;
    }
    /** Reads the IGN lines near the tasks into ignm (Albers parts) and name_map. */
    const loadIgn = async (tasks: readonly FillTask[]) => {
      const margin = config.fillCorridorM * 1.2 + 500;
      const zones = tasks.map((t) => {
        const xs = t.hr.points.map((p) => p[0]).concat(t.a[0], t.b[0]);
        const ys = t.hr.points.map((p) => p[1]).concat(t.a[1], t.b[1]);
        return `ST_Transform(ST_MakeEnvelope(${Math.min(...xs) - margin}, ${Math.min(...ys) - margin}, ${Math.max(...xs) + margin}, ${Math.max(...ys) + margin}), ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)`;
      });
      await db.conn.run(`
        CREATE OR REPLACE TABLE fill_zone AS
        SELECT ST_Union_Agg(z) AS g FROM (SELECT unnest([${zones.join(", ")}]) AS z)`);
      await db.conn.run(
        `DROP TABLE IF EXISTS ign_raw; DROP TABLE IF EXISTS ignm`,
      );
      await readIgnLines(
        db,
        "ign_raw",
        ignLayers,
        `ST_Intersects(geom, (SELECT g FROM fill_zone))`,
      );
      await createNameMap(db, "ign_raw", "fna");
      await db.conn.run(`
        CREATE TABLE ignm AS
        SELECT cls, gid, fna, (d).path[1] AS part, ${albers("ST_SetCRS((d).geom, 'EPSG:4326')")} AS ga
        FROM (SELECT cls, gid, fna, unnest(ST_Dump(geom)) AS d FROM ign_raw)
        WHERE ST_GeometryType((d).geom) = 'LINESTRING'`);
    };
    /**
     * The IGN line parts within fillCorridorM of the task's guide, cut where a line passes
     * within fillSnapM of a gap end; endpoints within fillSnapM of an end are marked.
     */
    const ignEdges = async (
      t: FillTask,
      keys: ReadonlySet<string>,
    ): Promise<{
      edges: FillEdge[];
      wkt: Map<string, string>;
      src: Map<string, string>;
    }> => {
      const guide = lineWkt(t.hr.points);
      const straight = lineWkt([t.a, t.b]);
      await db.conn.run(`
        CREATE OR REPLACE TABLE task AS
        SELECT ${xyOf(t.a)} AS a, ${t.bSql} AS b,
               ST_Collect([ST_GeomFromText(${lit(guide)}), ST_GeomFromText(${lit(straight)})]) AS guide`);
      const snap = config.fillSnapM;
      const rows = await db.all(`
        WITH f AS (
          SELECT m.cls, m.gid, m.part, n.name, m.ga, k.a, k.b,
                 ST_Distance(m.ga, k.a) AS da, ST_Distance(m.ga, k.b) AS db
          FROM ignm m CROSS JOIN task k LEFT JOIN name_map n ON n.raw = m.fna
          WHERE ST_Distance(m.ga, k.guide) <= ${config.fillCorridorM}),
        c AS (
          SELECT *,
                 CASE WHEN da <= ${snap} THEN ST_LineLocatePoint(ga, ST_ClosestPoint(ga, a)) END AS fa,
                 CASE WHEN db <= ${snap} THEN ST_LineLocatePoint(ga, ST_ClosestPoint(ga, b)) END AS fb
          FROM f),
        r AS (
          SELECT *, list_sort(list_distinct(list_filter([0.0, 1.0, fa, fb], x -> x IS NOT NULL))) AS fr
          FROM c),
        s AS (
          SELECT cls, gid, part, name, ga, a, b, fr, unnest(generate_series(1, len(fr) - 1)) AS i
          FROM r),
        u AS (SELECT *, ST_LineSubstring(ga, fr[i], fr[i + 1]) AS sub FROM s)
        SELECT cls, gid, part, i, name, ST_AsText(sub) AS wkt, ST_Length(sub) AS len,
               ST_Distance(ST_StartPoint(sub), a) <= ${snap} AS a_start,
               ST_Distance(ST_StartPoint(sub), b) <= ${snap} AS a_end,
               ST_Distance(ST_EndPoint(sub), a) <= ${snap} AS b_start,
               ST_Distance(ST_EndPoint(sub), b) <= ${snap} AS b_end
        FROM u WHERE ST_Length(sub) > 0
        ORDER BY cls, gid, part, i`);
      const edges: FillEdge[] = [];
      const wkt = new Map<string, string>();
      const src = new Map<string, string>();
      for (const r of rows) {
        const id = `ign:${r.cls}:${r.gid}:${r.part}:${r.i}`;
        const pts = parseLineWkt(String(r.wkt));
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        const kind = pieceKind(
          pieceDisplayName(
            { source: "ign", name: r.name == null ? null : String(r.name) },
            index,
          ),
          keys,
        );
        edges.push({
          id,
          lengthM: num(r.len),
          cost: num(r.len) * config.weights[kind],
          a: { x: first[0], y: first[1], start: !!r.a_start, end: !!r.a_end },
          b: { x: last[0], y: last[1], start: !!r.b_start, end: !!r.b_end },
        });
        wkt.set(id, String(r.wkt));
        src.set(id, `ign:${r.cls}:${r.gid}`);
      }
      return { edges, wkt, src };
    };
    /** Fills the tasks of one river (IGN first, then HydroRIVERS) into fill_rows. */
    const fillRiver = async (
      slug: string,
      keys: ReadonlySet<string>,
      tasks: FillTask[],
    ) => {
      if (tasks.length === 0) return;
      await loadIgn(tasks);
      for (const t of tasks) {
        const { edges, wkt, src } = await ignEdges(t, keys);
        const plan = planGapFill(edges, config.fillSnapM);
        // A chain or route longer than this is a detour, not the channel between the ends.
        const straightM = dist(t.a, t.b);
        const allowedM =
          config.fillMaxStretch * straightM + 2 * config.fillSnapM;
        let points: XY[];
        let sourceIds: string[];
        let src_: "ign" | "hydrorivers";
        let form: "chain" | "route" | "connector";
        let connectorM = 0;
        let stretch: number | null = null;
        if (plan.src === "ign" && plan.chain.lengthM <= allowedM) {
          src_ = "ign";
          form = "chain";
          points = joinLines(
            plan.chain.edges.map((e) => {
              const pts = parseLineWkt(wkt.get(e.id)!);
              return e.reversed ? pts.reverse() : pts;
            }),
          );
          sourceIds = [
            ...new Set(plan.chain.edges.map((e) => src.get(e.id)!)),
          ].sort();
          stretch = plan.chain.lengthM / Math.max(straightM, 1);
        } else {
          src_ = "hydrorivers";
          if (plan.src === "ign") ignTooLong.push(slug);
          const routeM = t.hr.points
            .slice(1)
            .reduce((sum, p, i) => sum + dist(t.hr.points[i]!, p), 0);
          if (!t.hr.straight && routeM <= allowedM) {
            form = "route";
            points = t.hr.points;
            sourceIds = t.hr.reachIds.map((id) => `hyriv:${id}`);
            connectorM = t.hr.connectorM;
          } else {
            form = "connector";
            points = [t.a, t.b];
            sourceIds = t.hr.nearIds.map((id) => `hyriv:${id}`);
            connectorM = straightM;
          }
        }
        // How far the fill's ends lie from the gap's ends (a join has no downstream point).
        const endsOffM = Math.max(
          dist(points[0]!, t.a),
          t.kind === "gap" ? dist(points[points.length - 1]!, t.b) : 0,
        );
        const key = nextFillKey++;
        await db.conn.run(`
          INSERT INTO fill_rows VALUES (${key}, ${lit(slug)}, ${t.ord ?? "NULL"}, ${t.upOrd ?? "NULL"},
            ${lit(t.kind)}, ${lit(src_)}, ${lit(form)}, [${sourceIds.map(lit).join(", ")}]::VARCHAR[],
            ${connectorM}, ${stretch ?? "NULL"}, ${endsOffM}, ST_GeomFromText(${lit(lineWkt(points))}))`);
        t.key = key;
      }
    };

    const claimedBy = new Map<string, string>();
    const perRiver: Record<string, unknown>[] = [];
    const csv: string[] = ["pieceId,river,order,role"];
    const gapRows: Record<string, unknown>[] = [];
    const overlaps: Record<string, unknown>[] = [];
    const csvRows: {
      river: string;
      order: number | null;
      id: string;
      line: string;
    }[] = [];
    const lowShare: string[] = [];
    /** Rivers whose cut meets a river other than their receiver, or that have none. */
    const cutsAtOther: string[] = [];
    const nearOtherRivers: string[] = [];
    /** Rivers with an IGN chain that joined the ends but was longer than allowed (fillMaxStretch). */
    const ignTooLong: string[] = [];
    /** Rivers whose receiver the course meets neither by a cut nor by a join fill. */
    const receiversMissing: string[] = [];
    const joined: {
      report: { joinedBy: string | null };
      key: number;
    }[] = [];
    let allHaveCourse = true;
    let anchorsNear = true;

    for (const slug of order) {
      const entry = entryOf.get(slug)!;
      const rows = reachRows.filter((r) => String(r.river) === slug);
      if (rows.length === 0)
        throw new Error(`${slug}: no reaches in river_reaches.parquet`);
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      if (
        num(first.path_order) !== 0 ||
        num(first.HYRIV_ID) !== entry.mouthReach
      )
        throw new Error(
          `${slug}: path_order 0 is not the mouth reach ${entry.mouthReach}`,
        );
      const roots = new Set(rows.map((r) => String(r.root)));
      const keys = ownNameKeys(entry);
      const corridor = new Set(
        (
          await db.all(`
            SELECT DISTINCT p.pieceId FROM piece p
            JOIN river_reach r ON r.river = ${lit(slug)} AND r.root = p.root
              AND p.xmax >= r.xmin - ${config.corridorM} AND p.xmin <= r.xmax + ${config.corridorM}
              AND p.ymax >= r.ymin - ${config.corridorM} AND p.ymin <= r.ymax + ${config.corridorM}
              AND ST_Distance(p.ga, r.ga) <= ${config.corridorM}`)
        ).map((r) => String(r.pieceId)),
      );
      const [undrawn] = await db.all(`
        SELECT count(*) AS n, coalesce(sum(length_m), 0) / 1000 AS km FROM undrawn u
        WHERE u.pieceId IN (
          SELECT u2.pieceId FROM undrawn u2
          JOIN river_reach r ON r.river = ${lit(slug)} AND r.root = u2.root
            AND u2.xmax >= r.xmin - ${config.corridorM} AND u2.xmin <= r.xmax + ${config.corridorM}
            AND u2.ymax >= r.ymin - ${config.corridorM} AND u2.ymin <= r.ymax + ${config.corridorM}
            AND ST_Distance(u2.ga, r.ga) <= ${config.corridorM})`);
      const candidates: (CoursePiece & { row: PieceRow })[] = [];
      for (const row of pieces.values()) {
        if (
          !roots.has(row.root) ||
          classExcluded(row.cls, config.excludeClasses)
        )
          continue;
        const kind = pieceKind(row.display, keys);
        if (!corridor.has(row.id) && kind !== "own") continue;
        candidates.push({
          id: row.id,
          lengthM: row.lengthM,
          kind,
          a: row.a,
          b: row.b,
          row,
        });
      }
      const ownCandidateKm =
        candidates
          .filter((c) => c.kind === "own" && !claimedBy.has(c.id))
          .reduce((s, c) => s + c.lengthM, 0) / 1000;

      const claimedIds = candidates
        .filter((c) => claimedBy.has(c.id))
        .map((c) => c.id);
      // The river the data say this one flows into. Its pieces are the only ones a line end
      // within attachM can cut the course against (R5.1 review); any piece another river holds
      // still ends the course where a line shares its junction.
      const receiver = receivers.find((r) => r.slug === slug)!.receiver;
      const heldByReceiver = receiverPieces(claimedBy, receiver);
      const input = {
        pieces: candidates,
        claimed: new Set(claimedIds),
        receiver: new Set(heldByReceiver),
        source: { x: num(last.sx), y: num(last.sy) },
        mouth: { x: num(first.ex), y: num(first.ey) },
        nearHeld: await near(
          candidates.filter((c) => !claimedBy.has(c.id)).map((c) => c.id),
          heldByReceiver,
        ),
        config,
      };
      // First pass: the main course. Second pass: own-named line ends outside it that lie
      // within attachM of the interior of a course piece may join it there.
      let result: CourseResult = buildCourse(input);
      if (result.failure === null) {
        const inCourse = new Set(result.entries.map((e) => e.id));
        const mainCourse = result.entries
          .filter((e) => e.part === "main")
          .map((e) => e.id);
        const nearCourse = await near(
          candidates
            .filter(
              (c) =>
                c.kind === "own" && !claimedBy.has(c.id) && !inCourse.has(c.id),
            )
            .map((c) => c.id),
          mainCourse,
        );
        if (Object.keys(nearCourse).length > 0)
          result = buildCourse({ ...input, nearCourse });
      }
      // The main course must exist: extensions alone are not a course.
      const hasCourse =
        result.failure === null &&
        result.entries.some((e) => e.part === "main");
      allHaveCourse &&= hasCourse;
      anchorsNear &&=
        result.anchorDistM.source <= config.anchorMaxM &&
        result.anchorDistM.mouth <= config.anchorMaxM;

      const courseIds = new Set(result.entries.map((e) => e.id));
      const inList = (ids: Iterable<string>) => [...ids].map(lit).join(", ");

      // Whether the course met its receiver: cut against one of its pieces.
      let receiverNotReached: {
        receiver: string;
        nearestM: number | null;
        joinedBy: string | null;
      } | null = null;
      if (receiver !== null) {
        const met =
          result.cut !== null &&
          result.cut.claimedPieces.some((p) => claimedBy.get(p) === receiver);
        if (!met) {
          const theirs = [...claimedBy]
            .filter(([, r]) => r === receiver)
            .map(([id]) => id);
          let nearestM: number | null = null;
          if (courseIds.size > 0 && theirs.length > 0) {
            const [d] = await db.all(`
              SELECT min(ST_Distance(a.ga, b.ga)) AS d FROM piece a, piece b
              WHERE a.pieceId IN (${inList(courseIds)}) AND b.pieceId IN (${inList(theirs)})`);
            nearestM = d?.d == null ? null : round(num(d.d), 1);
          }
          receiverNotReached = { receiver, nearestM, joinedBy: null };
        }
      }

      // Gap fill: one task per path gap, plus one joining the course to its receiver.
      const fillTasks: FillTask[] = [];
      const gapTask = new Map<number, FillTask>();
      let joinTask: FillTask | null = null;
      if (result.failure === null) {
        for (const [gi, g] of result.gaps.entries()) {
          if (g.kind !== "path") continue;
          const a = await toAlbers(g.from);
          const b = await toAlbers(g.to);
          const t: FillTask = {
            kind: "gap",
            a,
            b,
            bSql: xyOf(b),
            ord: g.downOrder,
            upOrd: g.upOrder,
            hr: await hrBetween(slug, a, b),
          };
          fillTasks.push(t);
          gapTask.set(gi, t);
        }
        if (receiverNotReached !== null && result.mouthPoint !== null) {
          const a: XY = [result.mouthPoint.x, result.mouthPoint.y];
          const toReceiver = await hrToReceiver(slug, entry.mouthReach, a);
          const last = toReceiver.points[toReceiver.points.length - 1]!;
          const target = `(SELECT ST_Union_Agg(ga) FROM (
              SELECT ga FROM piece WHERE pieceId IN (${inList(
                [...claimedBy]
                  .filter(([, r]) => r === receiver)
                  .map(([id]) => id),
              )})
              UNION ALL SELECT ga FROM fill_rows WHERE river = ${lit(receiver!)}))`;
          const [c] = await db.all(`
            SELECT ST_X(p) AS x, ST_Y(p) AS y
            FROM (SELECT ST_ClosestPoint(${target}, ${xyOf(last)}) AS p)`);
          const b: XY = [num(c?.x), num(c?.y)];
          if (dist(a, b) > 1) {
            const points = joinLines([toReceiver.points, [b]]);
            joinTask = {
              kind: "join",
              a,
              b,
              bSql: target,
              ord: null,
              upOrd: 0,
              hr: {
                points,
                reachIds: toReceiver.reachIds,
                nearIds: [entry.mouthReach],
                connectorM:
                  toReceiver.points.length > 1
                    ? dist(a, toReceiver.points[1]!) + dist(last, b)
                    : dist(a, b),
                straight: toReceiver.points.length <= 1,
              },
            };
            fillTasks.push(joinTask);
          }
        }
        await fillRiver(slug, keys, fillTasks);
      }
      if (receiverNotReached !== null) {
        if (joinTask?.key !== undefined)
          joined.push({ report: receiverNotReached, key: joinTask.key });
        else receiversMissing.push(slug);
      }

      // Arms farther than armMaxFromCourseM from the course (pieces and fill) are not part of
      // the river (a chain of own-named breaks can wander far).
      const armDistM = new Map<string, number>();
      if (result.arms.length > 0 && courseIds.size > 0)
        for (const r of await db.all(`
          SELECT a.pieceId, min(ST_Distance(a.ga, c.ga)) AS d
          FROM piece a,
               (SELECT ga FROM piece WHERE pieceId IN (${inList(courseIds)})
                UNION ALL SELECT ga FROM fill_rows WHERE river = ${lit(slug)}) c
          WHERE a.pieceId IN (${inList(result.arms.map((a) => a.id))})
          GROUP BY a.pieceId`))
          armDistM.set(String(r.pieceId), num(r.d));
      const arms = result.arms.filter(
        (a) => (armDistM.get(a.id) ?? Infinity) <= config.armMaxFromCourseM,
      );
      const armsBeyond = result.arms.filter(
        (a) => (armDistM.get(a.id) ?? Infinity) > config.armMaxFromCourseM,
      );
      const armFarthest = [...armDistM]
        .sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))
        .slice(0, TOP_LEFT_OUT)
        .map(([id, d]) => ({ id, distM: round(d, 1) }));

      // Course pieces whose ends lie within attachM of the interior of a piece of a river other
      // than the receiver: not a cut (R5.1 review), flagged.
      const nearOther = await near(
        [...courseIds],
        [...claimedBy].filter(([, r]) => r !== receiver).map(([id]) => id),
      );

      // Own-named lines the course leaves out: the biggest five by candidate km, and how far
      // each lies from the course, to judge a share below the target.
      const armIds = new Set(arms.map((a) => a.id));
      const leftOut = new Map<
        string,
        { lineId: string; name: string | null; km: number; ids: string[] }
      >();
      for (const c of candidates) {
        if (
          c.kind !== "own" ||
          claimedBy.has(c.id) ||
          courseIds.has(c.id) ||
          armIds.has(c.id)
        )
          continue;
        const l = leftOut.get(c.row.lineId) ?? {
          lineId: c.row.lineId,
          name: c.row.display,
          km: 0,
          ids: [],
        };
        l.km += c.lengthM / 1000;
        l.ids.push(c.id);
        leftOut.set(c.row.lineId, l);
      }
      const leftOutTop = [...leftOut.values()]
        .sort((p, q) => q.km - p.km || (p.lineId < q.lineId ? -1 : 1))
        .slice(0, TOP_LEFT_OUT);
      const ownLeftOut = [];
      for (const l of leftOutTop) {
        let minDistM: number | null = null;
        if (courseIds.size > 0) {
          const [d] = await db.all(`
            SELECT min(ST_Distance(a.ga, b.ga)) AS d FROM piece a, piece b
            WHERE a.pieceId IN (${inList(l.ids)}) AND b.pieceId IN (${inList(courseIds)})`);
          minDistM = d?.d == null ? null : round(num(d.d), 1);
        }
        ownLeftOut.push({
          lineId: l.lineId,
          name: l.name,
          km: round(l.km, 3),
          minDistToCourseM: minDistM,
        });
      }

      const km = {
        own: { aprhi: 0, ign: 0 },
        bridge: { aprhi: 0, ign: 0 },
      } as Record<"own" | "bridge", Record<string, number>>;
      const bridgeByName = new Map<string, number>();
      for (const e of result.entries) {
        const row = pieces.get(e.id)!;
        km[e.role][row.source] =
          (km[e.role][row.source] ?? 0) + e.lengthM / 1000;
        if (e.role === "bridge") {
          const n = row.display ?? "(unnamed)";
          bridgeByName.set(n, (bridgeByName.get(n) ?? 0) + e.lengthM / 1000);
        }
        claimedBy.set(e.id, slug);
        csvRows.push({
          river: slug,
          order: e.order,
          id: e.id,
          line: `${e.id},${slug},${e.order},${e.role}`,
        });
      }
      // Arms belong to the river (highlight, click) but are not in the course km.
      const armKm = { aprhi: 0, ign: 0 } as Record<string, number>;
      for (const a of arms) {
        const row = pieces.get(a.id)!;
        armKm[row.source] = (armKm[row.source] ?? 0) + a.lengthM / 1000;
        claimedBy.set(a.id, slug);
        csvRows.push({
          river: slug,
          order: null,
          id: a.id,
          line: `${a.id},${slug},,arm`,
        });
      }
      const armsKm = Object.values(armKm).reduce((sum, v) => sum + v, 0);
      const ownKm = Object.values(km.own).reduce((s, v) => s + v, 0);
      const bridgeKm = Object.values(km.bridge).reduce((s, v) => s + v, 0);
      const ownShare = ownCandidateKm > 0 ? ownKm / ownCandidateKm : null;
      const shareWithArms =
        ownCandidateKm > 0 ? (ownKm + armsKm) / ownCandidateKm : null;
      if (shareWithArms !== null && shareWithArms < config.ownShareTarget)
        lowShare.push(slug);

      // Gaps: the river's reaches between the nearest reaches of both ends, when derivable.
      const gaps: Record<string, unknown>[] = [];
      for (const [gi, g] of result.gaps.entries()) {
        const nearReach = async (p: [number, number]) => {
          const [r] = await db.all(`
            SELECT path_order FROM river_reach WHERE river = ${lit(slug)}
            ORDER BY ST_Distance(${albers(`ST_Point(${p[0]}, ${p[1]})`)}, ga), HYRIV_ID LIMIT 1`);
          return r === undefined ? null : num(r.path_order);
        };
        const up = await nearReach(g.from);
        const down = await nearReach(g.to);
        const reaches =
          up === null || down === null
            ? null
            : rows
                .filter(
                  (r) =>
                    num(r.path_order) >= Math.min(up, down) &&
                    num(r.path_order) <= Math.max(up, down),
                )
                .map((r) => num(r.HYRIV_ID));
        gaps.push({
          river: slug,
          kind: g.kind,
          ...(g.piece ? { piece: g.piece } : {}),
          downOrder: g.downOrder,
          upOrder: g.upOrder,
          from: g.from,
          to: g.to,
          km: round(g.km, 3),
          reaches,
          ...(gapTask.get(gi)?.key !== undefined
            ? { fillKey: gapTask.get(gi)!.key }
            : {}),
        });
      }
      for (const a of result.attachments)
        gaps.push({
          river: slug,
          kind: "attach",
          piece: a.piece,
          armPiece: a.armPiece,
          downOrder: null,
          upOrder: null,
          from: a.from,
          to: a.to,
          km: round(a.distM / 1000, 3),
          distM: round(a.distM, 1),
          reaches: null,
        });
      for (const b of result.armBreaks)
        gaps.push({
          river: slug,
          kind: "arm-break",
          pieceA: b.pieceA,
          pieceB: b.pieceB,
          downOrder: null,
          upOrder: null,
          from: b.from,
          to: b.to,
          km: round(b.distM / 1000, 3),
          distM: round(b.distM, 1),
          reaches: null,
        });
      gapRows.push(...gaps);
      if (Object.keys(nearOther).length > 0) nearOtherRivers.push(slug);

      if (result.cut) {
        const into = [
          ...new Set(
            result.cut.claimedPieces.map((p) => claimedBy.get(p) ?? "?"),
          ),
        ].sort();
        if (receiver === null || into.some((r) => r !== receiver))
          cutsAtOther.push(slug);
        overlaps.push({
          river: slug,
          receiver,
          cutAt: [result.cut.lon, result.cut.lat],
          meets: into,
          claimedPieces: result.cut.claimedPieces,
          nearest: result.cut.nearest
            ? {
                piece: result.cut.nearest.piece,
                river: claimedBy.get(result.cut.nearest.piece) ?? null,
                distM: round(result.cut.nearest.distM, 1),
                point: [result.cut.nearest.lon, result.cut.nearest.lat],
              }
            : null,
        });
      }
      perRiver.push({
        river: slug,
        failure: result.failure,
        pieces: result.entries.length,
        courseKm: {
          total: round(ownKm + bridgeKm, 3),
          own: round(ownKm, 3),
          bridge: round(bridgeKm, 3),
          bySource: {
            own: roundAll(km.own),
            bridge: roundAll(km.bridge),
          },
        },
        ownNamed: {
          inCourseKm: round(ownKm, 3),
          amongCandidatesKm: round(ownCandidateKm, 3),
          share: ownShare === null ? null : round(ownShare, 4),
          armsKm: round(armsKm, 3),
          shareWithArms:
            shareWithArms === null ? null : round(shareWithArms, 4),
          target: config.ownShareTarget,
          meetsTarget:
            shareWithArms === null
              ? null
              : shareWithArms >= config.ownShareTarget,
        },
        arms: {
          note: "own-named pieces joined to the course through own-named pieces only; part of the river, not of the course km",
          pieces: arms.length,
          km: round(armsKm, 3),
          bySource: roundAll(armKm),
          maxFromCourseM: config.armMaxFromCourseM,
          farthestFromCourseM: armFarthest,
          beyondCap: {
            note: "arm pieces farther than armMaxFromCourseM from the course (pieces and fill); left out of the river",
            pieces: armsBeyond.length,
            km: round(
              armsBeyond.reduce((sum, a) => sum + a.lengthM, 0) / 1000,
              3,
            ),
          },
        },
        courseNearOtherRivers: {
          note: "course pieces with an end within attachM of the interior of a piece of a river other than the receiver; not a cut",
          count: Object.keys(nearOther).length,
          top: Object.entries(nearOther)
            .sort((p, q) => p[1].distM - q[1].distM || (p[0] < q[0] ? -1 : 1))
            .slice(0, TOP)
            .map(([key, n]) => ({
              end: key,
              piece: n.piece,
              river: claimedBy.get(n.piece) ?? null,
              distM: round(n.distM, 1),
            })),
        },
        receiverExtended: result.receiverExtension
          ? {
              km: round(result.receiverExtension.km, 3),
              pieces: result.receiverExtension.pieces,
            }
          : null,
        bridgeTopNames: [...bridgeByName.entries()]
          .sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))
          .slice(0, TOP)
          .map(([name, k]) => ({ name, km: round(k, 3) })),
        gaps: {
          count: result.gaps.length,
          km: round(
            result.gaps.reduce((s, g) => s + g.km, 0),
            3,
          ),
        },
        attachments: result.attachments.length,
        armBreaks: {
          note: "breaks up to extensionGapM the arm search crossed between own-named lines (gaps.json kind arm-break); arm km stay outside the course km",
          count: result.armBreaks.length,
          km: round(
            result.armBreaks.reduce((sum, b) => sum + b.distM, 0) / 1000,
            3,
          ),
        },
        emptyGeometryPieces: {
          note: "pieces drawn nowhere (empty geometry in lakes/line_geom.parquet) within the river's corridor; not repaired",
          count: num(undrawn?.n),
          km: round(num(undrawn?.km), 3),
        },
        receiverNotReached,
        smallOwnPiecesDropped: {
          note: "own-named pieces left out because both ends snap to one node (snapM)",
          count: result.collapsedOwn.count,
          km: round(result.collapsedOwn.km, 3),
        },
        mouthExtended: result.mouthExtension
          ? {
              lakeId: result.mouthExtension.lakeId,
              km: round(result.mouthExtension.km, 3),
              pieces: result.mouthExtension.pieces,
            }
          : null,
        mouthLake: result.mouthLake
          ? {
              lakeId: result.mouthLake.lakeId,
              distM: round(result.mouthLake.distM, 1),
            }
          : null,
        sourceExtendedKm: round(result.sourceExtensionKm, 3),
        cutAt: result.cut
          ? {
              at: [result.cut.lon, result.cut.lat],
              piece: result.cut.nearest?.piece ?? null,
              distM:
                result.cut.nearest === null
                  ? null
                  : round(result.cut.nearest.distM, 1),
            }
          : null,
        anchors: {
          source: {
            distM: round(result.anchorDistM.source, 1),
            rule: result.anchorRule.source,
          },
          mouth: {
            distM: round(result.anchorDistM.mouth, 1),
            rule: result.anchorRule.mouth,
          },
        },
        ownNamedLeftOut: {
          note: `the ${TOP_LEFT_OUT} biggest own-named lines among the candidates not in the course (km of their candidate pieces, nearest distance in m to the course)`,
          totalKm: round(
            [...leftOut.values()].reduce((sum, l) => sum + l.km, 0),
            3,
          ),
          lines: ownLeftOut,
        },
        candidates: candidates.length,
      });
      log(
        `${slug}: ${result.entries.length} pieces, ${round(ownKm + bridgeKm, 1)} km (own ${round(ownKm, 1)}), ${gaps.length} gaps${result.failure ? `, FAILED: ${result.failure}` : ""}`,
      );
    }

    // 6. Fill pieces: ids by source in a stable order, then fill.parquet.
    await db.conn.run(`
      CREATE TABLE fill_out0 AS
      SELECT 'fill:' || CASE src WHEN 'ign' THEN 'ign' ELSE 'hr' END || ':' ||
               CAST(row_number() OVER (PARTITION BY src ORDER BY river, coalesce(ord, -1),
                 coalesce(upOrd, -1), kind, ST_X(ST_StartPoint(ga)), ST_Y(ST_StartPoint(ga)), key) - 1 AS VARCHAR) AS pieceId,
             key, river, ord AS "order", upOrd AS upOrder, kind, src, form, true AS fill, sourceIds,
             connectorM, stretch, endsOffM,
             ST_Transform(ga, ${lit(ALBERS)}, 'EPSG:4326', always_xy := true) AS geom
      FROM fill_rows`);
    await db.conn.run(`
      CREATE TABLE fill_out AS
      SELECT *, ${lengthSpheroidKm("geom")} AS lengthKm FROM fill_out0`);
    await db.conn.run(`
      COPY (SELECT pieceId, river, "order", upOrder, kind, src, form, fill, sourceIds, connectorM, lengthKm, geom
            FROM fill_out ORDER BY pieceId)
      TO ${lit(fillParquet)} (FORMAT parquet)`);
    const fillSha = await sha256(fillParquet);
    const fillRows = await db.all(`
      SELECT pieceId, key, river, kind, src, form, lengthKm, connectorM, stretch, endsOffM
      FROM fill_out ORDER BY pieceId`);
    const idOfKey = new Map(
      fillRows.map((r) => [num(r.key), String(r.pieceId)]),
    );
    for (const j of joined) j.report.joinedBy = idOfKey.get(j.key) ?? null;
    let unfilledGaps = 0;
    for (const g of gapRows) {
      if (g.kind !== "path") continue;
      const key = g.fillKey as number | undefined;
      delete g.fillKey;
      if (key === undefined) {
        unfilledGaps++;
        g.filledBy = null;
      } else g.filledBy = idOfKey.get(key) ?? null;
    }
    const maxEndsOffM = fillRows.reduce(
      (m, r) => Math.max(m, num(r.endsOffM)),
      0,
    );
    for (const r of perRiver) {
      const mine = fillRows.filter((f) => String(f.river) === r.river);
      const kmBy = (src: string) =>
        mine
          .filter((f) => f.src === src)
          .reduce((sum, f) => sum + num(f.lengthKm), 0);
      const kmByForm = (form: string) =>
        mine
          .filter((f) => f.form === form)
          .reduce((sum, f) => sum + num(f.lengthKm), 0);
      const join = mine.find((f) => f.kind === "join");
      r.fill = {
        pieces: mine.length,
        gapPieces: mine.filter((f) => f.kind === "gap").length,
        km: {
          ign: round(kmBy("ign"), 3),
          hydrorivers: round(kmBy("hydrorivers"), 3),
          note: "hydrorivers km include the straight connectors to the exact gap ends",
          byForm: {
            chain: round(kmByForm("chain"), 3),
            route: round(kmByForm("route"), 3),
            connector: round(kmByForm("connector"), 3),
          },
        },
        hydroriversRoutes: mine.filter((f) => f.form === "route").length,
        straightConnectors: {
          note: "no credible HydroRIVERS route between the ends (longer than fillMaxStretch allows): a straight line between the exact ends, traced to the nearest reaches",
          pieces: mine.filter((f) => f.form === "connector").length,
          km: round(
            mine
              .filter((f) => f.form === "connector")
              .reduce((sum, f) => sum + num(f.lengthKm), 0),
            3,
          ),
        },
        hydroriversConnectorKm: round(
          mine.reduce((sum, f) => sum + num(f.connectorM), 0) / 1000,
          3,
        ),
        join: join
          ? {
              pieceId: String(join.pieceId),
              src: String(join.src),
              km: round(num(join.lengthKm), 3),
            }
          : null,
      };
    }
    const fillKmBySource = (src: string) =>
      round(
        fillRows
          .filter((f) => f.src === src)
          .reduce((sum, f) => sum + num(f.lengthKm), 0),
        3,
      );
    const fillKmByForm = (form: string) =>
      round(
        fillRows
          .filter((f) => f.form === form)
          .reduce((sum, f) => sum + num(f.lengthKm), 0),
        3,
      );
    const fillTop = [...fillRows]
      .sort((p, q) => num(q.lengthKm) - num(p.lengthKm))
      .slice(0, TOP)
      .map((f) => ({
        pieceId: String(f.pieceId),
        river: String(f.river),
        kind: String(f.kind),
        src: String(f.src),
        km: round(num(f.lengthKm), 3),
        form: String(f.form),
        connectorKm: round(num(f.connectorM) / 1000, 3),
        stretch: f.stretch == null ? null : round(num(f.stretch), 2),
      }));
    const fillStretchTop = fillRows
      .filter((f) => f.stretch != null)
      .sort((p, q) => num(q.stretch) - num(p.stretch))
      .slice(0, TOP_LEFT_OUT)
      .map((f) => ({
        pieceId: String(f.pieceId),
        river: String(f.river),
        km: round(num(f.lengthKm), 3),
        stretch: round(num(f.stretch), 2),
      }));

    // 7. Outputs, sorted.
    csvRows.sort((p, q) =>
      p.river < q.river
        ? -1
        : p.river > q.river
          ? 1
          : p.order === null || q.order === null
            ? (p.order === null ? 1 : 0) - (q.order === null ? 1 : 0) ||
              (p.id < q.id ? -1 : 1)
            : p.order - q.order,
    );
    csv.push(...csvRows.map((r) => r.line));
    const csvFile = `${outDir}/course.csv`;
    await writeFile(csvFile, csv.join("\n") + "\n");
    await db.conn.run(`
      COPY (SELECT * FROM read_csv(${lit(csvFile)}, header = true,
              nullstr = '',
              columns = {'pieceId': 'VARCHAR', 'river': 'VARCHAR', 'order': 'INTEGER', 'role': 'VARCHAR'})
            ORDER BY river, "order" NULLS LAST, pieceId)
      TO ${lit(parquet)} (FORMAT parquet)`);
    await rm(csvFile);
    const sha = await sha256(parquet);
    const gapKey = (g: Record<string, unknown>) =>
      `${g.river}|${String(num(g.upOrder ?? -1) + 1).padStart(8, "0")}|${g.kind}|${JSON.stringify(g.from)}|${g.armPiece ?? ""}`;
    gapRows.sort((p, q) => {
      const a = gapKey(p);
      const b = gapKey(q);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    await writeFile(
      `${outDir}/gaps.json`,
      JSON.stringify(gapRows, null, 2) + "\n",
    );

    const [dup] = await db.all(`
      SELECT count(*) AS rows, count(DISTINCT pieceId) AS pieces FROM read_parquet(${lit(parquet)})`);
    const checks = {
      everyRiverHasACourse: allHaveCourse && perRiver.length === rivers.length,
      noPieceInTwoRivers: num(dup?.rows) === num(dup?.pieces),
      anchorsWithinAnchorMaxM: anchorsNear,
      noGapLeft: unfilledGaps === 0 && maxEndsOffM <= config.fillSnapM,
      receiversReached: receiversMissing.length === 0,
      everyCutMeetsItsReceiver: cutsAtOther.length === 0,
    };
    const identicalToPreviousRun =
      previousSha === null || previousFillSha === null
        ? null
        : previousSha === sha && previousFillSha === fillSha;
    const ok =
      Object.values(checks).every(Boolean) && identicalToPreviousRun !== false;

    await writeReport("river-lines", {
      ok,
      durationMs: Date.now() - t0,
      checks,
      warnings: {
        courseNearOtherRiversPiece: nearOtherRivers,
        courseNearOtherRiversNote:
          "rivers whose course has a piece end within attachM of a piece of a river other than their receiver (not cut there)",
        ownShareBelowTarget: lowShare,
        note: "a river whose course plus arms hold less of its own-named candidate km than config.ownShareTarget; warns until the settings are calibrated",
      },
      pendingChecks: {
        identicalToPreviousRun,
        note: "null on a first run (no earlier course.parquet and fill.parquet); run the step twice. false fails the step.",
      },
      checkDetails: {
        noGapLeft: {
          unfilledPathGaps: unfilledGaps,
          maxFillEndOffGapEndM: round(maxEndsOffM, 1),
          fillSnapM: config.fillSnapM,
        },
        receiversNotReached: receiversMissing,
        cutsNotAtReceiver: cutsAtOther,
      },
      fill: {
        pieces: fillRows.length,
        km: {
          ign: fillKmBySource("ign"),
          hydrorivers: fillKmBySource("hydrorivers"),
          byForm: {
            chain: fillKmByForm("chain"),
            route: fillKmByForm("route"),
            connector: fillKmByForm("connector"),
          },
        },
        ignChainsTooLongRivers: [...new Set(ignTooLong)].sort(),
        straightConnectors: {
          pieces: fillRows.filter((f) => f.form === "connector").length,
          km: round(
            fillRows
              .filter((f) => f.form === "connector")
              .reduce((sum, f) => sum + num(f.lengthKm), 0),
            3,
          ),
        },
        largest: fillTop,
        highestIgnStretch: {
          note: "IGN chain length over the straight distance between the gap ends",
          pieces: fillStretchTop,
        },
      },
      config: { ...config },
      sha256: sha,
      previousSha256: previousSha,
      fillSha256: fillSha,
      previousFillSha256: previousFillSha,
      pieces: { lines: num(counts?.lines), drawn: num(counts?.drawn) },
      processingOrder: receivers
        .map((r) => r.slug)
        .sort((p, q) => order.indexOf(p) - order.indexOf(q))
        .map((slug) => ({
          river: slug,
          receiver: receivers.find((r) => r.slug === slug)!.receiver,
        })),
      overlaps,
      rivers: perRiver,
      outputs: [rel(parquet), rel(fillParquet), rel(`${outDir}/gaps.json`)],
    });
    log(`done, ${Date.now() - t0} ms`);
    if (!ok)
      throw new Error(
        `river-lines checks failed: ${JSON.stringify({ ...checks, identicalToPreviousRun })}`,
      );
  } finally {
    db.close();
  }
}

const roundAll = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v, 3)]));

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
