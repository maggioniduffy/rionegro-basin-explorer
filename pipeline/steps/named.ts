/**
 * pipeline:named — trace the named rivers of pipeline/names.json and aggregate
 * their metrics.
 *
 * Each river runs from its mouth reach upstream, at every confluence taking the
 * largest-area branch that is not another named river's mouth (traceNamedRiver).
 * Metrics, all traceable to source fields (per-field provenance in each document):
 *   lengthKm            sum of HydroRIVERS LENGTH_KM along the path
 *   mouth.elevationM    RiverATLAS ele_mt_cmn of the mouth reach (minimum elevation of
 *                       its local catchment, which contains the pour point)
 *   source.elevationM   headwater reach's ele_mt_cmn + that reach's own drop
 *                       (sgr_dk_rav / 10 × LENGTH_KM; the catalog defines sgr_dk_rav as
 *                       the elevation drop along the reach per km, in decimetres per km).
 *                       For a river that ends at a confluence of named rivers, this is
 *                       the confluence elevation (sourceKind = "confluence").
 *   dropM               source.elevationM − mouth.elevationM
 *   (diagnostic)        summed per-reach drops; overstates on flat braided reaches
 *                       (Río Negro: 419 m vs 260 m), so it is only reported
 *   mouth.dischargeM3s  HydroRIVERS DIS_AV_CMS at the mouth reach (modeled 1971–2000)
 *   nonPerennialPct     share of length with GIRES predcat1 = 1 (modeled)
 *
 * Outputs: data/out/rivers.ndjson (committed; seed input), data/work/named/
 * river_reaches.parquet (reach → river), data/work/named/report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb, type Row } from "../lib/duckdb";
import { traceNamedRiver, upstreamIndex } from "../lib/graph";
import { requireInput } from "../lib/inputs";
import { slugify } from "../lib/names";
import { OUT_DIR, ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

/** Summed drop vs source − mouth differences above this are listed for review. */
const ELEVATION_CHECK_M = 100;

interface NameEntry {
  name: string;
  shortName: string;
  type: string;
  mouthReach: number;
  confidence: "strong" | "weak";
  evidence: string;
}

const round = (x: number, digits = 1) => Number(x.toFixed(digits));

const PROVENANCE = {
  lengthKm: "HydroRIVERS v1.0 LENGTH_KM, summed along the traced path",
  "mouth.elevationM":
    "RiverATLAS v1.0 ele_mt_cmn of the mouth reach (EarthEnv-DEM90)",
  "source.elevationM":
    "RiverATLAS v1.0 ele_mt_cmn of the source reach + its drop (sgr_dk_rav / 10 × LENGTH_KM) (EarthEnv-DEM90)",
  dropM: "source.elevationM − mouth.elevationM",
  gradientMPerKm: "dropM / lengthKm",
  "mouth.dischargeM3s":
    "HydroRIVERS v1.0 DIS_AV_CMS at the mouth reach; modeled natural long-term average 1971–2000 (WaterGAP), does not reflect dam regulation",
  "mouth.uplandKm2": "HydroRIVERS v1.0 UPLAND_SKM at the mouth reach",
  "mouth.distanceToSeaKm": "HydroRIVERS v1.0 DIST_DN_KM at the mouth reach",
  "mouth.strahler": "HydroRIVERS v1.0 ORD_STRA at the mouth reach",
  nonPerennialPct:
    "GIRES v1.0 predcat1 = 1 (modeled, ≥ 1 no-flow day per year), share of lengthKm; reaches without a prediction are counted in unknownPct",
  name: "pipeline/names.json (hand-approved; OpenStreetMap spelling, ODbL)",
};

async function main() {
  const names = (
    JSON.parse(await readFile(`${ROOT}/pipeline/names.json`, "utf8")) as {
      rivers: NameEntry[];
    }
  ).rivers;
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const outDir = workPath("named");
  await mkdir(outDir, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  const db = await openDb();

  try {
    const rows = await db.all(`
      SELECT r.HYRIV_ID, r.NEXT_DOWN, r.UPLAND_SKM, r.LENGTH_KM, r.DIST_DN_KM, r.DIS_AV_CMS,
             r.ORD_STRA, r.predcat1, a.ele_mt_cmn, a.sgr_dk_rav,
             ST_X(ST_StartPoint(r.geom)) AS start_lon, ST_Y(ST_StartPoint(r.geom)) AS start_lat,
             ST_X(ST_EndPoint(r.geom)) AS end_lon, ST_Y(ST_EndPoint(r.geom)) AS end_lat
      FROM ${lit(reachesFile)} r JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      WHERE r.network = 'connected'`);
    const byId = new Map<number, Row>(rows.map((r) => [Number(r.HYRIV_ID), r]));
    const num = (id: number, field: string) => Number(byId.get(id)?.[field]);
    const index = upstreamIndex(
      rows.map((r) => ({
        id: Number(r.HYRIV_ID),
        nextDown: Number(r.NEXT_DOWN),
      })),
    );

    const missingMouths = names
      .filter((n) => !byId.has(n.mouthReach))
      .map((n) => n.name);
    if (missingMouths.length > 0) {
      throw new Error(
        `mouth reach not in the connected network: ${missingMouths.join(", ")}`,
      );
    }
    const slugs = names.map((n) => slugify(n.shortName));
    const claimed = new Set(names.map((n) => n.mouthReach));

    const riverOf = new Map<number, string>();
    const overlaps: { reach: number; rivers: string[] }[] = [];
    const traced = names.map((n, i) => {
      const slug = slugs[i]!;
      const path = traceNamedRiver(
        index,
        (id) => num(id, "UPLAND_SKM"),
        n.mouthReach,
        claimed,
      );
      for (const id of path) {
        const other = riverOf.get(id);
        if (other) overlaps.push({ reach: id, rivers: [other, slug] });
        else riverOf.set(id, slug);
      }
      return { n, slug, path };
    });

    const elevationWarnings: Record<string, unknown>[] = [];
    const docs = traced.map(({ n, slug, path }) => {
      const mouth = path[0]!;
      const head = path[path.length - 1]!;
      const lengthKm = path.reduce((s, id) => s + num(id, "LENGTH_KM"), 0);
      const dropOf = (id: number) =>
        (num(id, "sgr_dk_rav") / 10) * num(id, "LENGTH_KM");
      const mouthElevation = num(mouth, "ele_mt_cmn");
      const sourceElevation = num(head, "ele_mt_cmn") + dropOf(head);
      const dropM = sourceElevation - mouthElevation;
      const summedDropM = path.reduce((s, id) => s + dropOf(id), 0);
      if (Math.abs(summedDropM - dropM) > ELEVATION_CHECK_M) {
        elevationWarnings.push({
          river: slug,
          dropM: Math.round(dropM),
          summedDropM: Math.round(summedDropM),
        });
      }
      // A trace ends at a headwater, or where every branch is another named river.
      const sourceKind =
        (index.get(head) ?? []).length === 0 ? "headwater" : "confluence";
      const lengthWhere = (pred: (r: Row) => boolean) =>
        path
          .filter((id) => pred(byId.get(id)!))
          .reduce((s, id) => s + num(id, "LENGTH_KM"), 0);
      const nonPerennialKm = lengthWhere(
        (r) => Number(r.predcat1) === 1 && r.predcat1 !== null,
      );
      const unknownKm = lengthWhere((r) => r.predcat1 === null);
      const down = num(mouth, "NEXT_DOWN");
      const flowsInto = down === 0 ? "sea" : (riverOf.get(down) ?? "unnamed");
      const m = byId.get(mouth)!;
      const h = byId.get(head)!;
      return {
        _id: slug,
        name: n.name,
        shortName: n.shortName,
        type: n.type,
        nameConfidence: n.confidence,
        flowsInto,
        mouthReach: mouth,
        sourceReach: head,
        reachCount: path.length,
        lengthKm: round(lengthKm),
        dropM: Math.round(dropM),
        gradientMPerKm: round(dropM / lengthKm, 2),
        mouth: {
          lat: round(Number(m.end_lat), 5),
          lon: round(Number(m.end_lon), 5),
          elevationM: mouthElevation,
          dischargeM3s: round(Number(m.DIS_AV_CMS), 1),
          uplandKm2: round(Number(m.UPLAND_SKM)),
          distanceToSeaKm: round(Number(m.DIST_DN_KM)),
          strahler: Number(m.ORD_STRA),
        },
        source: {
          kind: sourceKind,
          lat: round(Number(h.start_lat), 5),
          lon: round(Number(h.start_lon), 5),
          elevationM: Math.round(sourceElevation),
        },
        nonPerennialPct: round((nonPerennialKm / lengthKm) * 100),
        unknownPct: round((unknownKm / lengthKm) * 100),
        modeled: ["mouth.dischargeM3s", "nonPerennialPct"],
        provenance: PROVENANCE,
      };
    });

    // Reach → river mapping for tiles and the rivers panel.
    const mappingRows = traced.flatMap(({ slug, path }) =>
      path.map((id, order) => `(${id}, '${slug}', ${order})`),
    );
    const mappingFile = `${outDir}/river_reaches.parquet`;
    await db.conn.run(`
      COPY (SELECT * FROM (VALUES ${mappingRows.join(",")}) AS t(HYRIV_ID, river, path_order))
      TO ${lit(mappingFile)} (FORMAT parquet)`);
    const ndjsonFile = `${OUT_DIR}/rivers.ndjson`;
    await writeFile(
      ndjsonFile,
      docs.map((d) => JSON.stringify(d)).join("\n") + "\n",
    );

    const checks = {
      uniqueSlugs: new Set(slugs).size === slugs.length,
      noOverlappingReaches: overlaps.length === 0,
      everyRiverFlowsIntoNamedOrSea: docs.every(
        (d) => d.flowsInto !== "unnamed",
      ),
      oneRiverReachesTheSea:
        docs.filter((d) => d.flowsInto === "sea").length === 1,
    };
    await writeReport("named", {
      ok: Object.values(checks).every(Boolean),
      checks,
      rivers: docs.map((d) => ({
        id: d._id,
        flowsInto: d.flowsInto,
        lengthKm: d.lengthKm,
        reaches: d.reachCount,
        mouthElevationM: d.mouth.elevationM,
        sourceElevationM: d.source.elevationM,
        dischargeM3s: d.mouth.dischargeM3s,
        nonPerennialPct: d.nonPerennialPct,
      })),
      namedKm: round(docs.reduce((s, d) => s + d.lengthKm, 0)),
      overlaps: overlaps.slice(0, 20),
      elevationWarnings,
      outputs: [rel(ndjsonFile), rel(mappingFile)],
    });
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
