/**
 * pipeline:ign — IGN perennial watercourse lines, cleaned and clipped to the basin
 * (Phase 5, input of pipeline:ign-match).
 *
 * Input: IGN "Corriente de agua perenne" (data/raw/ign/, Shapefile, ISO-8859-1) and the
 * basin polygon (pipeline:basin). Only the perennial class is used; the intermittent
 * layer is out of scope (DECISSIONS.md, gate 2026-10-01).
 *
 * What it does: reads the lines that touch the basin, drops exact duplicate geometries,
 * clips to the basin polygon (same rules as pipeline:ign-gate, so the numbers must agree),
 * cleans the names (pipeline/lib/names.ts: NFC, whitespace) and gives each line a stable
 * id. A name is IGN's `fna` verbatim apart from that cleaning; `nam` and `gna` are kept
 * as they are. Nothing is inferred: a line without `fna` has no name.
 *
 * Outputs in data/work/ign/: lines.parquet (id, gid, name, name_key, generic, short_name,
 * km, geom in EPSG:4326) and report.json (counts, km, names, spelling variants, checks).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { lengthSpheroidKm, envelope, pctDiff } from "../lib/geo";
import {
  IGN_LINE_LAYERS,
  IGN_ST_READ_OPTIONS,
  createNameMap,
} from "../lib/ign";
import { requireInput } from "../lib/inputs";
import { rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100) : null);

/** Allowed difference to the ign-gate report, in percent (same inputs, same rules). */
const GATE_TOLERANCE_PCT = 0.1;

async function main() {
  const layer = IGN_LINE_LAYERS[0];
  const lineShp = requireInput(layer.shp);
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const outDir = workPath("ign");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    await db.conn.run(
      `CREATE TABLE basin AS SELECT geom FROM ST_Read(${lit(basinFile)})`,
    );
    const [bb] = await db.all(
      `SELECT ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax,
              ST_YMax(geom) AS ymax FROM basin`,
    );
    const bbox = envelope({
      xmin: num(bb?.xmin),
      ymin: num(bb?.ymin),
      xmax: num(bb?.xmax),
      ymax: num(bb?.ymax),
    });

    await db.conn.run(`
      CREATE TABLE raw AS
      SELECT gid, fna, gna, nam, geom
      FROM ST_Read(${lit(lineShp)}, ${IGN_ST_READ_OPTIONS})`);
    const [nat] = await db.all(
      `SELECT count(*) AS features, sum(${lengthSpheroidKm("geom")}) AS km FROM raw`,
    );

    // Lines touching the basin, exact duplicates removed (same rule as the gate).
    await db.conn.run(`
      CREATE TABLE touch AS
      SELECT r.* FROM raw r, basin b
      WHERE ST_Intersects(r.geom, ${bbox}) AND ST_Intersects(r.geom, b.geom)`);
    await db.conn.run(`
      CREATE TABLE dedup AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (PARTITION BY ST_AsHEXWKB(geom) ORDER BY gid) AS rn
        FROM touch) WHERE rn = 1`);
    const [dup] = await db.all(`
      SELECT (SELECT count(*) FROM touch) AS touching, (SELECT count(*) FROM dedup) AS kept`);

    await createNameMap(db, "dedup", "fna");

    // Stable ids: order by gid, then geometry, so reruns give the same ids.
    await db.conn.run(`
      CREATE TABLE lines AS
      SELECT CAST(row_number() OVER (ORDER BY gid, ST_AsHEXWKB(geom)) AS INTEGER) AS id,
             gid, name, name_key, generic, short_name,
             ${lengthSpheroidKm("geom")} AS km, geom
      FROM (
        SELECT d.gid, m.name, m.name_key,
               NULLIF(trim(d.gna), '') AS generic, NULLIF(trim(d.nam), '') AS short_name,
               ST_CollectionExtract(ST_Intersection(d.geom, b.geom), 2) AS geom
        FROM dedup d
        LEFT JOIN name_map m ON m.raw = d.fna, basin b)
      WHERE NOT ST_IsEmpty(geom)`);
    await db.conn.run(
      `COPY (SELECT * FROM lines ORDER BY id) TO ${lit(`${outDir}/lines.parquet`)} (FORMAT parquet)`,
    );

    const [tot] = await db.all(`
      SELECT count(*) AS features, sum(km) AS km,
             count(*) FILTER (name IS NOT NULL) AS named_features,
             sum(km) FILTER (name IS NOT NULL) AS named_km,
             count(DISTINCT name) AS distinct_names, count(DISTINCT name_key) AS distinct_keys,
             count(DISTINCT id) AS distinct_ids,
             count(*) FILTER (name IS NOT NULL AND generic IS NULL) AS named_without_generic,
             count(*) FILTER (name IS NOT NULL AND short_name IS NULL) AS named_without_short
      FROM lines`);
    const [inBbox] = await db.all(`
      SELECT sum(${lengthSpheroidKm("ST_CollectionExtract(ST_Intersection(geom, " + bbox + "), 2)")}) AS km
      FROM dedup WHERE ST_Intersects(geom, ${bbox})`);
    const [empties] = await db.all(
      `SELECT count(*) AS n FROM lines WHERE geom IS NULL OR ST_IsEmpty(geom)`,
    );
    // `nam` is the short form of `fna`; where it is not part of it, the two disagree.
    const [namDisagree] = await db.all(`
      SELECT count(*) AS n FROM lines
      WHERE name IS NOT NULL AND short_name IS NOT NULL
        AND strpos(name_key, strip_accents(lower(short_name))) = 0`);
    const variants = await db.all(`
      SELECT name_key, list(DISTINCT name ORDER BY name) AS spellings
      FROM lines WHERE name IS NOT NULL
      GROUP BY name_key HAVING count(DISTINCT name) > 1 ORDER BY name_key`);
    const topNames = await db.all(`
      SELECT name, count(*) AS features, sum(km) AS km FROM lines
      WHERE name IS NOT NULL GROUP BY name ORDER BY km DESC LIMIT 15`);

    // Same inputs and rules as pipeline:ign-gate: its perennial figures must be reproduced.
    let gate: { features: number; km: number } | null = null;
    const gateFile = workPath("ign-gate/report.json");
    if (existsSync(gateFile)) {
      const g = JSON.parse(await readFile(gateFile, "utf8")) as {
        ign: { inBasin: { cls: string; features: number; km: number }[] };
      };
      gate = g.ign.inBasin.find((r) => r.cls === "perennial") ?? null;
    }

    const km = num(tot?.km);
    const checks = {
      idsUnique: num(tot?.distinct_ids) === num(tot?.features),
      noEmptyGeometry: num(empties?.n) === 0,
      clippedWithinBbox: km <= num(inBbox?.km) + 1e-6,
      dedupNeverAddsFeatures: num(dup?.kept) <= num(dup?.touching),
      // null when the gate report is absent (nothing to compare against).
      matchesIgnGate: gate
        ? gate.features === num(tot?.features) &&
          Math.abs(pctDiff(km, gate.km)) < GATE_TOLERANCE_PCT
        : null,
    };
    const ok = Object.values(checks).every((c) => c !== false);
    await writeReport("ign", {
      ok,
      checks,
      national: {
        features: num(nat?.features),
        km: round(num(nat?.km)),
      },
      touchingBasin: num(dup?.touching),
      afterExactDuplicateRemoval: num(dup?.kept),
      inBasin: {
        features: num(tot?.features),
        km: round(km),
        namedFeatures: num(tot?.named_features),
        namedFeaturesPct: pct(num(tot?.named_features), num(tot?.features)),
        namedKm: round(num(tot?.named_km)),
        namedKmPct: pct(num(tot?.named_km), km),
        distinctNames: num(tot?.distinct_names),
        distinctNameKeys: num(tot?.distinct_keys),
        namedWithoutGeneric: num(tot?.named_without_generic),
        namedWithoutShortName: num(tot?.named_without_short),
        shortNameNotPartOfFullName: num(namDisagree?.n),
      },
      ignGate: gate,
      /** Names that differ only by accents, case or punctuation (they share a key). */
      spellingVariants: variants.map((v) => ({
        key: v.name_key,
        spellings: v.spellings,
      })),
      topNamesByKm: topNames.map((r) => ({
        name: r.name,
        features: num(r.features),
        km: round(num(r.km)),
      })),
      outputs: [`${outDir}/lines.parquet`].map(rel),
    });
    if (!ok) throw new Error(`ign checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
