/**
 * pipeline:basin, reference mode (R3.1): the region is a set of roots, one per basin of a
 * reference agency (Córdoba: APRHI), and the outline is the agency's polygons as published.
 * HydroBASINS level 12 only carries attributes; HydroRIVERS gives each root's exit.
 *
 * Inputs: regions/<id>/basin.config.json (mode "reference"), the APRHI layers (Shapefiles in
 * zips under data/raw), HydroBASINS level 12, HydroRIVERS, IGN provinces (headwaters report).
 *
 * 1. Province edge: union of the clipped layer (APRHI's clip of its basins to the province).
 * 2. Root polygons: the polygon with each configured code, from the whole or the clipped
 *    layer. They must not overlap (sum vs union).
 * 3. Headwaters (a root with `headwaters`, e.g. the Río Quinto, which rises outside the
 *    province): walk the main stem upstream from `mouthReach` to the first reach whose midpoint
 *    is outside the province, take the level-12 drainage upstream of it (polygons mostly
 *    outside the province), subtract the province and every other root, and merge the rest
 *    into the root.
 * 4. Outline: union of the final root polygons (one Feature, like the outlet mode). Small
 *    holes are filled; a non-sliver hole goes to the root whose wholeLayer polygon covers most
 *    of it (>= 50%), else it stays a hole and is reported.
 * 5. Level-12 members: polygons assigned to the root holding the largest share of their area,
 *    at least assignMinShare (the same rule as basin-gate).
 * 6. Exits: per root, the HydroRIVERS reach with the largest UPLAND_SKM that ends in the
 *    outline (within 1 km) and flows out of the root; compared with expectedExitReach.
 * All areas: spheroid and South America Albers (ESRI:102033).
 *
 * Outputs in data/work/<region>/basin/: basin.geojson, basins.geojson, hybas_l12.parquet,
 * lev12_roots.parquet, roots.json, report.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import {
  type ExitCandidate,
  classifyExit,
  lev12Tolerance,
  pickExit,
  walkMainStem,
  withinPct,
} from "./basin-reference-pure";
import { type Box, assignLargestShare } from "./basin-gate";
import { type Row, lit, openDb } from "./duckdb";
import { areaAlbersKm2, areaSpheroidKm2, envelope } from "./geo";
import { upstreamIndex, upstreamSet } from "./graph";
import { INPUTS, requireInput } from "./inputs";
import { rawPath, rel, workPath } from "./paths";
import { writeReport } from "./report";

export interface LayerConfig {
  path: string;
  srs: string;
  encoding?: string;
  codeField: string;
  nameField: string;
}

interface RootConfig {
  code: string;
  scope: "whole" | "clipped";
  expectedExitReach: number | null;
  headwaters?: { name: string; mouthReach: number };
}

export interface ReferenceConfig {
  mode: "reference";
  regionName: string;
  wholeLayer: LayerConfig;
  clippedLayer: LayerConfig;
  roots: RootConfig[];
  assignMinShare: number;
  /** Interior rings smaller than this (km²) are filled in root polygons and the outline. */
  sliverMaxKm2: number;
  searchBbox: Box;
  reference: {
    areaKm2: number | null;
    source: string | null;
    tolerancePct: number;
  };
}

/** Area figures for the same shapes must agree this closely (percent). */
const AREA_AGREEMENT_PCT = 1;
/** Union vs sum of root polygons, and outline vs sum of roots (percent). */
const OVERLAP_TOLERANCE_PCT = 0.1;
/** Share of the headwater area that must lie outside the province edge (percent). */
const HEADWATERS_OUTSIDE_PCT = 99;
/** An exit candidate's end point may be this far outside the outline (m): edge offsets. */
const EXIT_EDGE_TOLERANCE_M = 1000;
/** Other exit candidates at or above this UPLAND_SKM are listed (R3.2 reconnections). */
const OTHER_EXIT_MIN_UPLAND_KM2 = 1000;
/** A non-sliver hole joins a root when its wholeLayer polygon covers at least this share of it. */
const HOLE_MIN_SHARE = 0.5;
const IGN_PROVINCES = "ign/provincia/provincia.zip";

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: Iterable<number>) => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const bigintList = (ids: Iterable<string>) =>
  `unnest([${[...ids].map((i) => BigInt(i)).join(",")}]::BIGINT[])`;

/** SQL source for a layer path relative to data/raw; a .zip is read through GDAL /vsizip/. */
const source = (relPath: string) => {
  const file = requireInput(rawPath(relPath));
  return lit(file.endsWith(".zip") ? `/vsizip/${file}` : file);
};
const readOptions = (encoding?: string) =>
  encoding ? `, open_options=['ENCODING=${encoding}']` : "";
/** A geometry column as valid EPSG:4326 polygons (APRHI layers have invalid rings). */
const wgs84 = (geom: string, srs: string) =>
  `ST_CollectionExtract(ST_MakeValid(${
    srs === "EPSG:4326"
      ? geom
      : `ST_Transform(${geom}, ${lit(srs)}, 'EPSG:4326', always_xy := true)`
  }), 3)`;
const polygons = (g: string) => `ST_CollectionExtract(ST_MakeValid(${g}), 3)`;

export async function layerTable(
  db: Awaited<ReturnType<typeof openDb>>,
  table: string,
  layer: LayerConfig,
) {
  await db.conn.run(`
    CREATE TABLE ${table} AS
    SELECT ${ident(layer.codeField)}::VARCHAR AS code, any_value(${ident(layer.nameField)}::VARCHAR) AS name,
           count(*)::INT AS n,
           ST_Union_Agg(${wgs84("geom", layer.srs)}) AS geom
    FROM ST_Read(${source(layer.path)}${readOptions(layer.encoding)})
    GROUP BY 1`);
}

interface HoleStats {
  filled: { n: number; km2: number };
  kept: { n: number; km2: number };
  byKey: {
    key: string;
    filledN: number;
    filledKm2: number;
    keptN: number;
    keptKm2: number;
  }[];
}

/**
 * Fill interior rings smaller than `maxKm2` (Albers) in `table`'s geom column, in place.
 * `keyExpr` is a SQL expression giving each row's key. Returns what was filled and kept.
 */
async function fillSmallHoles(
  db: Awaited<ReturnType<typeof openDb>>,
  table: string,
  keyExpr: string,
  maxKm2: number,
): Promise<HoleStats> {
  await db.conn.run(`
    CREATE OR REPLACE TABLE holes AS
    WITH parts AS (SELECT ${keyExpr} AS k, unnest(ST_Dump(geom)).geom AS g FROM ${table}),
    rings AS (
      SELECT k, g, unnest(generate_series(1, ST_NumInteriorRings(g)))::INT AS i
      FROM parts WHERE ST_NumInteriorRings(g) > 0)
    SELECT k, ST_MakePolygon(ST_InteriorRingN(g, i)) AS h FROM rings`);
  await db.conn.run(
    `ALTER TABLE holes ADD COLUMN km2 DOUBLE; UPDATE holes SET km2 = ${areaAlbersKm2("h")}`,
  );
  const rows = await db.all(`
    SELECT k, count(*) FILTER (km2 < ${maxKm2})::INT AS fn,
           coalesce(sum(km2) FILTER (km2 < ${maxKm2}), 0) AS fa,
           count(*) FILTER (km2 >= ${maxKm2})::INT AS kn,
           coalesce(sum(km2) FILTER (km2 >= ${maxKm2}), 0) AS ka
    FROM holes GROUP BY k ORDER BY k`);
  await db.conn.run(`
    UPDATE ${table} SET geom = ${polygons(
      `ST_Union(geom, (SELECT ST_Union_Agg(h) FROM holes WHERE km2 < ${maxKm2} AND k = ${keyExpr}))`,
    )}
    WHERE ${keyExpr} IN (SELECT k FROM holes WHERE km2 < ${maxKm2})`);
  await db.conn.run(`DROP TABLE holes`);
  const byKey = rows.map((r) => ({
    key: str(r.k),
    filledN: num(r.fn),
    filledKm2: round(num(r.fa), 3),
    keptN: num(r.kn),
    keptKm2: round(num(r.ka), 3),
  }));
  return {
    filled: {
      n: sum(byKey.map((r) => r.filledN)),
      km2: round(sum(byKey.map((r) => r.filledKm2)), 3),
    },
    kept: {
      n: sum(byKey.map((r) => r.keptN)),
      km2: round(sum(byKey.map((r) => r.keptKm2)), 3),
    },
    byKey,
  };
}

export async function runReference(config: ReferenceConfig) {
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const { searchBbox, assignMinShare } = config;
  const levFile = requireInput(INPUTS.hydroBasins(12));
  const riversFile = requireInput(INPUTS.hydroRivers);
  const outDir = workPath("basin");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='8GB'; SET threads=4; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const bbox = envelope(searchBbox);
  const codes = config.roots.map((r) => r.code);

  try {
    // 1-2. Province edge and root polygons.
    await layerTable(db, "whole", config.wholeLayer);
    await layerTable(db, "clipped", config.clippedLayer);
    await db.conn.run(
      `CREATE TABLE prov AS SELECT ST_Union_Agg(geom) AS geom FROM clipped`,
    );
    const [provRow] = await db.all(
      `SELECT ${areaAlbersKm2("geom")} AS albers FROM prov`,
    );
    const provinceKm2 = num(provRow?.albers);
    log(`province edge ${round(provinceKm2)} km² (Albers)`);

    await db.conn.run(
      `CREATE TABLE roots_raw (code VARCHAR, name VARCHAR, scope VARCHAR, geom GEOMETRY)`,
    );
    const found: string[] = [];
    const duplicates: { code: string; layer: string; polygons: number }[] = [];
    const rawKm2 = new Map<string, number>();
    const clippedLayerKm2 = new Map<string, number>();
    for (const r of config.roots) {
      // A clipped root is its wholeLayer polygon cut by the province edge, so every internal
      // border comes from one layer; the clippedLayer polygon is only measured for comparison.
      const rows = await db.all(
        `SELECT n FROM whole WHERE code = ${lit(r.code)}`,
      );
      if (rows.length === 0) continue;
      found.push(r.code);
      if (num(rows[0]?.n) > 1)
        duplicates.push({
          code: r.code,
          layer: "whole",
          polygons: num(rows[0]?.n),
        });
      const geom =
        r.scope === "whole"
          ? "w.geom"
          : polygons("ST_Intersection(w.geom, p.geom)");
      await db.conn.run(`
        INSERT INTO roots_raw
        SELECT w.code, w.name, ${lit(r.scope)}, ${geom}
        FROM whole w, prov p WHERE w.code = ${lit(r.code)}`);
      const [m] = await db.all(
        `SELECT ${areaAlbersKm2("geom")} AS km2 FROM roots_raw WHERE code = ${lit(r.code)}`,
      );
      rawKm2.set(r.code, num(m?.km2));
      if (r.scope === "clipped") {
        const [c] = await db.all(
          `SELECT ${areaAlbersKm2("geom")} AS km2 FROM clipped WHERE code = ${lit(r.code)}`,
        );
        clippedLayerKm2.set(r.code, num(c?.km2));
      }
    }
    const everyRootFound = found.length === codes.length;
    if (!everyRootFound) {
      const missing = codes.filter((c) => !found.includes(c));
      await writeReport("basin", {
        ok: false,
        mode: "reference",
        checks: { everyRootFound },
        missingRoots: missing,
      });
      throw new Error(`roots not found in their layers: ${missing.join(", ")}`);
    }

    // Overlaps between raw root polygons go to the root listed first in the config.
    const overlapsRemoved: { keeper: string; loser: string; km2: number }[] =
      [];
    await db.conn.run(
      `CREATE TABLE roots_base (code VARCHAR, name VARCHAR, scope VARCHAR, geom GEOMETRY)`,
    );
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i] as string;
      for (const keeper of codes.slice(0, i)) {
        const [o] = await db.all(`
          SELECT ${areaAlbersKm2(polygons("ST_Intersection(a.geom, b.geom)"))} AS km2
          FROM roots_raw a, roots_raw b
          WHERE a.code = ${lit(keeper)} AND b.code = ${lit(code)} AND ST_Intersects(a.geom, b.geom)`);
        if (num(o?.km2) > 0)
          overlapsRemoved.push({ keeper, loser: code, km2: num(o?.km2) });
      }
      const earlier = codes.slice(0, i).map(lit).join(", ");
      await db.conn.run(`
        INSERT INTO roots_base
        SELECT code, name, scope,
               ${i === 0 ? "geom" : polygons(`ST_Difference(geom, (SELECT ST_Union_Agg(geom) FROM roots_raw WHERE code IN (${earlier})))`)}
        FROM roots_raw WHERE code = ${lit(code)}`);
    }
    const rootHoles = await fillSmallHoles(
      db,
      "roots_base",
      "code",
      config.sliverMaxKm2,
    );

    const baseRows = await db.all(`
      SELECT b.code, b.name, b.scope, ${areaAlbersKm2("b.geom")} AS area_km2,
             ${areaAlbersKm2(polygons("ST_Intersection(b.geom, p.geom)"))} AS in_prov_km2
      FROM roots_base b, prov p`);
    const baseByCode = new Map(baseRows.map((r) => [str(r.code), r]));
    // Overlap between root polygons: sum vs union, plus the pairs that intersect.
    const [overlapTotals] = await db.all(`
      SELECT (SELECT sum(${areaAlbersKm2("geom")}) FROM roots_base) AS summed_km2,
             (SELECT ${areaAlbersKm2("ST_Union_Agg(geom)")} FROM roots_base) AS union_km2`);
    const overlapPairs = await db.all(`
      SELECT a.code AS a, b.code AS b,
             ${areaAlbersKm2(polygons("ST_Intersection(a.geom, b.geom)"))} AS km2
      FROM roots_base a JOIN roots_base b ON a.code < b.code AND ST_Intersects(a.geom, b.geom)`);
    const rootSumBase = num(overlapTotals?.summed_km2);
    const rootUnionBase = num(overlapTotals?.union_km2);
    const overlapPct = ((rootSumBase - rootUnionBase) / rootUnionBase) * 100;
    const rootPolygonsDoNotOverlap =
      Math.abs(overlapPct) <= OVERLAP_TOLERANCE_PCT;
    log(
      `root polygons: sum ${round(rootSumBase)} km², union ${round(rootUnionBase)} km², overlap ${round(overlapPct, 4)}%`,
    );

    // Reference data: level 12 and HydroRIVERS inside the search box.
    log("reading HydroBASINS level 12 and HydroRIVERS…");
    await db.conn.run(`
      CREATE TABLE lev AS
      SELECT HYBAS_ID, NEXT_DOWN, NEXT_SINK, MAIN_BAS, SUB_AREA, UP_AREA, PFAF_ID, ENDO, COAST, geom
      FROM ST_Read(${lit(levFile)}) WHERE ST_Intersects(geom, ${bbox})`);
    await db.conn.run(`
      CREATE TABLE riv AS
      SELECT HYRIV_ID, NEXT_DOWN, UPLAND_SKM, HYBAS_L12, LENGTH_KM, ENDORHEIC, geom
      FROM ST_Read(${lit(riversFile)}) WHERE ST_Intersects(geom, ${bbox})`);
    const levLinks = await db.all(`SELECT HYBAS_ID, NEXT_DOWN FROM lev`);
    const levIndex = upstreamIndex(
      levLinks.map((r) => ({
        id: str(r.HYBAS_ID),
        nextDown: str(r.NEXT_DOWN),
      })),
    );
    const rivRows = await db.all(
      `SELECT HYRIV_ID, NEXT_DOWN, UPLAND_SKM, HYBAS_L12, ENDORHEIC FROM riv`,
    );
    const rivById = new Map(rivRows.map((r) => [str(r.HYRIV_ID), r]));
    const rivIndex = upstreamIndex(
      rivRows.map((r) => ({ id: str(r.HYRIV_ID), nextDown: str(r.NEXT_DOWN) })),
    );

    // 3. Headwaters.
    await db.conn.run(
      `CREATE TABLE roots_final AS SELECT code, name, scope, geom FROM roots_base`,
    );
    const headwaters: Record<string, unknown>[] = [];
    let headwatersOutsideProvince = true;
    let headwatersTouchRoot = true;
    for (const rc of config.roots) {
      const hw = rc.headwaters;
      if (!hw) continue;
      const mouth = String(hw.mouthReach);
      if (!rivById.has(mouth))
        throw new Error(`headwaters mouth reach ${mouth} not found`);
      const upIds = upstreamSet(rivIndex, mouth);
      await db.conn.run(
        `CREATE TABLE up_ids AS SELECT ${bigintList(upIds)} AS id`,
      );
      const outsideRows = await db.all(`
        SELECT r.HYRIV_ID FROM riv r JOIN up_ids u ON u.id = r.HYRIV_ID, prov p
        WHERE NOT ST_Intersects(ST_LineInterpolatePoint(r.geom, 0.5), p.geom)`);
      await db.conn.run(`DROP TABLE up_ids`);
      const outside = new Set(outsideRows.map((r) => str(r.HYRIV_ID)));
      const walk = walkMainStem(
        [...upIds].map((id) => {
          const r = rivById.get(id) as Row;
          return {
            id,
            nextDown: str(r.NEXT_DOWN),
            upland: num(r.UPLAND_SKM),
          };
        }),
        mouth,
        (id) => outside.has(id),
      );
      if (!walk)
        throw new Error(
          `headwaters of root ${rc.code}: the main stem from ${mouth} never leaves the province`,
        );
      const entry = rivById.get(walk.entry) as Row;
      const [entryPt] = await db.all(`
        SELECT ST_X(ST_LineInterpolatePoint(geom, 0.5)) AS lon, ST_Y(ST_LineInterpolatePoint(geom, 0.5)) AS lat
        FROM riv WHERE HYRIV_ID = ${walk.entry}`);
      const entryL12 = str(entry.HYBAS_L12);
      log(
        `headwaters ${rc.code}: entry reach ${walk.entry} after ${walk.path.length} reaches, level-12 ${entryL12}`,
      );

      // Level-12 drainage upstream of the entry reach, mostly outside the province.
      const upLev = upstreamSet(levIndex, entryL12);
      const upRows = await db.all(`
        SELECT l.HYBAS_ID, ${areaAlbersKm2("l.geom")} AS area_km2,
               CASE WHEN ST_Intersects(l.geom, p.geom)
                    THEN ${areaAlbersKm2(polygons("ST_Intersection(l.geom, p.geom)"))} ELSE 0 END AS in_prov_km2
        FROM lev l JOIN (SELECT ${bigintList(upLev)} AS id) u ON u.id = l.HYBAS_ID, prov p`);
      const keepIds = upRows
        .filter(
          (r) =>
            num(r.area_km2) > 0 &&
            (num(r.area_km2) - num(r.in_prov_km2)) / num(r.area_km2) >=
              assignMinShare,
        )
        .map((r) => str(r.HYBAS_ID));
      if (keepIds.length === 0)
        throw new Error(
          `headwaters of root ${rc.code}: no level-12 polygon kept`,
        );
      await db.conn.run(`
        CREATE TABLE hw_raw AS
        SELECT ST_Union_Agg(geom) AS geom FROM lev
        WHERE HYBAS_ID IN (SELECT ${bigintList(keepIds)})`);
      await db.conn.run(`
        CREATE TABLE hw_out AS
        SELECT ${polygons("ST_Difference(h.geom, p.geom)")} AS geom FROM hw_raw h, prov p`);
      await db.conn.run(`
        CREATE TABLE hw AS
        SELECT ${polygons(`ST_Difference(h.geom, (SELECT ST_Union_Agg(geom) FROM roots_base WHERE code <> ${lit(rc.code)}))`)} AS geom
        FROM hw_out h`);
      const removed = await db.all(`
        SELECT b.code, ${areaAlbersKm2(polygons("ST_Intersection(h.geom, b.geom)"))} AS km2
        FROM hw_out h, roots_base b
        WHERE b.code <> ${lit(rc.code)} AND ST_Intersects(h.geom, b.geom)`);
      const [hwStats] = await db.all(`
        SELECT ${areaAlbersKm2("h.geom")} AS albers,
               ${areaAlbersKm2(polygons("ST_Intersection(h.geom, p.geom)"))} AS in_prov_km2,
               ST_Intersects(h.geom, b.geom) AS touches,
               ST_Distance(ST_Transform(h.geom, 'EPSG:4326', 'ESRI:102033', always_xy := true),
                           ST_Transform(b.geom, 'EPSG:4326', 'ESRI:102033', always_xy := true)) AS dist_m
        FROM hw h, prov p, roots_base b WHERE b.code = ${lit(rc.code)}`);
      const hwKm2 = num(hwStats?.albers);
      const outsidePct =
        hwKm2 > 0 ? (1 - num(hwStats?.in_prov_km2) / hwKm2) * 100 : 0;
      headwatersOutsideProvince &&= outsidePct >= HEADWATERS_OUTSIDE_PCT;
      headwatersTouchRoot &&= hwStats?.touches === true;

      let byProvince: { province: string; km2: number }[] | null = null;
      try {
        const provSrc = source(IGN_PROVINCES);
        byProvince = (
          await db.all(`
          SELECT p.fna AS province,
                 ${areaAlbersKm2(polygons("ST_Intersection(h.geom, p.geom)"))} AS km2
          FROM hw h, ST_Read(${provSrc}, open_options=['ENCODING=UTF-8']) p
          WHERE ST_Intersects(h.geom, p.geom) ORDER BY km2 DESC`)
        ).map((r) => ({ province: str(r.province), km2: round(num(r.km2)) }));
      } catch (e) {
        log(`IGN provinces unavailable: ${(e as Error).message}`);
      }

      await db.conn.run(`
        UPDATE roots_final SET geom = ${polygons("ST_Union(roots_final.geom, (SELECT geom FROM hw))")}
        WHERE code = ${lit(rc.code)}`);
      headwaters.push({
        root: rc.code,
        name: hw.name,
        mouthReach: hw.mouthReach,
        entryReach: {
          id: Number(walk.entry),
          uplandSkm: num(entry.UPLAND_SKM),
          hybasL12: entryL12,
          lon: round(num(entryPt?.lon), 4),
          lat: round(num(entryPt?.lat), 4),
        },
        reachesWalked: walk.path.length,
        level12Upstream: upLev.size,
        level12Kept: keepIds.length,
        areaKm2: round(hwKm2),
        outsideProvincePct: round(outsidePct, 3),
        touchesRootPolygon: hwStats?.touches === true,
        distanceToRootPolygonM: round(num(hwStats?.dist_m), 2),
        overlapRemovedKm2: Object.fromEntries(
          removed.map((r) => [str(r.code), round(num(r.km2), 3)]),
        ),
        areaByProvinceKm2: byProvince,
      });
      await db.conn.run(`DROP TABLE hw_raw; DROP TABLE hw_out; DROP TABLE hw`);
    }

    const finalHoles = await fillSmallHoles(
      db,
      "roots_final",
      "code",
      config.sliverMaxKm2,
    );

    // 4. Outline.
    await db.conn.run(`
      CREATE TABLE basin AS
      SELECT ${polygons("ST_Union_Agg(geom)")} AS geom FROM roots_final`);
    const outlineHoles = await fillSmallHoles(
      db,
      "basin",
      "'outline'",
      config.sliverMaxKm2,
    );
    // Holes that are not slivers: APRHI precedence gives each to the root whose wholeLayer
    // polygon covers the largest share of it (at least HOLE_MIN_SHARE), else it stays a hole.
    const bigHoleRows = await db.all(`
      WITH parts AS (SELECT unnest(ST_Dump(geom)).geom AS g FROM basin),
      rings AS (
        SELECT g, unnest(generate_series(1, ST_NumInteriorRings(g)))::INT AS i
        FROM parts WHERE ST_NumInteriorRings(g) > 0),
      holes AS (SELECT row_number() OVER ()::INT AS id, ST_MakePolygon(ST_InteriorRingN(g, i)) AS h FROM rings)
      SELECT id, ${areaAlbersKm2("h")} AS km2, ST_X(ST_Centroid(h)) AS lon, ST_Y(ST_Centroid(h)) AS lat,
             ST_AsText(h) AS wkt
      FROM holes ORDER BY id`);
    const holeFills: {
      km2: number;
      lon: number;
      lat: number;
      root: string | null;
      share: number;
    }[] = [];
    const addedKm2 = new Map<string, number>();
    for (const h of bigHoleRows) {
      const wkt = lit(str(h.wkt));
      const cover = await db.all(`
        SELECT w.code, ${areaAlbersKm2(polygons(`ST_Intersection(w.geom, ST_GeomFromText(${wkt}))`))} AS km2
        FROM whole w
        WHERE w.code IN (${codes.map(lit).join(", ")}) AND ST_Intersects(w.geom, ST_GeomFromText(${wkt}))`);
      const a = assignLargestShare(
        cover.map((c) => ({ key: str(c.code), km2: num(c.km2) })),
        num(h.km2),
        HOLE_MIN_SHARE,
      );
      holeFills.push({
        km2: round(num(h.km2), 3),
        lon: round(num(h.lon), 4),
        lat: round(num(h.lat), 4),
        root: a.key,
        share: round(a.share, 3),
      });
      if (a.key === null) continue;
      await db.conn.run(`
        UPDATE roots_final
        SET geom = ${polygons(`ST_Union(geom, ST_GeomFromText(${wkt}))`)}
        WHERE code = ${lit(a.key)}`);
      addedKm2.set(a.key, (addedKm2.get(a.key) ?? 0) + num(h.km2));
    }
    if (addedKm2.size > 0) {
      await db.conn.run(`DROP TABLE basin`);
      await db.conn.run(`
        CREATE TABLE basin AS
        SELECT ${polygons("ST_Union_Agg(geom)")} AS geom FROM roots_final`);
      await fillSmallHoles(db, "basin", "'outline'", config.sliverMaxKm2);
    }
    await db.conn.run(`
      CREATE TABLE basin_a AS
      SELECT ST_Transform(geom, 'EPSG:4326', 'ESRI:102033', always_xy := true) AS geom FROM basin`);
    const [shape] = await db.all(`
      SELECT ST_IsValid(geom) AS valid, ST_GeometryType(geom)::VARCHAR AS type,
             ST_NumGeometries(geom) AS parts,
             ${areaSpheroidKm2("geom")} AS area_spheroid, ${areaAlbersKm2("geom")} AS area_albers,
             ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
      FROM basin`);
    const [holes] = await db.all(`
      WITH parts AS (SELECT unnest(ST_Dump(geom)).geom AS g FROM basin)
      SELECT sum(ST_NumInteriorRings(g))::INT AS n,
             sum(${areaSpheroidKm2("ST_MakePolygon(ST_ExteriorRing(g))")} - ${areaSpheroidKm2("g")}) AS area
      FROM parts`);
    const finalRows = await db.all(`
      SELECT code, ${areaAlbersKm2("geom")} AS area_km2,
             ${areaSpheroidKm2("geom")} AS area_spheroid_km2
      FROM roots_final`);
    const finalByCode = new Map(finalRows.map((r) => [str(r.code), r]));
    const areaSpheroid = num(shape?.area_spheroid);
    const areaAlbers = num(shape?.area_albers);
    const finalSum = sum(finalRows.map((r) => num(r.area_km2)));

    // 5. Level-12 members, by largest share inside a root polygon.
    log("assigning level-12 polygons…");
    await db.conn.run(`
      CREATE TABLE lev_keep AS
      SELECT l.HYBAS_ID, ${areaAlbersKm2("l.geom")} AS area_km2
      FROM lev l JOIN basin b ON ST_Intersects(l.geom, b.geom)`);
    const ovRows = await db.all(`
      SELECT * FROM (
        SELECT l.HYBAS_ID, r.code,
               ${areaAlbersKm2(polygons("ST_Intersection(l.geom, r.geom)"))} AS km2
        FROM lev l JOIN lev_keep k ON k.HYBAS_ID = l.HYBAS_ID
        JOIN roots_final r ON ST_Intersects(l.geom, r.geom)) WHERE km2 > 0`);
    const keepRows = await db.all(`SELECT HYBAS_ID, area_km2 FROM lev_keep`);
    const overlaps = new Map<string, { key: string; km2: number }[]>();
    for (const r of ovRows) {
      const id = str(r.HYBAS_ID);
      const o = { key: str(r.code), km2: num(r.km2) };
      const list = overlaps.get(id);
      if (list) list.push(o);
      else overlaps.set(id, [o]);
    }
    const assignedRows: { id: string; root: string; share: number }[] = [];
    for (const k of keepRows) {
      const id = str(k.HYBAS_ID);
      const a = assignLargestShare(
        overlaps.get(id) ?? [],
        num(k.area_km2),
        assignMinShare,
      );
      if (a.key !== null)
        assignedRows.push({ id, root: a.key, share: a.share });
    }
    assignedRows.sort((a, b) =>
      a.id.localeCompare(b.id, "en", { numeric: true }),
    );
    await db.conn.run(
      `CREATE TABLE lev12_roots (HYBAS_ID BIGINT, root VARCHAR, share DOUBLE)`,
    );
    for (let i = 0; i < assignedRows.length; i += 1000) {
      const values = assignedRows
        .slice(i, i + 1000)
        .map((a) => `(${BigInt(a.id)}, ${lit(a.root)}, ${a.share})`)
        .join(", ");
      await db.conn.run(`INSERT INTO lev12_roots VALUES ${values}`);
    }
    const [dupes] = await db.all(
      `SELECT count(*) - count(DISTINCT HYBAS_ID) AS d FROM lev12_roots`,
    );
    const everyLev12AtMostOnce = num(dupes?.d) === 0;
    const memberStats = await db.all(`
      SELECT r.root, count(*)::INT AS n, sum(k.area_km2) AS area_km2
      FROM lev12_roots r JOIN lev_keep k ON k.HYBAS_ID = r.HYBAS_ID GROUP BY r.root`);
    const memberByRoot = new Map(memberStats.map((r) => [str(r.root), r]));
    const memberAreaRows = await db.all(`
      SELECT r.root, k.area_km2 FROM lev12_roots r JOIN lev_keep k ON k.HYBAS_ID = r.HYBAS_ID`);
    const memberAreas = new Map<string, number[]>();
    for (const r of memberAreaRows) {
      const list = memberAreas.get(str(r.root)) ?? [];
      list.push(num(r.area_km2));
      memberAreas.set(str(r.root), list);
    }

    // 6. Exits.
    log("finding exits…");
    const rootOfL12 = new Map(assignedRows.map((a) => [a.id, a.root]));
    const rootOfReach = (id: string): string | null => {
      const r = rivById.get(id);
      return r ? (rootOfL12.get(str(r.HYBAS_L12)) ?? null) : null;
    };
    const rawCandidates: {
      id: string;
      root: string;
      upland: number;
      kind: ExitCandidate["kind"];
      intoCode: string | null;
    }[] = [];
    for (const [id, r] of rivById) {
      const root = rootOfReach(id);
      if (root === null) continue;
      const nextDown = str(r.NEXT_DOWN);
      const nextRoot = nextDown === "0" ? null : rootOfReach(nextDown);
      if (nextDown !== "0" && nextRoot === root) continue;
      const { kind, intoCode } = classifyExit(
        { nextDown, endorheic: num(r.ENDORHEIC) },
        nextRoot,
      );
      rawCandidates.push({
        id,
        root,
        upland: num(r.UPLAND_SKM),
        kind,
        intoCode,
      });
    }
    await db.conn.run(`CREATE TABLE cand (id BIGINT)`);
    for (let i = 0; i < rawCandidates.length; i += 1000) {
      const values = rawCandidates
        .slice(i, i + 1000)
        .map((c) => `(${BigInt(c.id)})`)
        .join(", ");
      await db.conn.run(`INSERT INTO cand VALUES ${values}`);
    }
    const endRows = await db.all(`
      SELECT r.HYRIV_ID, ST_X(ST_EndPoint(r.geom)) AS lon, ST_Y(ST_EndPoint(r.geom)) AS lat,
             ST_DWithin(ST_Transform(ST_EndPoint(r.geom), 'EPSG:4326', 'ESRI:102033', always_xy := true),
                        b.geom, ${EXIT_EDGE_TOLERANCE_M}) AS inside
      FROM riv r JOIN cand c ON c.id = r.HYRIV_ID, basin_a b`);
    const endById = new Map(endRows.map((r) => [str(r.HYRIV_ID), r]));
    const rootsOut = config.roots.map((rc) => {
      const mine = rawCandidates.filter(
        (c) => c.root === rc.code && endById.get(c.id)?.inside === true,
      );
      const expected = rc.expectedExitReach;
      const { exit, largest, exitIsLargest, expectedIsCandidate, others } =
        pickExit(
          mine,
          expected === null ? null : String(expected),
          OTHER_EXIT_MIN_UPLAND_KM2,
        );
      const end = exit ? endById.get(exit.id) : undefined;
      const base = baseByCode.get(rc.code) as Row;
      const fin = finalByCode.get(rc.code) as Row;
      const members = memberByRoot.get(rc.code);
      const hwReport = headwaters.find((h) => h.root === rc.code);
      return {
        code: rc.code,
        name: str(base.name),
        scope: rc.scope,
        aprhiAreaKm2: round(num(base.area_km2)),
        areaKm2: round(num(fin.area_km2)),
        inProvinceKm2: round(num(base.in_prov_km2)),
        lev12Count: num(members?.n),
        lev12AreaKm2: round(num(members?.area_km2)),
        lev12: (() => {
          const diff = num(members?.area_km2) - num(fin.area_km2);
          const toleranceKm2 = lev12Tolerance(
            num(fin.area_km2),
            memberAreas.get(rc.code) ?? [],
            config.reference.tolerancePct,
          );
          return {
            diffKm2: round(diff),
            diffPct: round((diff / num(fin.area_km2)) * 100, 2),
            toleranceKm2: round(toleranceKm2),
            pass: Math.abs(diff) <= toleranceKm2,
          };
        })(),
        ...(rc.scope === "clipped"
          ? {
              clippedComparison: {
                wholeCutByProvinceKm2: round(rawKm2.get(rc.code) ?? 0),
                clippedLayerKm2: round(clippedLayerKm2.get(rc.code) ?? 0),
                diffKm2: round(
                  (rawKm2.get(rc.code) ?? 0) -
                    (clippedLayerKm2.get(rc.code) ?? 0),
                ),
                diffPct: round(
                  (((rawKm2.get(rc.code) ?? 0) -
                    (clippedLayerKm2.get(rc.code) ?? 0)) /
                    (clippedLayerKm2.get(rc.code) ?? 1)) *
                    100,
                  3,
                ),
              },
            }
          : {}),
        exit: exit
          ? {
              HYRIV_ID: Number(exit.id),
              UPLAND_SKM: exit.upland,
              kind: exit.kind,
              intoCode: exit.intoCode,
              lon: round(num(end?.lon), 4),
              lat: round(num(end?.lat), 4),
              expected,
              isCandidate: expectedIsCandidate,
              exitIsLargest,
            }
          : null,
        largestCandidate: largest
          ? {
              HYRIV_ID: Number(largest.id),
              UPLAND_SKM: largest.upland,
              kind: largest.kind,
              intoCode: largest.intoCode,
            }
          : null,
        otherExits: others.map((o) => ({
          HYRIV_ID: Number(o.id),
          kind: o.kind,
          intoCode: o.intoCode,
          upland: o.upland,
        })),
        ...(hwReport ? { headwaters: hwReport } : {}),
      };
    });

    // Outputs.
    const feature = {
      type: "Feature",
      properties: {
        name: config.regionName,
        areaKm2: Math.round(areaSpheroid),
        source: `APRHI basin polygons as published, union of ${codes.length} roots; headwaters outside the province from HydroBASINS v1c level 12`,
        roots: codes,
      },
      geometry: JSON.parse(
        str((await db.all(`SELECT ST_AsGeoJSON(geom) AS g FROM basin`))[0]?.g),
      ),
    };
    const geojsonFile = `${outDir}/basin.geojson`;
    await writeFile(
      geojsonFile,
      JSON.stringify({ type: "FeatureCollection", features: [feature] }),
    );
    const rootFeatures = [];
    for (const rc of config.roots) {
      const [g] = await db.all(
        `SELECT name, scope, ST_AsGeoJSON(geom) AS g FROM roots_final WHERE code = ${lit(rc.code)}`,
      );
      rootFeatures.push({
        type: "Feature",
        properties: { code: rc.code, name: str(g?.name), scope: rc.scope },
        geometry: JSON.parse(str(g?.g)),
      });
    }
    const basinsFile = `${outDir}/basins.geojson`;
    await writeFile(
      basinsFile,
      JSON.stringify({ type: "FeatureCollection", features: rootFeatures }),
    );
    await db.conn.run(`
      COPY (SELECT l.* FROM lev l JOIN lev12_roots r ON r.HYBAS_ID = l.HYBAS_ID ORDER BY l.HYBAS_ID)
      TO ${lit(`${outDir}/hybas_l12.parquet`)} (FORMAT parquet)`);
    await db.conn.run(`
      COPY (SELECT * FROM lev12_roots ORDER BY HYBAS_ID)
      TO ${lit(`${outDir}/lev12_roots.parquet`)} (FORMAT parquet)`);
    const rootsFile = `${outDir}/roots.json`;
    await writeFile(rootsFile, JSON.stringify(rootsOut, null, 2) + "\n");

    const checks = {
      everyRootFound,
      rootPolygonsDoNotOverlap,
      outlineValid: shape?.valid === true,
      outlineAreaMatchesRootSum: withinPct(
        areaAlbers,
        finalSum,
        OVERLAP_TOLERANCE_PCT,
      ),
      everyLev12AtMostOnce,
      lev12AreaMatchesRootArea: rootsOut.every((r) => r.lev12.pass),
      exitsAreCandidates: rootsOut.every(
        (r) => r.exit !== null && r.exit.isCandidate !== false,
      ),
      headwatersOutsideProvince,
      headwatersTouch04: headwatersTouchRoot,
      spheroidMatchesAlbers: withinPct(
        areaSpheroid,
        areaAlbers,
        AREA_AGREEMENT_PCT,
      ),
    };
    const ok = Object.values(checks).every((v) => v === true);

    await writeReport("basin", {
      ok,
      mode: "reference",
      checks,
      roots: rootsOut.map((r) => ({
        code: r.code,
        scope: r.scope,
        areaKm2: r.areaKm2,
        aprhiAreaKm2: r.aprhiAreaKm2,
        lev12Count: r.lev12Count,
        lev12AreaKm2: r.lev12AreaKm2,
        lev12: r.lev12,
        clippedComparison:
          "clippedComparison" in r ? r.clippedComparison : undefined,
        exit: r.exit,
      })),
      overlap: {
        rootSumKm2: round(rootSumBase),
        rootUnionKm2: round(rootUnionBase),
        pct: round(overlapPct, 5),
        pairs: overlapPairs.map((p) => ({
          a: str(p.a),
          b: str(p.b),
          km2: round(num(p.km2), 3),
        })),
        duplicatePolygonsPerCode: duplicates,
        removed: overlapsRemoved.map((o) => ({ ...o, km2: round(o.km2, 3) })),
      },
      slivers: {
        sliverMaxKm2: config.sliverMaxKm2,
        rootPolygons: rootHoles,
        rootsAfterHeadwaters: finalHoles,
        outline: outlineHoles,
        holesGivenToRoots: {
          minShare: HOLE_MIN_SHARE,
          holes: holeFills,
          addedKm2ByRoot: Object.fromEntries(
            [...addedKm2].map(([k, v]) => [k, round(v, 3)]),
          ),
        },
      },
      provinceEdgeKm2: round(provinceKm2),
      outline: {
        type: shape?.type,
        valid: shape?.valid,
        areaSpheroidKm2: round(areaSpheroid),
        areaAlbersKm2: round(areaAlbers),
        rootSumKm2: round(finalSum),
        parts: shape?.parts,
        holes: holes?.n,
        holesAreaKm2: holes?.area,
        bbox: {
          xmin: shape?.xmin,
          ymin: shape?.ymin,
          xmax: shape?.xmax,
          ymax: shape?.ymax,
        },
      },
      headwaters,
      reference: config.reference,
      outputs: [
        rel(geojsonFile),
        rel(basinsFile),
        rel(`${outDir}/hybas_l12.parquet`),
        rel(`${outDir}/lev12_roots.parquet`),
        rel(rootsFile),
      ],
    });
    if (!ok)
      throw new Error(
        `basin reference checks failed: ${Object.entries(checks)
          .filter(([, v]) => v !== true)
          .map(([k]) => k)
          .join(", ")}`,
      );
  } finally {
    db.close();
  }
}
