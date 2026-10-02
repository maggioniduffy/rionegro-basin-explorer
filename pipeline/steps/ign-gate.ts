/**
 * pipeline:ign-gate — what do IGN's watercourse lines add over HydroRIVERS? (PLAN.md, gate
 * before Phase 5). Read-only measurement; nothing here feeds the app.
 *
 * Inputs: IGN "Corriente de agua perenne" lines (required) and "intermitente" (optional) in
 * data/raw/ign/, the basin polygon (pipeline:basin) and the HydroRIVERS reaches with their
 * named-river mapping (pipeline:rivers, pipeline:named). IGN attribute names come from
 * the layer itself (fna full name, gna generic type, nam short name; confirmed 2026-10-01).
 *
 * Measured, for the perennial class (the gate's verdict) and the intermittent class
 * separately when present:
 *  - IGN km and features in the basin, clipped to the basin polygon, and in its bbox;
 *    exact duplicate lines are dropped first and counted;
 *  - how much of it carries a name, and how many of the hand-approved named rivers appear;
 *  - extra detail: IGN km farther than a buffer from every HydroRIVERS reach, and the
 *    reverse, HydroRIVERS km farther than the buffer from every IGN line (by Strahler order);
 *  - names: HydroRIVERS km with no river name today that lie within the buffer of a named
 *    IGN line. This is a proximity upper bound, not the Phase 5 match.
 * Distances are measured in South America Albers (ESRI:102033), so they are approximate
 * to a few percent; km are spheroid km (IGN) or the HydroRIVERS LENGTH_KM attribute.
 *
 * Outputs in data/work/ign-gate/: report.json, ign_basin.parquet (clipped IGN lines).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { type Db, lit, openDb } from "../lib/duckdb";
import { envelope, lengthSpheroidKm, pctDiff } from "../lib/geo";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import { requireInput } from "../lib/inputs";
import { riverSlug } from "../lib/names";
import { ALBERS, IGN_LINE_LAYERS as LAYERS, buildPairs } from "../lib/ign";

const BUFFERS_M = [100, 250, 500] as const;
/** The distance the verdict uses (PLAN.md gate rule, agreed 2026-10-01). */
const VERDICT_BUFFER_M = 250;
/** Gate rule: real extra detail if both hold. */
const MIN_EXTRA_PCT_OF_IGN = 20;
const MIN_ADD_PCT_OF_HYDRORIVERS = 10;

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100) : null);

/** Buffered geometries for the pairs within `d`. */
async function buildBuffers(db: Db, d: number) {
  await db.conn.run(
    `DROP TABLE IF EXISTS reach_buf; DROP TABLE IF EXISTS ign_buf`,
  );
  await db.conn.run(`
    CREATE TABLE reach_buf AS
    SELECT HYRIV_ID, ST_Buffer(geom_a, ${d}) AS buf FROM reaches_a
    WHERE HYRIV_ID IN (SELECT rid FROM pairs WHERE dist <= ${d})`);
  await db.conn.run(`
    CREATE TABLE ign_buf AS
    SELECT id, ST_Buffer(geom_a, ${d}) AS buf FROM ign_a
    WHERE id IN (SELECT iid FROM pairs WHERE dist <= ${d})`);
}

/** Per class: km of IGN lines farther than `d` metres from every HydroRIVERS reach. */
async function ignFarFromReaches(db: Db, d: number) {
  await db.conn.run(`DROP TABLE IF EXISTS ign_far`);
  await db.conn.run(`
    CREATE TABLE ign_far AS
    WITH near AS (
      SELECT p.iid AS id, ST_Union_Agg(b.buf) AS buf
      FROM pairs p JOIN reach_buf b ON b.HYRIV_ID = p.rid
      WHERE p.dist <= ${d} GROUP BY p.iid)
    SELECT i.id, i.cls, i.named, i.km,
           CASE WHEN i.len_a = 0 THEN 0
                WHEN n.buf IS NULL THEN i.km
                ELSE i.km * ST_Length(ST_Difference(i.geom_a, n.buf)) / i.len_a END AS far_km
    FROM ign_a i LEFT JOIN near n USING (id)`);
  return db.all(`
    SELECT cls, count(*) AS features, sum(km) AS km, sum(far_km) AS far_km,
           sum(far_km) FILTER (named) AS far_named_km,
           count(*) FILTER (far_km > 0.5 * km) AS mostly_far_features
    FROM ign_far GROUP BY cls ORDER BY cls`);
}

/**
 * HydroRIVERS km farther than `d` metres from every IGN line of `cls` (optionally only
 * named lines). Leaves a table `reach_cov_<tag>` with one row per reach.
 */
async function reachCoverage(
  db: Db,
  tag: string,
  cls: string,
  namedOnly: boolean,
  d: number,
) {
  const table = `reach_cov_${tag}`;
  await db.conn.run(`DROP TABLE IF EXISTS ${table}`);
  await db.conn.run(`
    CREATE TABLE ${table} AS
    WITH near AS (
      SELECT p.rid AS HYRIV_ID, ST_Union_Agg(b.buf) AS buf
      FROM pairs p
      JOIN ign_a i ON i.id = p.iid AND i.cls = ${lit(cls)} ${namedOnly ? "AND i.named" : ""}
      JOIN ign_buf b ON b.id = p.iid
      WHERE p.dist <= ${d} GROUP BY p.rid)
    SELECT r.HYRIV_ID, r.ORD_STRA, r.river, r.km,
           CASE WHEN r.len_a = 0 THEN 0
                WHEN n.buf IS NULL THEN r.km
                ELSE r.km * ST_Length(ST_Difference(r.geom_a, n.buf)) / r.len_a END AS far_km
    FROM reaches_a r LEFT JOIN near n USING (HYRIV_ID)`);
  return table;
}

async function main() {
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const riversReport = JSON.parse(
    await readFile(requireInput(workPath("rivers/report.json")), "utf8"),
  ) as { lengthKm: { total: number; geodesicTotal: number } };
  const names = (
    JSON.parse(await readFile(`${ROOT}/pipeline/names.json`, "utf8")) as {
      rivers: { name: string; shortName: string; slug?: string }[];
    }
  ).rivers.map((r) => ({ name: r.name, slug: riverSlug(r) }));
  const layers = LAYERS.filter((l) => {
    if (existsSync(l.shp)) return true;
    if (l.required) requireInput(l.shp);
    console.log(`skipping ${l.cls}: ${rel(l.shp)} missing`);
    return false;
  });

  const outDir = workPath("ign-gate");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  // Bound memory and threads: the proximity steps are heavy on the intermittent layer.
  await db.conn.run(
    `SET memory_limit='8GB'; SET threads=4; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

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

    // 1. IGN lines: national totals, then the basin subset, deduplicated.
    const raw = layers.map(
      (
        l,
      ) => `SELECT ${lit(l.cls)} AS cls, gid, NULLIF(trim(fna), '') AS fna, geom
              FROM ST_Read(${lit(l.shp)}, open_options=['ENCODING=ISO-8859-1'])`,
    );
    await db.conn.run(`CREATE TABLE ign_raw AS ${raw.join(" UNION ALL ")}`);
    const national = await db.all(`
      SELECT cls, count(*) AS features, sum(${lengthSpheroidKm("geom")}) AS km
      FROM ign_raw GROUP BY cls ORDER BY cls`);

    // Features touching the basin (whole), exact duplicates removed per class.
    await db.conn.run(`
      CREATE TABLE ign_touch AS
      SELECT i.* FROM ign_raw i, basin b
      WHERE ST_Intersects(i.geom, ${bbox}) AND ST_Intersects(i.geom, b.geom)`);
    await db.conn.run(`
      CREATE TABLE ign_dedup AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (PARTITION BY cls, ST_AsHEXWKB(geom) ORDER BY gid) AS rn
        FROM ign_touch) WHERE rn = 1`);
    const [dup] = await db.all(`
      SELECT (SELECT count(*) FROM ign_touch) AS touching,
             (SELECT count(*) FROM ign_dedup) AS kept`);

    await db.conn.run(`
      CREATE TABLE ign_basin AS
      SELECT cls, gid, fna, geom FROM (
        SELECT d.cls, d.gid, d.fna,
               ST_CollectionExtract(ST_Intersection(d.geom, b.geom), 2) AS geom
        FROM ign_dedup d, basin b)
      WHERE NOT ST_IsEmpty(geom)`);
    await db.conn.run(
      `COPY ign_basin TO ${lit(`${outDir}/ign_basin.parquet`)} (FORMAT parquet)`,
    );

    const inBasin = await db.all(`
      SELECT cls, count(*) AS features, sum(${lengthSpheroidKm("geom")}) AS km,
             count(*) FILTER (fna IS NOT NULL) AS named_features,
             sum(${lengthSpheroidKm("geom")}) FILTER (fna IS NOT NULL) AS named_km,
             count(DISTINCT fna) AS distinct_names
      FROM ign_basin GROUP BY cls ORDER BY cls`);
    const inBbox = await db.all(`
      SELECT cls, count(*) AS features,
             sum(${lengthSpheroidKm("ST_CollectionExtract(ST_Intersection(geom, " + bbox + "), 2)")}) AS km
      FROM ign_dedup WHERE ST_Intersects(geom, ${bbox}) GROUP BY cls ORDER BY cls`);

    // Overlap check (perennial only; unioning the intermittent layer is too heavy):
    // unioned (noded) length vs summed length.
    log("overlap check…");
    const overlap = await db.all(`
      SELECT cls, sum(${lengthSpheroidKm("geom")}) AS summed_km,
             ${lengthSpheroidKm("ST_Union_Agg(geom)")} AS unioned_km
      FROM ign_basin WHERE cls = 'perennial' GROUP BY cls`);

    // 2. Named rivers: IGN km under the approved names vs the HydroRIVERS main stems.
    await db.conn.run(`CREATE TABLE approved (name VARCHAR, slug VARCHAR)`);
    for (const n of names)
      await db.conn.run(
        `INSERT INTO approved VALUES (${lit(n.name)}, ${lit(n.slug)})`,
      );
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT r.HYRIV_ID, r.ORD_STRA, r.LENGTH_KM AS km, m.river, r.geom
      FROM read_parquet(${lit(reachesFile)}) r
      LEFT JOIN read_parquet(${lit(mappingFile)}) m USING (HYRIV_ID)`);
    const [hr] = await db.all(`
      SELECT count(*) AS reaches, sum(km) AS km, sum(km) FILTER (river IS NULL) AS unnamed_km
      FROM reaches`);
    const namedRivers = await db.all(`
      SELECT a.name,
             (SELECT sum(km) FROM reaches WHERE river = a.slug) AS hydrorivers_km,
             (SELECT sum(${lengthSpheroidKm("geom")}) FROM ign_basin
              WHERE cls = 'perennial'
                AND strip_accents(lower(fna)) = strip_accents(lower(a.name))) AS ign_perennial_km
      FROM approved a ORDER BY hydrorivers_km DESC NULLS LAST`);

    // 3. Proximity analysis in Albers. IGN_GATE_PROXIMITY=perennial skips the (heavy)
    // intermittent class.
    const proxClasses = (
      process.env.IGN_GATE_PROXIMITY ?? layers.map((l) => l.cls).join(",")
    ).split(",");
    await db.conn.run(`
      CREATE TABLE ign_a AS
      SELECT row_number() OVER () AS id, cls, fna IS NOT NULL AS named,
             ${lengthSpheroidKm("geom")} AS km,
             ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom_a
      FROM ign_basin WHERE cls IN (${proxClasses.map(lit).join(", ")})`);
    await db.conn.run(`ALTER TABLE ign_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE ign_a SET len_a = ST_Length(geom_a)`);
    await db.conn.run(`
      CREATE TABLE reaches_a AS
      SELECT HYRIV_ID, ORD_STRA, km, river,
             ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom_a
      FROM reaches`);
    await db.conn.run(`ALTER TABLE reaches_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE reaches_a SET len_a = ST_Length(geom_a)`);

    log("candidate pairs…");
    await buildPairs(db, Math.max(...BUFFERS_M));
    const proximity: Record<string, unknown> = {};
    for (const d of BUFFERS_M) {
      log(`proximity at ${d} m…`);
      await buildBuffers(db, d);
      const ignFar = await ignFarFromReaches(db, d);
      const perClass: Record<string, unknown> = {};
      for (const l of layers.filter((x) => proxClasses.includes(x.cls))) {
        log(`  ${l.cls}…`);
        const t = await reachCoverage(db, `${l.cls}_${d}`, l.cls, false, d);
        const [tot] = await db.all(
          `SELECT sum(km) AS km, sum(far_km) AS far_km FROM ${t}`,
        );
        const byOrder = await db.all(`
          SELECT ORD_STRA AS strahler, sum(km) AS km, sum(far_km) AS far_km
          FROM ${t} GROUP BY 1 ORDER BY 1`);
        const tn = await reachCoverage(
          db,
          `${l.cls}_named_${d}`,
          l.cls,
          true,
          d,
        );
        const [gain] = await db.all(`
          SELECT sum(km - far_km) AS covered_km, sum(km) AS unnamed_km
          FROM ${tn} WHERE river IS NULL`);
        const f = ignFar.find((x) => x.cls === l.cls);
        perClass[l.cls] = {
          ignFarFromHydroRivers: {
            km: round(num(f?.far_km)),
            pctOfIgnKm: pct(num(f?.far_km), num(f?.km)),
            namedKm: round(num(f?.far_named_km)),
            featuresMostlyFar: num(f?.mostly_far_features),
          },
          hydroRiversFarFromIgn: {
            km: round(num(tot?.far_km)),
            pctOfHydroRiversKm: pct(num(tot?.far_km), num(tot?.km)),
            byStrahler: byOrder.map((r) => ({
              strahler: num(r.strahler),
              km: round(num(r.km)),
              farKm: round(num(r.far_km)),
              farPct: pct(num(r.far_km), num(r.km)),
            })),
          },
          unnamedHydroRiversNearNamedIgn: {
            km: round(num(gain?.covered_km)),
            pctOfUnnamedKm: pct(num(gain?.covered_km), num(gain?.unnamed_km)),
          },
        };
      }
      proximity[`${d}m`] = perClass;
    }

    // 4. Verdict for the perennial class (PLAN.md gate rule).
    const per = inBasin.find((r) => r.cls === "perennial");
    const perKm = num(per?.km);
    const hrKm = num(hr?.km);
    const verdictAt = (d: number) => {
      const f = (
        proximity[`${d}m`] as Record<
          string,
          { ignFarFromHydroRivers: { km: number; pctOfIgnKm: number | null } }
        >
      ).perennial?.ignFarFromHydroRivers ?? { km: 0, pctOfIgnKm: null };
      const adds = pct(f.km, hrKm);
      return {
        bufferM: d,
        extraDetailKm: f.km,
        extraPctOfIgn: f.pctOfIgnKm,
        addsPctOverHydroRivers: adds,
        realExtraDetail:
          (f.pctOfIgnKm ?? 0) >= MIN_EXTRA_PCT_OF_IGN &&
          (adds ?? 0) >= MIN_ADD_PCT_OF_HYDRORIVERS,
      };
    };
    const sensitivity = BUFFERS_M.map(verdictAt);
    const main = verdictAt(VERDICT_BUFFER_M);

    const checks = {
      ignPerennialPresent: perKm > 0,
      hydroRiversKmMatchesRiversReport:
        Math.abs(pctDiff(hrKm, riversReport.lengthKm.total)) < 0.1,
      clippedWithinBbox: inBasin.every((r) => {
        const b = inBbox.find((x) => x.cls === r.cls);
        return num(r.km) <= num(b?.km) + 1e-6;
      }),
      dedupNeverAddsFeatures: num(dup?.kept) <= num(dup?.touching),
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("ign-gate", {
      ok,
      checks,
      ign: {
        national: national.map((r) => ({
          cls: r.cls,
          features: num(r.features),
          km: round(num(r.km)),
        })),
        touchingBasin: num(dup?.touching),
        afterExactDuplicateRemoval: num(dup?.kept),
        inBasin: inBasin.map((r) => ({
          cls: r.cls,
          features: num(r.features),
          km: round(num(r.km)),
          namedFeaturesPct: pct(num(r.named_features), num(r.features)),
          namedKmPct: pct(num(r.named_km), num(r.km)),
          distinctNames: num(r.distinct_names),
        })),
        inBasinBbox: inBbox.map((r) => ({
          cls: r.cls,
          features: num(r.features),
          km: round(num(r.km)),
        })),
        overlap: overlap.map((r) => ({
          cls: r.cls,
          summedKm: round(num(r.summed_km)),
          unionedKm: round(num(r.unioned_km)),
          overlapPct: pct(
            num(r.summed_km) - num(r.unioned_km),
            num(r.summed_km),
          ),
        })),
      },
      hydroRivers: {
        reaches: num(hr?.reaches),
        km: round(hrKm),
        kmPerRiversReport: round(riversReport.lengthKm.total),
        unnamedKm: round(num(hr?.unnamed_km)),
      },
      namedRivers: namedRivers.map((r) => ({
        name: r.name,
        hydroRiversKm:
          r.hydrorivers_km == null ? null : round(num(r.hydrorivers_km)),
        ignPerennialKm:
          r.ign_perennial_km == null ? null : round(num(r.ign_perennial_km)),
      })),
      proximity,
      verdict: {
        rule: `detail if IGN km beyond ${VERDICT_BUFFER_M} m of HydroRIVERS is >= ${MIN_EXTRA_PCT_OF_IGN}% of IGN perennial km and >= ${MIN_ADD_PCT_OF_HYDRORIVERS}% of HydroRIVERS km`,
        ignPerennialKm: round(perKm),
        ...main,
        sensitivity,
        note: "Names are judged from namedKmPct and unnamedHydroRiversNearNamedIgn; the HydroRIVERS baseline includes reaches modeled as intermittent, so a perennial-only IGN layer is expected to be smaller.",
      },
      outputs: [`${outDir}/ign_basin.parquet`].map(rel),
    });
    if (!ok)
      throw new Error(`ign-gate checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
