/**
 * pipeline:lines-gate — what does each line source add over the others inside a region's
 * province? (PLAN.md, gate R2 of the Córdoba region.) Read-only measurement; nothing here
 * feeds the app.
 *
 * Inputs (regions/<id>/gate.config.json, paths relative to data/raw/): the province polygon
 * (IGN), HydroRIVERS (15″ modelled network, no names), the IGN perennial and intermittent
 * watercourse lines (names in fna) and the provincial agency's lines (config
 * referenceLines: APRHI "Cursos de agua 2021", names in NOMBRE_COM, class in TIPO, status
 * in Estado_de_). Attribute names come from the layers themselves (inspected 2026-10-11).
 *
 * Per source, clipped to the province (exact duplicates dropped first and counted): features,
 * spheroid km, named km, distinct names, overlap with itself, km by class / status (APRHI) and
 * by Strahler order (HydroRIVERS).
 *
 * Proximity, in South America Albers (distances approximate to a few percent), at 100, 250
 * and 500 m: for every ordered pair (A, B) of {hydrorivers, ign_perennial, ign_all, aprhi},
 * the km of A farther than d from every line of B. For A = HydroRIVERS also by Strahler order.
 * ign_all is perennial plus intermittent; the cell (ign_all, ign_perennial) therefore counts
 * the intermittent lines only (a perennial line is trivially near itself), and (ign_perennial,
 * ign_all) is left out.
 *
 * Names (at config.bufferM): HydroRIVERS km within d of a named line of each source, and how
 * often APRHI and IGN names agree where their lines coincide (strict nameKey, and with
 * abbreviations and parenthesised alternatives expanded; see lib/lines-gate.ts).
 *
 * Verdict per candidate detail source vs HydroRIVERS with the nqn gate's rule: real extra
 * detail if the candidate's km beyond d of every HydroRIVERS reach is >= 20% of its own km
 * and >= 10% of HydroRIVERS km.
 *
 * LINES_GATE_SKIP=ign_intermittent (comma list of source ids) leaves sources out of the
 * proximity analysis when it is too slow; they are still counted per source.
 *
 * Outputs in data/work/<region>/lines-gate/: report.json, lines_province.parquet.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { type Db, type Row, lit, openDb, limitResources } from "../lib/duckdb";
import {
  areaAlbersKm2,
  areaSpheroidKm2,
  envelope,
  lengthSpheroidKm,
} from "../lib/geo";
import { ALBERS, IGN_LINE_LAYERS } from "../lib/ign";
import { INPUTS, requireInput } from "../lib/inputs";
import {
  MIN_ADD_PCT_OF_BASELINE,
  MIN_EXTRA_PCT_OF_SOURCE,
  detailVerdict,
  exactKeyAgree,
  lenientAgree,
  lenientKeys,
  leadingTokens,
  normalizeLabel,
  pctOf,
  round,
  variantAgree,
  variantKeys,
} from "../lib/lines-gate";
import { nameKey } from "../lib/names";
import { rawPath, regionFile, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface Layer {
  path: string;
  srs: string;
}
interface GateConfig {
  province: Layer & { encoding: string; nameField: string; name: string };
  referenceLines: Layer & {
    nameField: string;
    classField: string;
    statusField: string;
    label: string;
    source: string;
  };
  searchBbox: { xmin: number; ymin: number; xmax: number; ymax: number };
  bufferM: number;
}

const BASE_BUFFERS_M = [100, 250, 500];
const HR = "hydrorivers";
const PER = "ign_perennial";
const INT = "ign_intermittent";
/** Slack for km comparisons between independently computed sums. */
const EPS = 1e-6;
const TOP_DISAGREEMENTS = 15;

const num = (v: unknown) => Number(v ?? 0);
const ident = (s: string) => {
  if (!/^\w+$/.test(s)) throw new Error(`unsafe column name in config: ${s}`);
  return s;
};
const vsizip = (file: string) => `/vsizip/${file}`;
const toWgs84 = (g: string, srs: string) =>
  srs === "EPSG:4326"
    ? g
    : `ST_Transform(${g}, ${lit(srs)}, 'EPSG:4326', always_xy := true)`;
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
const inList = (xs: readonly string[]) => xs.map(lit).join(", ");

/** Rows of `Row[]` keyed by a normalised label, summing km and features. */
function groupByLabel(rows: Row[], field: string) {
  const groups = new Map<string, { features: number; km: number }>();
  for (const r of rows) {
    const key = normalizeLabel(r[field] as string | null);
    const g = groups.get(key) ?? { features: 0, km: 0 };
    g.features += num(r.features);
    g.km += num(r.km);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({
      label,
      features: g.features,
      km: g.km,
    }))
    .sort((a, b) => b.km - a.km);
}

/**
 * Candidate pairs of lines of different sources closer than `maxD` metres, into the table
 * `pairs` (u, v, usrc, vsrc, dist), both directions. Needs `lines_a (uid, src, geom_a)`. A
 * grid prefilter (bbox cells expanded by `maxD`) keeps this from being a full cross join.
 */
async function buildLinePairs(db: Db, maxD: number) {
  const cell = (v: string) => `CAST(floor((${v}) / 5000) AS BIGINT)`;
  await db.conn.run(`
    CREATE TABLE lines_cx AS
    SELECT uid, src, ${cell(`ST_YMin(geom_a) - ${maxD}`)} AS y0,
           ${cell(`ST_YMax(geom_a) + ${maxD}`)} AS y1,
           unnest(range(${cell(`ST_XMin(geom_a) - ${maxD}`)},
                        ${cell(`ST_XMax(geom_a) + ${maxD}`)} + 1)) AS cx
    FROM lines_a`);
  await db.conn.run(`
    CREATE TABLE lines_cells AS
    SELECT uid, src, cx, unnest(range(y0, y1 + 1)) AS cy FROM lines_cx`);
  await db.conn.run(`DROP TABLE lines_cx`);
  await db.conn.run(`
    CREATE TABLE pairs_half AS
    SELECT c.u, c.v, c.usrc, c.vsrc, ST_Distance(a.geom_a, b.geom_a) AS dist
    FROM (SELECT DISTINCT p.uid AS u, q.uid AS v, p.src AS usrc, q.src AS vsrc
          FROM lines_cells p JOIN lines_cells q USING (cx, cy)
          WHERE p.uid < q.uid AND p.src <> q.src) c
    JOIN lines_a a ON a.uid = c.u JOIN lines_a b ON b.uid = c.v
    WHERE ST_Distance(a.geom_a, b.geom_a) <= ${maxD}`);
  await db.conn.run(`
    CREATE TABLE pairs AS
    SELECT u, v, usrc, vsrc, dist FROM pairs_half
    UNION ALL SELECT v, u, vsrc, usrc, dist FROM pairs_half`);
  await db.conn.run(`DROP TABLE lines_cells; DROP TABLE pairs_half`);
}

/** Buffers (table `buf`) of every line that is within `d` of a line of another source. */
async function buildBuffers(db: Db, d: number) {
  await db.conn.run(`DROP TABLE IF EXISTS buf`);
  await db.conn.run(`
    CREATE TABLE buf AS
    SELECT uid, ST_Buffer(geom_a, ${d}) AS buf FROM lines_a
    WHERE uid IN (SELECT v FROM pairs WHERE dist <= ${d})`);
}

interface FarOptions {
  /** Only named lines of A / of B count. */
  namedA?: boolean;
  namedB?: boolean;
  /** Extra condition on a pair, over p (pairs), ua (A line) and ub (B line). */
  pairWhere?: string;
}

/**
 * Table `far_tmp (uid, src, ord, km, named, far_km)`: for each line of the A sources, the km
 * farther than `d` metres from every B line. Needs `buf` built for `d`.
 */
async function farTable(
  db: Db,
  a: readonly string[],
  b: readonly string[],
  d: number,
  o: FarOptions = {},
) {
  await db.conn.run(`DROP TABLE IF EXISTS far_tmp`);
  await db.conn.run(`
    CREATE TABLE far_tmp AS
    WITH near AS (
      SELECT p.u AS uid, ST_Union_Agg(bf.buf) AS buf
      FROM pairs p
      JOIN lines_a ua ON ua.uid = p.u
      JOIN lines_a ub ON ub.uid = p.v
      JOIN buf bf ON bf.uid = p.v
      WHERE p.dist <= ${d} AND p.usrc IN (${inList(a)}) AND p.vsrc IN (${inList(b)})
        ${o.namedA ? "AND ua.named" : ""} ${o.namedB ? "AND ub.named" : ""}
        ${o.pairWhere ? `AND ${o.pairWhere}` : ""}
      GROUP BY p.u)
    SELECT l.uid, l.src, l.ord, l.km, l.named,
           CASE WHEN l.len_a = 0 THEN 0
                WHEN n.buf IS NULL THEN l.km
                ELSE l.km * ST_Length(ST_Difference(l.geom_a, n.buf)) / l.len_a END AS far_km
    FROM lines_a l LEFT JOIN near n USING (uid)
    WHERE l.src IN (${inList(a)}) ${o.namedA ? "AND l.named" : ""}`);
}

/** Insert (a, b) text pairs into a two-column table, in chunks. */
async function insertPairs(db: Db, table: string, rows: [string, string][]) {
  await db.conn.run(`CREATE OR REPLACE TABLE ${table} (a VARCHAR, b VARCHAR)`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows
      .slice(i, i + 500)
      .map(([x, y]) => `(${lit(x)}, ${lit(y)})`);
    await db.conn.run(`INSERT INTO ${table} VALUES ${chunk.join(",")}`);
  }
}

async function main() {
  const configFile = regionFile("gate.config.json");
  if (!existsSync(configFile))
    throw new Error(`${rel(configFile)} missing; see regions/<id>/README.md`);
  const config = JSON.parse(await readFile(configFile, "utf8")) as GateConfig;
  const ref = config.referenceLines.label;
  const refName = ident(config.referenceLines.nameField);
  const refClass = ident(config.referenceLines.classField);
  const refStatus = ident(config.referenceLines.statusField);
  const provinceName = ident(config.province.nameField);
  const distances = [...new Set([...BASE_BUFFERS_M, config.bufferM])].sort(
    (x, y) => x - y,
  );
  const verdictD = config.bufferM;

  const provinceFile = requireInput(rawPath(config.province.path));
  const refFile = requireInput(rawPath(config.referenceLines.path));
  const hrFile = requireInput(INPUTS.hydroRivers);
  const ignLayers = IGN_LINE_LAYERS.flatMap((l) => {
    if (existsSync(l.shp)) return [{ ...l, source: `ign_${l.cls}` }];
    if (l.required) requireInput(l.shp);
    console.log(`skipping ${l.cls}: ${rel(l.shp)} missing`);
    return [];
  });
  const loaded = [HR, ...ignLayers.map((l) => l.source), ref];
  const skip = (process.env.LINES_GATE_SKIP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknownSkip = skip.filter((s) => !loaded.includes(s));
  if (unknownSkip.length)
    throw new Error(
      `LINES_GATE_SKIP: unknown sources ${unknownSkip.join(",")}`,
    );
  const proxSources = loaded.filter((s) => !skip.includes(s));

  const outDir = workPath("lines-gate");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  // Bound memory and threads: the proximity steps are heavy on the intermittent layer.
  await limitResources(db, `${outDir}/tmp`);
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  try {
    // 1. Province polygon.
    const found = await db.all(`
      SELECT count(*) AS n FROM ST_Read(${lit(vsizip(provinceFile))},
        open_options=['ENCODING=${config.province.encoding}'])
      WHERE ${provinceName} = ${lit(config.province.name)}`);
    if (num(found[0]?.n) !== 1)
      throw new Error(
        `expected exactly one province "${config.province.name}", found ${num(found[0]?.n)}`,
      );
    await db.conn.run(`
      CREATE TABLE prov AS
      SELECT ${toWgs84("geom", config.province.srs)} AS geom
      FROM ST_Read(${lit(vsizip(provinceFile))},
        open_options=['ENCODING=${config.province.encoding}'])
      WHERE ${provinceName} = ${lit(config.province.name)}`);
    const [pv] = await db.all(`
      SELECT ${areaSpheroidKm2("geom")} AS spheroid_km2, ${areaAlbersKm2("geom")} AS albers_km2,
             ST_IsValid(geom) AS valid, ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin,
             ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax FROM prov`);
    const bbox = envelope({
      xmin: num(pv?.xmin),
      ymin: num(pv?.ymin),
      xmax: num(pv?.xmax),
      ymax: num(pv?.ymax),
    });
    const provinceFound = num(pv?.spheroid_km2) > 0;
    log(`province ${Math.round(num(pv?.spheroid_km2))} km²`);

    // 2. Sources touching the province, as one table in WGS84.
    const refLayer = `ST_Read(${lit(vsizip(refFile))})`;
    const [refDesc] = await db.all(
      `SELECT column_type FROM (DESCRIBE SELECT geom FROM ${refLayer})`,
    );
    const parts = [
      `SELECT ${lit(HR)} AS source, CAST(HYRIV_ID AS BIGINT) AS id, CAST(NULL AS VARCHAR) AS name,
              CAST(NULL AS VARCHAR) AS class, CAST(NULL AS VARCHAR) AS status,
              CAST(ORD_STRA AS INTEGER) AS ord, CAST(LENGTH_KM AS DOUBLE) AS attr_km, geom
       FROM ST_Read(${lit(hrFile)}) WHERE ST_Intersects(geom, ${bbox})`,
      ...ignLayers.map(
        (
          l,
        ) => `SELECT ${lit(l.source)}, CAST(gid AS BIGINT), NULLIF(trim(fna), ''),
              CAST(NULL AS VARCHAR), CAST(NULL AS VARCHAR), CAST(NULL AS INTEGER),
              CAST(NULL AS DOUBLE), geom
       FROM ST_Read(${lit(l.shp)}, open_options=['ENCODING=ISO-8859-1'])
       WHERE ST_Intersects(geom, ${bbox})`,
      ),
      `SELECT ${lit(ref)}, CAST(ID AS BIGINT), NULLIF(trim(${refName}), ''),
              ${refClass}, ${refStatus}, CAST(NULL AS INTEGER), CAST(NULL AS DOUBLE),
              ${toWgs84("geom", config.referenceLines.srs)}
       FROM ${refLayer} WHERE ST_Intersects(${toWgs84("geom", config.referenceLines.srs)}, ${bbox})`,
    ];
    log("reading sources…");
    await db.conn.run(`
      CREATE TABLE lines_touch AS
      SELECT t.* FROM (${parts.join(" UNION ALL ")}) t, prov p
      WHERE ST_Intersects(t.geom, p.geom)`);
    // Ids are not unique in every source (APRHI has repeated IDs), so the tie-break runs over
    // every attribute: the same duplicate is kept on every run.
    await db.conn.run(`
      CREATE TABLE lines_dedup AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (
                 PARTITION BY source, ST_AsHEXWKB(geom)
                 ORDER BY id, name NULLS LAST, class NULLS LAST, status NULLS LAST) AS rn
        FROM lines_touch) WHERE rn = 1`);
    const unclipped = await db.all(`
      SELECT source, count(*) AS features, sum(${lengthSpheroidKm("geom")}) AS km,
             sum(CAST(attr_km AS DECIMAL(18, 3))) AS attr_km
      FROM lines_dedup GROUP BY source`);
    const touching = await db.all(
      `SELECT source, count(*) AS features FROM lines_touch GROUP BY source`,
    );
    await db.conn.run(`
      CREATE TABLE lines AS
      SELECT row_number() OVER (ORDER BY source, id, wkb) AS uid, * EXCLUDE (wkb) FROM (
        SELECT l.source, l.id, l.name, l.class, l.status, l.ord, ST_AsHEXWKB(l.geom) AS wkb,
               ST_CollectionExtract(ST_Intersection(l.geom, p.geom), 2) AS geom
        FROM lines_dedup l, prov p)
      WHERE NOT ST_IsEmpty(geom)`);
    await db.conn.run(`ALTER TABLE lines ADD COLUMN km DOUBLE`);
    await db.conn.run(`UPDATE lines SET km = ${lengthSpheroidKm("geom")}`);
    await db.conn.run(`
      COPY (SELECT source, id, name, class, status, ord AS ORD_STRA, km, geom FROM lines
            ORDER BY uid)
      TO ${lit(`${outDir}/lines_province.parquet`)} (FORMAT parquet)`);
    log("clipped to the province");

    // 3. Per-source figures.
    const perSource = await db.all(`
      SELECT source, count(*) AS features, sum(km) AS km,
             count(*) FILTER (name IS NOT NULL) AS named_features,
             sum(km) FILTER (name IS NOT NULL) AS named_km, count(DISTINCT name) AS distinct_names
      FROM lines GROUP BY source`);
    const overlap = new Map<string, { summed: number; unioned: number }>();
    for (const s of [ref, PER].filter((x) => loaded.includes(x))) {
      const [o] = await db.all(`
        SELECT sum(km) AS summed_km, ${lengthSpheroidKm("ST_Union_Agg(geom)")} AS unioned_km
        FROM lines WHERE source = ${lit(s)}`);
      overlap.set(s, {
        summed: num(o?.summed_km),
        unioned: num(o?.unioned_km),
      });
    }
    const byClass = groupByLabel(
      await db.all(`
        SELECT class, count(*) AS features, sum(km) AS km FROM lines
        WHERE source = ${lit(ref)} GROUP BY class`),
      "class",
    );
    const byStatus = groupByLabel(
      await db.all(`
        SELECT status, count(*) AS features, sum(km) AS km FROM lines
        WHERE source = ${lit(ref)} GROUP BY status`),
      "status",
    );
    const hrByOrder = await db.all(`
      SELECT ord AS strahler, count(*) AS features, sum(km) AS km FROM lines
      WHERE source = ${lit(HR)} GROUP BY ord ORDER BY ord`);

    const sources: Record<string, unknown> = {};
    const sourceKm = new Map<string, number>();
    const clippedOk: Record<string, boolean> = {};
    const dedupOk: Record<string, boolean> = {};
    for (const s of loaded) {
      const r = perSource.find((x) => x.source === s);
      const u = unclipped.find((x) => x.source === s);
      const t = touching.find((x) => x.source === s);
      const km = num(r?.km);
      sourceKm.set(s, km);
      clippedOk[s] = km <= num(u?.km) + EPS;
      dedupOk[s] = num(u?.features) <= num(t?.features);
      const named = s !== HR;
      const o = overlap.get(s);
      sources[s] = {
        source: s === ref ? config.referenceLines.source : undefined,
        touchingProvince: num(t?.features),
        afterExactDuplicateRemoval: num(u?.features),
        duplicatesDropped: num(t?.features) - num(u?.features),
        features: num(r?.features),
        km: round(km),
        kmUnclipped: round(num(u?.km)),
        clippedNotLongerThanUnclipped: clippedOk[s],
        ...(s === HR
          ? {
              lengthKmAttributeUnclipped: round(num(u?.attr_km)),
              byStrahler: hrByOrder.map((x) => ({
                strahler: num(x.strahler),
                features: num(x.features),
                km: round(num(x.km)),
              })),
            }
          : {}),
        ...(named
          ? {
              namedFeatures: num(r?.named_features),
              namedKm: round(num(r?.named_km)),
              namedKmPct: pctOf(num(r?.named_km), km),
              distinctNames: num(r?.distinct_names),
            }
          : {}),
        ...(o
          ? {
              selfOverlap: {
                summedKm: round(o.summed),
                unionedKm: round(o.unioned),
                overlapPct: pctOf(o.summed - o.unioned, o.summed),
              },
            }
          : {}),
        ...(s === ref
          ? {
              byClass: byClass.map((g) => ({
                class: g.label,
                features: g.features,
                km: round(g.km),
              })),
              byStatus: byStatus.map((g) => ({
                status: g.label,
                features: g.features,
                km: round(g.km),
              })),
            }
          : {}),
      };
    }

    // 4. Proximity in Albers.
    const sets: Record<string, string[]> = {
      [HR]: [HR],
      [PER]: [PER],
      ign_all: [PER, INT],
      [ref]: [ref],
    };
    // A set is usable when every member took part in the proximity analysis.
    const usable = (k: string) =>
      sets[k]?.every((s) => proxSources.includes(s)) ?? false;
    const pairList: [string, string][] = (
      [
        [HR, PER],
        [HR, "ign_all"],
        [HR, ref],
        [PER, HR],
        [PER, ref],
        ["ign_all", HR],
        ["ign_all", PER],
        ["ign_all", ref],
        [ref, HR],
        [ref, PER],
        [ref, "ign_all"],
      ] as [string, string][]
    ).filter(([a, b]) => usable(a) && usable(b));
    const notes: string[] = [];
    if (skip.length)
      notes.push(
        `LINES_GATE_SKIP=${skip.join(",")}: left out of the proximity analysis`,
      );
    if (!usable("ign_all") && !skip.includes(INT) && !loaded.includes(INT))
      notes.push("IGN intermittent layer missing: ign_all is not computed");

    await db.conn.run(`
      CREATE TABLE lines_a AS
      SELECT uid, source AS src, name, name IS NOT NULL AS named, km, ord,
             ${albers("geom")} AS geom_a
      FROM lines WHERE source IN (${inList(proxSources)})`);
    await db.conn.run(`ALTER TABLE lines_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE lines_a SET len_a = ST_Length(geom_a)`);
    log("candidate pairs…");
    await buildLinePairs(db, Math.max(...distances));
    log(
      `pairs: ${num((await db.all("SELECT count(*) AS n FROM pairs"))[0]?.n)}`,
    );

    // Names are compared through variant keys; the tables are built once.
    const namesOf = async (src: readonly string[]) =>
      (
        await db.all(`
          SELECT DISTINCT name FROM lines WHERE name IS NOT NULL
            AND source IN (${inList(src)})`)
      ).map((r) => String(r.name));
    const refNames = await namesOf([ref]);
    const ignNames = await namesOf(
      [PER, INT].filter((s) => loaded.includes(s)),
    );
    // Name pairs (APRHI name, IGN name) that agree under a predicate. IGN names are indexed
    // by the keys the predicate can match on, so the comparison is not quadratic.
    const agreePairs = (
      keys: (n: string) => string[],
      test: (a: string, b: string) => boolean,
    ) => {
      const rows: [string, string][] = [];
      const byKey = new Map<string, string[]>();
      for (const n of ignNames)
        for (const k of keys(n)) byKey.set(k, [...(byKey.get(k) ?? []), n]);
      for (const a of refNames) {
        const cands = new Set(keys(a).flatMap((k) => byKey.get(k) ?? []));
        for (const b of cands) if (test(a, b)) rows.push([a, b]);
      }
      return rows;
    };
    await insertPairs(
      db,
      "agree_exact",
      agreePairs((n) => [nameKey(n)], exactKeyAgree),
    );
    await insertPairs(
      db,
      "agree_variant",
      agreePairs(variantKeys, variantAgree),
    );
    await insertPairs(
      db,
      "agree_lenient",
      agreePairs(lenientKeys, lenientAgree),
    );

    const proximity: Record<string, unknown> = {};
    const farCells: { km: number; far: number }[] = [];
    let names: Record<string, unknown> = {};
    let nameAgreement: Record<string, unknown> = {};
    for (const d of distances) {
      log(`proximity at ${d} m…`);
      await buildBuffers(db, d);
      const matrix: Record<string, unknown> = {};
      for (const [aKey, bKey] of pairList) {
        const b = sets[bKey] ?? [];
        // A line is trivially near itself, so shared sources are not part of A.
        const a = (sets[aKey] ?? []).filter((s) => !b.includes(s));
        if (a.length === 0) continue;
        log(`  ${aKey} far from ${bKey}…`);
        await farTable(db, a, b, d);
        const [tot] = await db.all(
          `SELECT sum(km) AS km, sum(far_km) AS far_km FROM far_tmp`,
        );
        const cell: Record<string, unknown> = {
          aSources: a,
          aKm: round(num(tot?.km)),
          farKm: round(num(tot?.far_km)),
          farPctOfA: pctOf(num(tot?.far_km), num(tot?.km)),
        };
        farCells.push({ km: num(tot?.km), far: num(tot?.far_km) });
        if (aKey === HR) {
          const byOrder = await db.all(`
            SELECT ord AS strahler, sum(km) AS km, sum(far_km) AS far_km
            FROM far_tmp GROUP BY ord ORDER BY ord`);
          cell.byStrahler = byOrder.map((r) => ({
            strahler: num(r.strahler),
            km: round(num(r.km)),
            farKm: round(num(r.far_km)),
            farPct: pctOf(num(r.far_km), num(r.km)),
          }));
        }
        matrix[`${aKey}_far_from_${bKey}`] = cell;
      }
      proximity[`${d}m`] = matrix;

      if (d !== verdictD) continue;

      // 5. Naming potential: HydroRIVERS km within d of a named line of each source.
      const hrKm = sourceKm.get(HR) ?? 0;
      const naming: [string, string[]][] = [
        [PER, [PER]],
        ["ign_all", [PER, INT]],
        [ref, [ref]],
        [`ign_all_or_${ref}`, [PER, INT, ref]],
      ];
      const named: Record<string, unknown> = {};
      for (const [key, srcs] of naming) {
        if (!srcs.every((s) => proxSources.includes(s))) continue;
        await farTable(db, [HR], srcs, d, { namedB: true });
        const [t] = await db.all(
          `SELECT sum(km) AS km, sum(far_km) AS far_km FROM far_tmp`,
        );
        const within = num(t?.km) - num(t?.far_km);
        named[`hydrorivers_near_named_${key}`] = {
          km: round(within),
          pctOfHydroRiversKm: pctOf(within, hrKm),
        };
      }
      names = { bufferM: d, hydroRiversKm: round(hrKm), ...named };

      // 6. Name agreement, IGN vs APRHI, on the km where a named APRHI line lies within d of
      // a named IGN line.
      const ignSrcs = [PER, INT].filter((s) => proxSources.includes(s));
      if (proxSources.includes(ref) && ignSrcs.length) {
        const km = async (pairWhere?: string) => {
          await farTable(db, [ref], ignSrcs, d, {
            namedA: true,
            namedB: true,
            pairWhere,
          });
          const [t] = await db.all(
            `SELECT sum(km) AS km, sum(far_km) AS far_km FROM far_tmp`,
          );
          return { total: num(t?.km), within: num(t?.km) - num(t?.far_km) };
        };
        const any = await km();
        const variant = await km(
          `EXISTS (SELECT 1 FROM agree_variant g WHERE g.a = ua.name AND g.b = ub.name)`,
        );
        const lenient = await km(
          `EXISTS (SELECT 1 FROM agree_lenient g WHERE g.a = ua.name AND g.b = ub.name)`,
        );
        const exact = await km(
          `EXISTS (SELECT 1 FROM agree_exact g WHERE g.a = ua.name AND g.b = ub.name)`,
        );
        // Disagreeing name pairs, by km, only for APRHI lines with no agreeing IGN line near.
        const dis = await db.all(`
          WITH cand AS (
            SELECT p.u, p.v FROM pairs p
            JOIN lines_a ua ON ua.uid = p.u AND ua.named
            JOIN lines_a ub ON ub.uid = p.v AND ub.named
            WHERE p.dist <= ${d} AND p.usrc = ${lit(ref)} AND p.vsrc IN (${inList(ignSrcs)})),
          agreeing AS (
            SELECT DISTINCT c.u FROM cand c
            JOIN lines_a ua ON ua.uid = c.u JOIN lines_a ub ON ub.uid = c.v
            JOIN agree_lenient g ON g.a = ua.name AND g.b = ub.name)
          SELECT ua.name AS aprhi_name, ub.name AS ign_name,
                 sum(ua.km * ST_Length(ST_Intersection(ua.geom_a, bf.buf)) / ua.len_a) AS km
          FROM cand c
          JOIN lines_a ua ON ua.uid = c.u JOIN lines_a ub ON ub.uid = c.v
          JOIN buf bf ON bf.uid = c.v
          WHERE c.u NOT IN (SELECT u FROM agreeing) AND ua.len_a > 0
          GROUP BY 1, 2 ORDER BY km DESC LIMIT ${TOP_DISAGREEMENTS}`);
        nameAgreement = {
          bufferM: d,
          namedAprhiKm: round(any.total),
          withinBufferOfNamedIgnKm: round(any.within),
          exactKeyAgreeKm: round(exact.within),
          exactKeyAgreePct: pctOf(exact.within, any.within),
          variantAgreeKm: round(variant.within),
          variantAgreePct: pctOf(variant.within, any.within),
          lenientAgreeKm: round(lenient.within),
          lenientAgreePct: pctOf(lenient.within, any.within),
          disagreements: dis.map((r) => ({
            [`${ref}Name`]: r.aprhi_name,
            ignName: r.ign_name,
            km: round(num(r.km)),
          })),
          note: "exact = nameKey of the full names; variant = abbreviations expanded and parenthesised or 'o' alternatives as extra names; lenient = variant also ignoring articles and prepositions (lib/lines-gate.ts). Disagreements are lenient disagreements, listed only for lines with no agreeing IGN line within the buffer. leadingTokens count distinct names.",
          leadingTokens: {
            [ref]: leadingTokens(refNames),
            ign: leadingTokens(ignNames),
          },
        };
      }
    }

    // 7. Verdict: candidates vs HydroRIVERS with the nqn gate's rule.
    const hrKm = sourceKm.get(HR) ?? 0;
    const candidateKm = (k: string) =>
      (sets[k] ?? []).reduce((s, x) => s + (sourceKm.get(x) ?? 0), 0);
    const cellAt = (d: number, cand: string) =>
      (
        proximity[`${d}m`] as Record<
          string,
          { farKm: number; aKm: number } | undefined
        >
      )[`${cand}_far_from_${HR}`];
    const verdictFor = (cand: string, d: number) => {
      const c = cellAt(d, cand);
      if (!c) return null;
      return {
        bufferM: d,
        sourceKm: c.aKm,
        ...detailVerdict(c.farKm, c.aKm, hrKm),
      };
    };
    const verdict: Record<string, unknown> = {
      rule: `real extra detail if the candidate's km beyond ${verdictD} m of every HydroRIVERS reach is >= ${MIN_EXTRA_PCT_OF_SOURCE}% of the candidate's km and >= ${MIN_ADD_PCT_OF_BASELINE}% of HydroRIVERS km`,
      bufferM: verdictD,
      hydroRiversKm: round(hrKm),
    };
    for (const cand of [PER, "ign_all", ref]) {
      if (!usable(cand)) continue;
      verdict[cand] = {
        candidateKm: round(candidateKm(cand)),
        ...verdictFor(cand, verdictD),
        sensitivity: distances.map((d) => verdictFor(cand, d)),
      };
    }

    const checks = {
      provinceFound,
      everySourceNonEmpty: loaded.every((s) => (sourceKm.get(s) ?? 0) > 0),
      clippedNotLongerThanUnclipped: Object.values(clippedOk).every(Boolean),
      dedupNeverAddsFeatures: Object.values(dedupOk).every(Boolean),
      farNeverExceedsTotal:
        farCells.length > 0 && farCells.every((c) => c.far <= c.km + EPS),
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("lines-gate", {
      ok,
      checks,
      config: {
        province: config.province,
        referenceLines: config.referenceLines,
        layerCrsTagOfReferenceLines: refDesc?.column_type ?? null,
        searchBbox: config.searchBbox,
        bufferM: config.bufferM,
        distancesM: distances,
        proximitySources: proxSources,
        notes,
      },
      province: {
        km2: round(num(pv?.spheroid_km2)),
        albersKm2: round(num(pv?.albers_km2)),
        valid: Boolean(pv?.valid),
      },
      sources,
      proximity,
      names,
      nameAgreement,
      verdict,
      outputs: [`${outDir}/lines_province.parquet`].map(rel),
    });
    if (!ok)
      throw new Error(`lines-gate checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
