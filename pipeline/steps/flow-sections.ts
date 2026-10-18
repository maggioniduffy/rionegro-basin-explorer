/**
 * pipeline:flow-sections — each named river's IGN course cut into 3-5 km sections for the flow
 * close-up (F1.1). Needs regions/<id>/flow.config.json; a region without it stops with a
 * message. Runs after pipeline:ign, :ign-match, :named, :lakes and :rivers (and :export, whose
 * reaches.ndjson holds the regulation percentages).
 *
 * 1. Course: for each river of regions/<id>/names.json, buildCourse (lib/river-course.ts) over the
 *    IGN line pieces (data/work/<id>/ign/lines.parquet) within course.corridorM of the river's
 *    HydroRIVERS reaches, own-named pieces preferred, unnamed allowed (as in river-lines). The
 *    anchors are the upstream end of the most upstream reach and the downstream end of the mouth
 *    reach. nqn has no river-lines output, so no river claims pieces here: every course runs
 *    from its source to its own mouth anchor. Pieces are oriented end to end; a path gap is
 *    filled from the river's HydroRIVERS reaches (or a straight connector) and flagged.
 * 2. Windows: n = max(1, round(L / targetSectionKm)) equal windows, a station every
 *    stationSpacingM with a tangent from the chord +-tangentWindowM.
 * 3. Span at each station: the normal line against the IGN BH140 "Corriente de agua" polygons
 *    (lib/flow-sections.ts stationSpan), else a band from RiverATLAS ria_ha_csu (hectares) over
 *    the nearest reach's LENGTH_KM, else none; a running median over smoothStations.
 * 4. Discharge: DIS_AV_CMS of the river's reach nearest the window midpoint (modeled, 1971-2000),
 *    with its regulation percentage; flowable unless noDischarge, reservoir (midpoint in a
 *    HydroLAKES polygon), noChannel or narrow.
 *
 * Output: public/flow/<id>/index.json and <sectionId>.json (compact JSON, fixed key order,
 * coordinates 1e-6, metres 0.1: two runs give the same bytes; stale files are removed first),
 * data/work/<id>/flow-sections/report.json and courses.json. `--only <slug>` is a debug flag:
 * it writes into data/work/<id>/flow-sections/only/ and report.only.json instead, so it never
 * touches public/.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { lit, openDb } from "../lib/duckdb";
import {
  type FlowConfig,
  type NotFlowable,
  type ReachLine,
  type Span,
  type XY,
  PolyIndex,
  bandWidthM,
  chainPieces,
  cumLengths,
  cutWindows,
  flowReason,
  hydroRoute,
  leftNormal,
  median,
  nearestReach,
  parsePolygonWkt,
  parseFlowConfig,
  pointAt,
  quantile,
  reachLine,
  round,
  segmentAt,
  smoothSpans,
  stationPositions,
  stationSpan,
  tangentAt,
} from "../lib/flow-sections";
import { ALBERS } from "../lib/ign";
import { requireInput } from "../lib/inputs";
import { riverSlug } from "../lib/names";
import {
  regionFile,
  rel,
  REGION_ID,
  ROOT,
  workPath,
  rawPath,
} from "../lib/paths";
import { writeReport } from "../lib/report";
import {
  type CoursePiece,
  type CourseResult,
  buildCourse,
  lineWkt,
  ownNameKeys,
  parseLineWkt,
  pieceKind,
} from "../lib/river-course";

interface NameEntry {
  name: string;
  shortName: string;
  type: string;
  slug?: string;
  aliases?: string[];
  mouthReach: number;
}

const num = (v: unknown) => Number(v ?? 0);
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
const BH140 = rawPath(
  "ign/areas_de_aguas_continentales_BH140/areas_de_aguas_continentales_BH140Polygon.shp",
);
const CORRIENTE = "Corriente de agua";
const SRC_POLYGON = 0;
const SRC_BAND = 1;
const SRC_NONE = 2;
const MODELED = {
  kind: "modeled",
  source: "HydroRIVERS v1.0 DIS_AV_CMS",
  period: "1971–2000",
} as const;

/** `--only <slug>` or `--only=<slug>`: the one river to build (debug), else null. */
function parseOnly(argv: readonly string[]): string | null {
  const i = argv.findIndex((a) => a === "--only" || a.startsWith("--only="));
  if (i === -1) return null;
  const arg = argv[i] ?? "";
  const v = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
  if (!v) throw new Error("--only needs a river slug");
  return v;
}

interface ReachInfo {
  line: ReachLine;
  dischargeM3s: number | null;
  riverAreaHa: number | null;
  lengthKm: number | null;
}

interface RiverCourse {
  slug: string;
  entry: NameEntry;
  reaches: ReachInfo[];
  result: CourseResult;
  pieceIds: string[];
  pts: XY[];
  gapSeg: boolean[];
  fills: { kind: "hydrorivers" | "straight"; km: number; from: XY }[];
  pieceCount: number;
}

async function main() {
  const configFile = regionFile("flow.config.json");
  if (!existsSync(configFile)) {
    throw new Error(
      `pipeline:flow-sections has no settings for region "${REGION_ID}" (${rel(configFile)} missing); nothing to do.`,
    );
  }
  const config: FlowConfig = parseFlowConfig(
    JSON.parse(await readFile(configFile, "utf8")),
  );
  const only = parseOnly(process.argv);
  const names = (
    JSON.parse(await readFile(regionFile("names.json"), "utf8")) as {
      rivers: NameEntry[];
    }
  ).rivers;
  const entries = names.filter((e) => only === null || riverSlug(e) === only);
  if (entries.length === 0)
    throw new Error(`--only ${only}: no such river in names.json`);

  const linesFile = requireInput(workPath("ign/lines.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const riverReachesFile = requireInput(
    workPath("named/river_reaches.parquet"),
  );
  const lakesFile = requireInput(workPath("lakes/lakes.parquet"));
  const exportReaches = requireInput(
    path.join(ROOT, "data/out", REGION_ID, "reaches.ndjson"),
  );
  const exportRivers = requireInput(
    path.join(ROOT, "data/out", REGION_ID, "rivers.ndjson"),
  );
  if (!existsSync(BH140))
    throw new Error(`${rel(BH140)} missing; run pipeline:download first`);

  const workDir = workPath("flow-sections");
  const outDir =
    only === null
      ? path.join(ROOT, "public/flow", REGION_ID)
      : path.join(workDir, "only");
  await mkdir(workDir, { recursive: true });
  const reportFile = path.join(
    workDir,
    only === null ? "report.json" : "report.only.json",
  );
  const previousSha = await readFile(reportFile, "utf8")
    .then((t) => (JSON.parse(t) as { sha256?: string }).sha256 ?? null)
    .catch(() => null);

  // Regulation and the exported discharge, per reach (HYRIV_ID), from the export.
  const exported = new Map<number, { dor: number | null; q: number | null }>();
  for (const line of (await readFile(exportReaches, "utf8")).split("\n")) {
    if (line === "") continue;
    const r = JSON.parse(line) as {
      _id: number;
      regulationPct?: number | null;
      dischargeM3s?: number | null;
    };
    exported.set(r._id, {
      dor: r.regulationPct ?? null,
      q: r.dischargeM3s ?? null,
    });
  }
  const exportedRivers = new Map<
    string,
    { mouthReach: number; sourceReach: number }
  >();
  for (const line of (await readFile(exportRivers, "utf8")).split("\n")) {
    if (line === "") continue;
    const r = JSON.parse(line) as {
      _id: string;
      mouthReach: number;
      sourceReach: number;
    };
    exportedRivers.set(r._id, r);
  }

  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='2GB'; SET threads=2; SET temp_directory=${lit(`${workDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  try {
    // 1. IGN line pieces (Albers metres for distances, lon/lat endpoints for buildCourse).
    await db.conn.run(`
      CREATE TABLE piece AS
      SELECT pieceId, name, ga, ST_Length(ga) AS length_m,
             ST_X(ST_StartPoint(ga)) AS x0, ST_Y(ST_StartPoint(ga)) AS y0,
             ST_X(ST_EndPoint(ga)) AS x1, ST_Y(ST_EndPoint(ga)) AS y1,
             ST_X(ST_StartPoint(g)) AS alon, ST_Y(ST_StartPoint(g)) AS alat,
             ST_X(ST_EndPoint(g)) AS blon, ST_Y(ST_EndPoint(g)) AS blat,
             ST_XMin(ga) AS xmin, ST_YMin(ga) AS ymin, ST_XMax(ga) AS xmax, ST_YMax(ga) AS ymax
      FROM (
        SELECT CAST(id AS VARCHAR) || ':' || CAST(coalesce((d).path[1], 1) AS VARCHAR) AS pieceId, name,
               (d).geom AS g, ${albers("(d).geom")} AS ga
        FROM (SELECT id, name, unnest(ST_Dump(geom)) AS d FROM read_parquet(${lit(linesFile)}))
        WHERE ST_GeometryType((d).geom) = 'LINESTRING')`);
    const [pieceCount] = await db.all(`SELECT count(*) AS n FROM piece`);
    await db.conn.run(`
      CREATE TABLE river_reach AS
      SELECT rr.river, rr.path_order, r.HYRIV_ID, r.LENGTH_KM, r.DIS_AV_CMS, a.ria_ha_csu, ga,
             ST_XMin(ga) AS xmin, ST_YMin(ga) AS ymin, ST_XMax(ga) AS xmax, ST_YMax(ga) AS ymax
      FROM read_parquet(${lit(riverReachesFile)}) rr
      JOIN (SELECT HYRIV_ID, LENGTH_KM, DIS_AV_CMS, ${albers("geom")} AS ga
            FROM read_parquet(${lit(reachesFile)})) r ON r.HYRIV_ID = rr.HYRIV_ID
      LEFT JOIN (SELECT HYRIV_ID, ria_ha_csu FROM read_parquet(${lit(atlasFile)})) a
        ON a.HYRIV_ID = r.HYRIV_ID`);
    await db.conn.run(`
      CREATE TABLE lake AS
      SELECT hylak_id, type, geom FROM read_parquet(${lit(lakesFile)})`);
    log(`pieces ${num(pieceCount?.n)}`);

    /** Albers metres to lon/lat, through one LINESTRING per chunk. */
    const toLonLat = async (pts: readonly XY[]): Promise<XY[]> => {
      const out: XY[] = [];
      const CHUNK = 20000;
      for (let i = 0; i < pts.length; i += CHUNK) {
        const part = pts.slice(i, i + CHUNK);
        const padded = part.length === 1 ? [part[0]!, part[0]!] : part;
        const [r] = await db.all(
          `SELECT ST_AsText(ST_Transform(ST_GeomFromText(${lit(lineWkt(padded))}), ${lit(ALBERS)}, 'EPSG:4326', always_xy := true)) AS wkt`,
        );
        out.push(...parseLineWkt(String(r!.wkt)).slice(0, part.length));
      }
      if (out.length !== pts.length)
        throw new Error(
          "flow-sections: lon/lat transform changed the point count",
        );
      return out;
    };

    // 2. One course per river.
    const courses: RiverCourse[] = [];
    const failures: { river: string; failure: string }[] = [];
    const anchorsFar: string[] = [];
    let anchorsMatchExport = true;
    for (const entry of entries) {
      const slug = riverSlug(entry);
      const reachRows = await db.all(`
        SELECT path_order, HYRIV_ID, LENGTH_KM, DIS_AV_CMS, ria_ha_csu, ST_AsText(ga) AS wkt
        FROM river_reach WHERE river = ${lit(slug)} ORDER BY path_order`);
      if (reachRows.length === 0)
        throw new Error(`${slug}: no reaches in river_reaches.parquet`);
      if (
        num(reachRows[0]!.path_order) !== 0 ||
        num(reachRows[0]!.HYRIV_ID) !== entry.mouthReach
      )
        throw new Error(
          `${slug}: path_order 0 is not the mouth reach ${entry.mouthReach}`,
        );
      const reaches: ReachInfo[] = reachRows.map((r) => ({
        line: reachLine(
          num(r.HYRIV_ID),
          num(r.path_order),
          parseLineWkt(String(r.wkt)),
        ),
        dischargeM3s: r.DIS_AV_CMS == null ? null : num(r.DIS_AV_CMS),
        riverAreaHa: r.ria_ha_csu == null ? null : num(r.ria_ha_csu),
        lengthKm: r.LENGTH_KM == null ? null : num(r.LENGTH_KM),
      }));
      const upstream = reaches[reaches.length - 1]!;
      const source = upstream.line.pts[0]!;
      const downstream = reaches[0]!.line.pts;
      const mouth = downstream[downstream.length - 1]!;
      const exp = exportedRivers.get(slug);
      anchorsMatchExport &&=
        exp !== undefined &&
        exp.mouthReach === entry.mouthReach &&
        exp.sourceReach === upstream.line.id;

      const keys = ownNameKeys(entry);
      const rows = await db.all(`
        SELECT p.pieceId, p.name, p.length_m, p.x0, p.y0, p.x1, p.y1, p.alon, p.alat, p.blon, p.blat
        FROM piece p
        WHERE p.pieceId IN (
          SELECT DISTINCT p2.pieceId FROM piece p2
          JOIN river_reach r ON r.river = ${lit(slug)}
            AND p2.xmax >= r.xmin - ${config.course.corridorM} AND p2.xmin <= r.xmax + ${config.course.corridorM}
            AND p2.ymax >= r.ymin - ${config.course.corridorM} AND p2.ymin <= r.ymax + ${config.course.corridorM}
            AND ST_Distance(p2.ga, r.ga) <= ${config.course.corridorM})
        ORDER BY p.pieceId`);
      const candidates: CoursePiece[] = rows.map((r) => ({
        id: String(r.pieceId),
        lengthM: num(r.length_m),
        kind: pieceKind(r.name == null ? null : String(r.name), keys),
        a: { x: num(r.x0), y: num(r.y0), lon: num(r.alon), lat: num(r.alat) },
        b: { x: num(r.x1), y: num(r.y1), lon: num(r.blon), lat: num(r.blat) },
      }));
      log(
        `${slug}: candidates ${candidates.length} (own ${candidates.filter((x) => x.kind === "own").length}, unnamed ${candidates.filter((x) => x.kind === "unnamed").length})`,
      );
      const result = buildCourse({
        pieces: candidates,
        claimed: new Set(),
        source: { x: source[0], y: source[1] },
        mouth: { x: mouth[0], y: mouth[1] },
        config: config.course,
      });
      if (result.failure !== null || result.entries.length === 0) {
        failures.push({ river: slug, failure: result.failure ?? "no pieces" });
        log(
          `${slug}: FAILED ${result.failure} (anchors ${round(result.anchorDistM.source, 0)} m from the source, ${round(result.anchorDistM.mouth, 0)} m from the mouth)`,
        );
        continue;
      }
      // A river that ends in a reservoir has no IGN line near its mouth: the course stops where
      // the lines do (a warning, not a failure; the report lists the distances).
      if (
        result.anchorDistM.source > config.course.anchorMaxM ||
        result.anchorDistM.mouth > config.course.anchorMaxM
      )
        anchorsFar.push(slug);

      // Pieces in source-to-mouth order (entries run from the mouth end, order 0).
      const seq = [...result.entries].sort((p, q) => q.order - p.order);
      const wkt = new Map(
        (
          await db.all(`
            SELECT pieceId, ST_AsText(ga) AS wkt FROM piece
            WHERE pieceId IN (${seq.map((e) => lit(e.id)).join(", ")})`)
        ).map((r) => [String(r.pieceId), parseLineWkt(String(r.wkt))]),
      );
      const { lines, jumps } = chainPieces(
        seq.map((e) => wkt.get(e.id)!),
        source,
      );
      // Path gaps of the course, by the order of the piece just downstream.
      const pathGapAfter = new Set(
        result.gaps
          .filter((g) => g.kind === "path" && g.downOrder !== null)
          .map((g) => g.downOrder),
      );
      const pts: XY[] = [];
      const gapSeg: boolean[] = [];
      const fills: RiverCourse["fills"] = [];
      const append = (points: readonly XY[], flag: boolean) => {
        for (const q of points) {
          const last = pts[pts.length - 1];
          if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) <= 1e-6)
            continue;
          pts.push(q);
          if (last) gapSeg.push(flag);
        }
      };
      const reachLines = reaches.map((r) => r.line);
      lines.forEach((line, i) => {
        if (i > 0 && jumps[i - 1]! > 1e-6) {
          const a = lines[i - 1]![lines[i - 1]!.length - 1]!;
          const b = line[0]!;
          const big = jumps[i - 1]! > config.course.snapM;
          const isPath = pathGapAfter.has(seq[i]!.order);
          const route =
            big && isPath
              ? hydroRoute(
                  reachLines,
                  a,
                  b,
                  config.gapFill.maxStretch,
                  config.gapFill.snapM,
                )
              : null;
          if (route) {
            fills.push({
              kind: "hydrorivers",
              km: cumLengths(route).at(-1)! / 1000,
              from: a,
            });
            append(route, true);
          } else {
            if (big)
              fills.push({
                kind: "straight",
                km: jumps[i - 1]! / 1000,
                from: a,
              });
            append([a, b], big);
          }
        }
        append(line, false);
      });
      if (pts.length < 2) {
        failures.push({
          river: slug,
          failure: "course has fewer than two vertices",
        });
        continue;
      }
      courses.push({
        slug,
        entry,
        reaches,
        result,
        pieceIds: seq.map((e) => e.id),
        pts,
        gapSeg,
        fills,
        pieceCount: seq.length,
      });
      log(
        `${slug}: ${seq.length} pieces, ${round(cumLengths(pts).at(-1)! / 1000, 1)} km, ${fills.length} fills`,
      );
    }

    // 3. BH140 channel polygons near the courses, as one index.
    await db.conn.run(`
      CREATE TABLE bh AS
      SELECT OGC_FID AS fid, ${albers("geom")} AS ga
      FROM ST_Read(${lit(BH140)}) WHERE objeto = ${lit(CORRIENTE)}`);
    const boxes = await db.all(`
      SELECT fid, ST_XMin(ga) AS x0, ST_YMin(ga) AS y0, ST_XMax(ga) AS x1, ST_YMax(ga) AS y1
      FROM bh ORDER BY fid`);
    const near = config.span.corridorM;
    const picked = boxes.filter((b) =>
      courses.some((c) =>
        c.pts.some(
          (p) =>
            p[0] >= num(b.x0) - near &&
            p[0] <= num(b.x1) + near &&
            p[1] >= num(b.y0) - near &&
            p[1] <= num(b.y1) + near,
        ),
      ),
    );
    const polygons: XY[][][] = [];
    for (const b of picked) {
      const [r] = await db.all(
        `SELECT ST_AsText(ga) AS wkt FROM bh WHERE fid = ${num(b.fid)}`,
      );
      polygons.push(...parsePolygonWkt(String(r!.wkt)));
    }
    const index = new PolyIndex(polygons, config.span.gridCellM);
    log(
      `BH140 polygons ${picked.length} of ${boxes.length}, edges ${index.edgeCount}`,
    );

    // 4. Sections.
    interface Station {
      lon: number;
      lat: number;
      span: Span | null;
      src: number;
      gap: number;
    }
    const files = new Map<string, unknown>();
    const indexRivers: unknown[] = [];
    const perRiver: Record<string, unknown>[] = [];
    const totals = { stations: 0, polygon: 0, band: 0, none: 0 };
    const reasonTotals: Record<string, number> = {};
    let flowableSections = 0;
    let sectionCount = 0;
    let sectionKmOk = true;
    let spansValid = true;
    let dischargeMatchesExport = true;
    const lakeTypesHit: Record<string, number> = {};

    for (const c of courses) {
      const total = cumLengths(c.pts).at(-1)!;
      const cum = cumLengths(c.pts);
      const windows = cutWindows(
        c.slug,
        total,
        config.sections.targetSectionKm,
      );
      const pad = (config.span.smoothStations - 1) / 2;
      const hydroLines = c.reaches.map((r) => r.line);
      const infoById = new Map(c.reaches.map((r) => [r.line.id, r]));
      const stations: Station[][] = [];
      const albersPts: XY[] = [];
      const widths: number[] = [];
      const coverage = { polygon: 0, band: 0, none: 0 };
      for (const w of windows) {
        const pos = stationPositions(
          w.s0,
          w.s1,
          config.sections.stationSpacingM,
          total,
          pad,
        );
        const raw: (Span | null)[] = [];
        const src: number[] = [];
        const gap: number[] = [];
        const centres: XY[] = [];
        for (const s of pos.s) {
          const centre = pointAt(c.pts, cum, s);
          const n = leftNormal(
            tangentAt(c.pts, cum, s, config.sections.tangentWindowM),
          );
          let span = stationSpan(index, centre[0], centre[1], n, config.span);
          let code = SRC_POLYGON;
          if (span === null) {
            const reach = infoById.get(
              nearestReach(hydroLines, centre).reach.id,
            )!;
            const width = bandWidthM(reach.riverAreaHa, reach.lengthKm);
            span = width === null ? null : [-width / 2, width / 2];
            code = width === null ? SRC_NONE : SRC_BAND;
          }
          raw.push(span);
          src.push(code);
          gap.push(c.gapSeg[segmentAt(cum, s)] ? 1 : 0);
          centres.push(centre);
        }
        const smooth = smoothSpans(raw, config.span.smoothStations, src);
        const winStations: Station[] = [];
        for (let k = pos.from; k < pos.to; k++) {
          const span = smooth[k] ?? null;
          winStations.push({
            lon: 0,
            lat: 0,
            span: span && [round(span[0], 1), round(span[1], 1)],
            src: src[k]!,
            gap: gap[k]!,
          });
          albersPts.push(centres[k]!);
        }
        stations.push(winStations);
      }
      const mids: XY[] = windows.map((w) =>
        pointAt(c.pts, cum, (w.s0 + w.s1) / 2),
      );
      const lonLat = await toLonLat([...albersPts, ...mids]);
      let at = 0;
      for (const list of stations)
        for (const st of list) {
          st.lon = round(lonLat[at]![0], 6);
          st.lat = round(lonLat[at]![1], 6);
          at++;
        }
      const midLonLat = lonLat.slice(albersPts.length);

      // Lake test of the midpoints.
      const lakeRows = await db.all(`
        SELECT m.i, min(l.hylak_id) AS lake, min(l.type) AS type
        FROM (VALUES ${midLonLat.map((p, i) => `(${i}, ${p[0]}, ${p[1]})`).join(", ")}) m(i, lon, lat)
        JOIN lake l ON ST_Contains(l.geom, ST_Point(m.lon, m.lat))
        GROUP BY m.i`);
      const lakeAt = new Map(lakeRows.map((r) => [num(r.i), String(r.type)]));

      const sectionsIndex: unknown[] = [];
      const reasons: Record<string, number> = {};
      let sectionSumM = 0;
      windows.forEach((w, wi) => {
        const list = stations[wi]!;
        const mid = midLonLat[wi]!;
        const reach = infoById.get(
          nearestReach(hydroLines, mids[wi]!).reach.id,
        )!;
        const ex = exported.get(reach.line.id);
        const q =
          reach.dischargeM3s === null ? null : round(reach.dischargeM3s, 3);
        if (q !== null && (ex?.q == null || Math.abs(ex.q - q) > 1e-3))
          dischargeMatchesExport = false;
        const withSpan = list.filter((s) => s.span !== null);
        const widthList = withSpan.map((s) => s.span![1] - s.span![0]);
        for (const s of list) {
          if (s.span !== null && !(s.span[0] < s.span[1])) spansValid = false;
          if (
            s.span !== null &&
            (Math.abs(s.span[0]) > config.span.maxSearchM ||
              Math.abs(s.span[1]) > config.span.maxSearchM)
          )
            spansValid = false;
        }
        const nPoly = list.filter(
          (s) => s.src === SRC_POLYGON && s.span !== null,
        ).length;
        const nBand = list.filter((s) => s.src === SRC_BAND).length;
        const nNone = list.length - nPoly - nBand;
        coverage.polygon += nPoly;
        coverage.band += nBand;
        coverage.none += nNone;
        widths.push(...widthList);
        const lakeType = lakeAt.get(wi);
        if (lakeType !== undefined)
          lakeTypesHit[lakeType] = (lakeTypesHit[lakeType] ?? 0) + 1;
        const reason: NotFlowable | null = flowReason(
          {
            dischargeM3s: q,
            inLake: lakeType !== undefined,
            spanShare: withSpan.length / list.length,
            medianWidthM: median(widthList),
          },
          config.flowable,
        );
        reasons[reason ?? "flowable"] =
          (reasons[reason ?? "flowable"] ?? 0) + 1;
        const lons = list.map((s) => s.lon);
        const lats = list.map((s) => s.lat);
        const bbox = [
          Math.min(...lons),
          Math.min(...lats),
          Math.max(...lons),
          Math.max(...lats),
        ];
        const channelSource =
          withSpan.length === 0
            ? "none"
            : nPoly === withSpan.length
              ? "ign-polygon"
              : nPoly === 0
                ? "estimated-band"
                : "mixed";
        sectionSumM += w.lengthM;
        sectionsIndex.push({
          id: w.id,
          index: w.index,
          bbox,
          mid: [round(mid[0], 6), round(mid[1], 6)],
          flowable: reason === null,
          reason,
        });
        files.set(w.id, {
          id: w.id,
          river: c.slug,
          riverName: c.entry.name,
          index: w.index,
          count: w.count,
          prev: w.prev,
          next: w.next,
          lengthM: w.lengthM,
          bbox,
          stations: {
            lon: list.map((s) => s.lon),
            lat: list.map((s) => s.lat),
            nMin: list.map((s) => (s.span ? s.span[0] : null)),
            nMax: list.map((s) => (s.span ? s.span[1] : null)),
            src: list.map((s) => s.src),
            gap: list.map((s) => s.gap),
          },
          channel: {
            source: channelSource,
            polygonShare: round(nPoly / list.length, 3),
            widthM: {
              min: widthList.length ? round(Math.min(...widthList), 1) : null,
              p50: widthList.length ? round(median(widthList)!, 1) : null,
              max: widthList.length ? round(Math.max(...widthList), 1) : null,
            },
          },
          discharge: { value: q, ...MODELED, reachId: reach.line.id },
          regulationPct: ex?.dor ?? null,
          flowable: reason === null,
          reason,
        });
        if (reason === null) flowableSections++;
        else reasonTotals[reason] = (reasonTotals[reason] ?? 0) + 1;
      });
      sectionCount += windows.length;
      const diffM = Math.abs(sectionSumM - total);
      sectionKmOk &&= diffM <= 1;
      const stationCount = coverage.polygon + coverage.band + coverage.none;
      totals.stations += stationCount;
      totals.polygon += coverage.polygon;
      totals.band += coverage.band;
      totals.none += coverage.none;
      indexRivers.push({
        slug: c.slug,
        name: c.entry.name,
        sections: sectionsIndex,
      });
      const gapKm = (kind: string) =>
        c.fills.filter((f) => f.kind === kind).reduce((s, f) => s + f.km, 0);
      const pct = (n: number) => round((100 * n) / stationCount, 1);
      perRiver.push({
        river: c.slug,
        sections: windows.length,
        pieces: c.pieceCount,
        courseKm: round(total / 1000, 3),
        sectionKmSum: round(sectionSumM / 1000, 3),
        diffM: round(diffM, 3),
        gapKm: {
          hydrorivers: round(gapKm("hydrorivers"), 3),
          straight: round(gapKm("straight"), 3),
          flaggedStationPct: round(
            (100 * stations.flat().filter((s) => s.gap === 1).length) /
              stationCount,
            1,
          ),
        },
        stationPct: {
          polygon: pct(coverage.polygon),
          band: pct(coverage.band),
          none: pct(coverage.none),
        },
        widthM: {
          p50: round(quantile(widths, 0.5) ?? NaN, 1) || null,
          p95: round(quantile(widths, 0.95) ?? NaN, 1) || null,
        },
        reasons,
        anchors: {
          sourceDistM: round(c.result.anchorDistM.source, 1),
          mouthDistM: round(c.result.anchorDistM.mouth, 1),
          rule: c.result.anchorRule,
        },
        courseGaps: {
          path: c.result.gaps.filter((g) => g.kind === "path").length,
          extension: c.result.gaps.filter((g) => g.kind === "extension").length,
        },
        sourceExtendedKm: round(c.result.sourceExtensionKm, 3),
        receiverExtended: c.result.receiverExtension !== null,
      });
      log(
        `${c.slug}: ${windows.length} sections, polygon ${pct(coverage.polygon)}% band ${pct(coverage.band)}% none ${pct(coverage.none)}%`,
      );
    }

    // 5. Write: stale files out first.
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const hash = createHash("sha256");
    const names_ = [...files.keys()].sort();
    const indexBody =
      JSON.stringify({ region: REGION_ID, rivers: indexRivers }) + "\n";
    await writeFile(path.join(outDir, "index.json"), indexBody);
    hash.update("index.json\n").update(indexBody);
    for (const id of names_) {
      const body = JSON.stringify(files.get(id)) + "\n";
      await writeFile(path.join(outDir, `${id}.json`), body);
      hash.update(`${id}.json\n`).update(body);
    }
    let bytes = 0;
    for (const f of await readdir(outDir))
      bytes += (await stat(path.join(outDir, f))).size;
    const sha = hash.digest("hex");

    await writeFile(
      path.join(workDir, "courses.json"),
      JSON.stringify(
        courses.map((c) => ({
          river: c.slug,
          pieces: c.pieceIds,
          fills: c.fills.map((f) => ({
            kind: f.kind,
            km: round(f.km, 3),
            from: f.from.map((v) => round(v, 1)),
          })),
        })),
        null,
        2,
      ) + "\n",
    );

    const pctAll = (n: number) =>
      totals.stations ? round((100 * n) / totals.stations, 1) : null;
    const checks = {
      allRiversHaveCourse:
        failures.length === 0 && courses.length === entries.length,
      sectionKmMatchesCourse: sectionKmOk,
      withinSizeBudget: bytes <= config.maxTotalBytes,
      anchorsMatchExport,
      spansValid,
      dischargeMatchesExport,
    };
    const ok = Object.values(checks).every(Boolean);
    const body = {
      ok,
      only,
      durationMs: Date.now() - t0,
      checks,
      failures,
      warnings: {
        anchorsBeyondAnchorMaxM: anchorsFar,
        note: "rivers whose source or mouth anchor lies farther than course.anchorMaxM from the reach end: the IGN lines stop short (reservoirs); the course ends where the lines do",
      },
      rivers: courses.length,
      sections: sectionCount,
      flowableSections,
      notFlowable: reasonTotals,
      lakeHitsByType: {
        note: "midpoint sections inside a HydroLAKES polygon, by lake type (1 lake, 2 reservoir, 3 control)",
        ...lakeTypesHit,
      },
      stationPct: {
        polygon: pctAll(totals.polygon),
        band: pctAll(totals.band),
        none: pctAll(totals.none),
        stations: totals.stations,
      },
      bytes,
      maxTotalBytes: config.maxTotalBytes,
      polygons: {
        loaded: picked.length,
        of: boxes.length,
        edges: index.edgeCount,
      },
      sha256: sha,
      previousSha256: previousSha,
      identicalToPreviousRun: previousSha === null ? null : previousSha === sha,
      identicalNote: "null on a first run; run the step twice",
      bandNote:
        "band width = ria_ha_csu (RiverATLAS, hectares, river area of the reach catchment) * 10,000 / (LENGTH_KM * 1000) of the river's reach nearest the station; the area covers the whole reach catchment, so it can include small tributaries",
      config,
      perRiver,
      outputs: [rel(outDir)],
    };
    if (only === null) await writeReport("flow-sections", body);
    else {
      const f = path.join(workDir, "report.only.json");
      await writeFile(
        f,
        JSON.stringify(
          {
            step: "flow-sections",
            generatedAt: new Date().toISOString(),
            ...body,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(`report: ${rel(f)}`);
    }
    log(`done, ${Date.now() - t0} ms, ${bytes} bytes`);
    if (!ok)
      throw new Error(`flow-sections checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
