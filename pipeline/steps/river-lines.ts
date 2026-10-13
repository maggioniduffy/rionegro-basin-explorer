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
 *    order. A later river's course is cut where it reaches a piece an earlier one holds: at a
 *    shared junction, or at a line end within attachM of the interior of such a piece. Gaps (no
 *    line connects) are recorded in gaps.json, never filled (WP 5.2).
 * 4. Two passes per river: the first gives the main course; the step then measures how far the
 *    own-named line ends outside it lie from the interior of the course pieces (attachM), and
 *    the second pass lets those lines join the course there, as arms or as the continuation of
 *    the mouth extension. Pieces are never split: attachments only add connectivity.
 *
 * Output: data/work/<id>/river-lines/course.parquet (pieceId, river, order, role; order 0 is the
 * mouth end; role own | bridge for the course, arm for own-named pieces joined to it, with a
 * null order), gaps.json (path gaps, extension breaks and attachments) and report.json. The
 * intermediate course.csv is removed. Outputs are sorted, so two runs give the same files.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { ALBERS } from "../lib/ign";
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
  type NearPiece,
  buildCourse,
  classExcluded,
  endKey,
  findReceiver,
  ownNameKeys,
  parseRiverLinesConfig,
  pieceKind,
  processingOrder,
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
  await mkdir(outDir, { recursive: true });
  const previousSha = existsSync(parquet) ? await sha256(parquet) : null;

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
      const input = {
        pieces: candidates,
        claimed: new Set(claimedIds),
        source: { x: num(last.sx), y: num(last.sy) },
        mouth: { x: num(first.ex), y: num(first.ey) },
        nearHeld: await near(
          candidates.filter((c) => !claimedBy.has(c.id)).map((c) => c.id),
          [...claimedBy.keys()],
        ),
        config,
      };
      // First pass: the main course. Second pass: own-named line ends outside it that lie
      // within attachM of the interior of a course piece may join it there.
      let result: CourseResult = buildCourse(input);
      if (result.failure === null) {
        const inCourse = new Set(result.entries.map((e) => e.id));
        const nearCourse = await near(
          candidates
            .filter(
              (c) =>
                c.kind === "own" && !claimedBy.has(c.id) && !inCourse.has(c.id),
            )
            .map((c) => c.id),
          [...inCourse],
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

      // Own-named lines the course leaves out: the biggest five by candidate km, and how far
      // each lies from the course, to judge a share below the target.
      const courseIds = new Set(result.entries.map((e) => e.id));
      const armIds = new Set(result.arms.map((a) => a.id));
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
      const inList = (ids: Iterable<string>) => [...ids].map(lit).join(", ");
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
      for (const a of result.arms) {
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
      for (const g of result.gaps) {
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

      // The river the data say this one flows into, when the course was not cut against it.
      const receiver = receivers.find((r) => r.slug === slug)!.receiver;
      let receiverNotReached: {
        receiver: string;
        nearestM: number | null;
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
          receiverNotReached = { receiver, nearestM };
        }
      }

      if (result.cut) {
        const into = [
          ...new Set(
            result.cut.claimedPieces.map((p) => claimedBy.get(p) ?? "?"),
          ),
        ].sort();
        overlaps.push({
          river: slug,
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
          pieces: result.arms.length,
          km: round(armsKm, 3),
          bySource: roundAll(armKm),
        },
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

    // 6. Outputs, sorted.
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
    };
    const identicalToPreviousRun =
      previousSha === null ? null : previousSha === sha;
    const ok =
      Object.values(checks).every(Boolean) && identicalToPreviousRun !== false;

    await writeReport("river-lines", {
      ok,
      durationMs: Date.now() - t0,
      checks,
      warnings: {
        ownShareBelowTarget: lowShare,
        note: "a river whose course plus arms hold less of its own-named candidate km than config.ownShareTarget; warns until the settings are calibrated",
      },
      pendingChecks: {
        identicalToPreviousRun,
        note: "null on a first run (no earlier course.parquet); run the step twice. false fails the step.",
      },
      config: { ...config },
      sha256: sha,
      previousSha256: previousSha,
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
      outputs: [rel(parquet), rel(`${outDir}/gaps.json`)],
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
