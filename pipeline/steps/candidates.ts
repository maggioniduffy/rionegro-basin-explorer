/**
 * pipeline:candidates — list the major branches of the connected network so they
 * can be named by hand in pipeline/names.json (HydroRIVERS has no names).
 *
 * A candidate is the outlet reach, or a reach at a confluence where at least two
 * upstream branches drain >= MIN_AREA_KM2 (both branches are listed). Each
 * candidate's segment runs upstream along the largest branch until the next
 * candidate confluence, so segments partition the major network without overlap.
 * Every row has an OpenStreetMap link at the mouth for checking the name.
 *
 * Outputs in data/work/candidates/: candidates.json, candidates.geojson (one line
 * per segment, for a GIS viewer), report.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { lit, openDb, type Row } from "../lib/duckdb";
import {
  majorBranchMouths,
  traceLargestUpstream,
  upstreamIndex,
} from "../lib/graph";
import { requireInput } from "../lib/inputs";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

/** Smallest branch area that makes a confluence "major". */
const MIN_AREA_KM2 = Number(
  process.argv.find((a) => a.startsWith("--min-area="))?.split("=")[1] ?? 2000,
);

const round = (x: unknown, digits: number) => Number(Number(x).toFixed(digits));
const osmLink = (lat: number, lon: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;

async function main() {
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const outDir = workPath("candidates");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT HYRIV_ID, NEXT_DOWN, UPLAND_SKM, LENGTH_KM, DIST_DN_KM, DIS_AV_CMS, ORD_STRA,
             predcat1, geom,
             ST_X(ST_StartPoint(geom)) AS start_lon, ST_Y(ST_StartPoint(geom)) AS start_lat,
             ST_X(ST_EndPoint(geom)) AS end_lon, ST_Y(ST_EndPoint(geom)) AS end_lat
      FROM ${lit(reachesFile)}
      WHERE network = 'connected'`);
    const rows = await db.all(`SELECT * EXCLUDE (geom) FROM reaches`);
    const byId = new Map<number, Row>(rows.map((r) => [Number(r.HYRIV_ID), r]));
    const area = (id: number) => Number(byId.get(id)?.UPLAND_SKM ?? 0);
    const index = upstreamIndex(
      rows.map((r) => ({
        id: Number(r.HYRIV_ID),
        nextDown: Number(r.NEXT_DOWN),
      })),
    );
    const outlets = rows.filter((r) => Number(r.NEXT_DOWN) === 0);
    if (outlets.length !== 1)
      throw new Error(`expected 1 outlet, found ${outlets.length}`);
    const outlet = Number(outlets[0]?.HYRIV_ID);

    const mouths = majorBranchMouths(index, area, outlet, MIN_AREA_KM2).sort(
      (a, b) => area(b) - area(a),
    );
    const mouthSet = new Set(mouths);
    const segmentOf = new Map<number, number>(); // reach → candidate mouth
    const candidates = mouths.map((mouth, i) => {
      const segment = traceLargestUpstream(index, area, mouth, mouthSet);
      for (const id of segment) segmentOf.set(id, mouth);
      const fullPath = traceLargestUpstream(index, area, mouth);
      const m = byId.get(mouth)!;
      const source = byId.get(fullPath[fullPath.length - 1]!)!;
      const sum = (ids: number[]) =>
        ids.reduce((s, id) => s + Number(byId.get(id)?.LENGTH_KM), 0);
      const lat = round(m.end_lat, 4);
      const lon = round(m.end_lon, 4);
      return {
        rank: i + 1,
        mouthReach: mouth,
        uplandKm2: round(m.UPLAND_SKM, 1),
        dischargeM3s: round(m.DIS_AV_CMS, 1),
        strahlerAtMouth: m.ORD_STRA,
        distanceToSeaKm: round(m.DIST_DN_KM, 1),
        segmentReaches: segment.length,
        segmentKm: round(sum(segment), 1),
        largestPathKm: round(sum(fullPath), 1),
        mouth: { lat, lon, osm: osmLink(lat, lon) },
        source: {
          lat: round(source.start_lat, 4),
          lon: round(source.start_lon, 4),
        },
        segment,
      };
    });
    // The parent is the candidate whose segment the mouth drains into.
    const withParent = candidates.map((c) => {
      const down = Number(byId.get(c.mouthReach)?.NEXT_DOWN);
      const parent = down === 0 ? null : (segmentOf.get(down) ?? null);
      return { ...c, parentMouthReach: parent };
    });

    // Segment geometries for a GIS viewer.
    const pairs = [...segmentOf.entries()];
    await db.conn.run(`
      CREATE TABLE seg AS SELECT * FROM (VALUES ${pairs.map(([r, m]) => `(${r}, ${m})`).join(",")})
      AS t(HYRIV_ID, mouth)`);
    const lines = await db.all(`
      SELECT s.mouth, ST_AsGeoJSON(ST_LineMerge(ST_Union_Agg(r.geom))) AS g
      FROM seg s JOIN reaches r USING (HYRIV_ID) GROUP BY s.mouth`);
    const lineByMouth = new Map(
      lines.map((l) => [Number(l.mouth), String(l.g)]),
    );
    const geojson = {
      type: "FeatureCollection",
      features: withParent.map((c) => ({
        type: "Feature",
        properties: {
          rank: c.rank,
          mouthReach: c.mouthReach,
          parentMouthReach: c.parentMouthReach,
          uplandKm2: c.uplandKm2,
          segmentKm: c.segmentKm,
          osm: c.mouth.osm,
        },
        geometry: JSON.parse(lineByMouth.get(c.mouthReach) ?? "null"),
      })),
    };
    const jsonFile = `${outDir}/candidates.json`;
    const geojsonFile = `${outDir}/candidates.geojson`;
    await writeFile(
      jsonFile,
      JSON.stringify(
        withParent.map((c) => ({ ...c, segment: undefined })),
        null,
        2,
      ) + "\n",
    );
    await writeFile(geojsonFile, JSON.stringify(geojson));

    const coveredKm = candidates.reduce((s, c) => s + c.segmentKm, 0);
    await writeReport("candidates", {
      minAreaKm2: MIN_AREA_KM2,
      candidates: candidates.length,
      majorNetworkKm: round(coveredKm, 1),
      checks: {
        segmentsDisjoint:
          pairs.length === candidates.reduce((s, c) => s + c.segmentReaches, 0),
        singleRoot:
          withParent.filter((c) => c.parentMouthReach === null).length === 1,
      },
      outputs: [rel(jsonFile), rel(geojsonFile)],
    });
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
