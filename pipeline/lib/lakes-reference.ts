/**
 * pipeline:lakes in reference mode (R3.6; regions/<id>/lakes.config.json, "mode": "reference").
 * Used by Córdoba, where the water comes from APRHI > IGN > HydroLAKES (owner, 2026-10-12);
 * a region without the file runs the HydroLAKES path in steps/lakes.ts, untouched.
 *
 * Water polygons (the file names the layers, fields and thresholds):
 *  1. Inside the province edge (union of basin.config.json clippedLayer, as pipeline:lines):
 *     APRHI natural bodies and APRHI reservoirs, made valid, clipped to the region outline.
 *     A feature crossing the edge (Mar Chiquita) is taken whole.
 *  2. Outside the province and inside the outline: IGN Embalse (BH130) and Espejo de agua
 *     perenne, minus APRHI's polygons. An IGN polygon that APRHI covers at least
 *     ign.dropCoveredShare is the same water body and is dropped whole.
 *  3. HydroLAKES polygons (clipped to the outline) that APRHI and IGN polygons cover less than
 *     hydroLakes.maxCoveredShare of, minus what those cover.
 *  4. Where kept polygons still overlap, the higher precedence wins (lib/water-pure.ts TIER).
 *  Each polygon gets an id (source layer + source id), source, kind, name (APRHI's with the
 *  abbreviations expanded, IGN's fna, HydroLAKES' only when nothing else), geodesic area and a
 *  `network` flag (lib/water-network.ts).
 *
 * Lines: the displayed pieces (pipeline:lines) and the HydroRIVERS reaches are clipped out of
 * the water: inside a natural lake nothing stays; inside a reservoir only the pieces / reaches
 * of an approved river (pipeline:named river_reaches) stay. Pieces shorter than minPieceM left
 * by the cut are dropped.
 *
 * Outputs in data/work/<id>/lakes/: lakes.parquet and lakes.geojson (read by pipeline:mask and
 * pipeline:ign-layers), line_geom.parquet (pieceId -> clipped geometry; empty = drawn nowhere),
 * reach_geom.parquet (HYRIV_ID -> clipped geometry, read by pipeline:export), report.json.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import {
  layerTable,
  ident,
  source,
  wgs84,
  type LayerConfig,
} from "./basin-reference";
import { type Db, limitResources, lit, openDb } from "./duckdb";
import { areaSpheroidKm2, lengthSpheroidKm } from "./geo";
import { IGN_ST_READ_OPTIONS, IGN_WATER_SHP, createNameMap } from "./ign";
import { hydroLakesBbox } from "./hydrolakes";
import { requireInput } from "./inputs";
import { regionFile, rel, workPath } from "./paths";
import { writeReport } from "./report";
import {
  type LakesConfig,
  type WaterLayer,
  TIER,
  expandWaterName,
  sortDamCaveat,
  sourceOf,
  waterId,
  waterKind,
  yearOrNull,
} from "./water-pure";
import { assignNetwork, createHybasNetwork } from "./water-network";

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const sph = areaSpheroidKm2;
/** Plain (untyped-CRS) geometry, so values read from GeoJSON / Parquet mix with the rest. */
const plain = (g: string) => `ST_GeomFromWKB(ST_AsWKB(${g}))`;
const EMPTY_POLYGON = "ST_GeomFromText('POLYGON EMPTY')";
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

/**
 * From `src` (key columns + polygon `geom`) into `out` (same columns, `geom` a multipolygon):
 * parts smaller than `minKm2` are dropped, and a row with no part left disappears. Returns what
 * was dropped.
 */
async function keepParts(
  db: Db,
  src: string,
  out: string,
  keys: string[],
  minKm2: number,
) {
  const k = keys.join(", ");
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${out}_parts AS
    SELECT ${k}, d.geom AS g, d.path[1] AS n FROM (
      SELECT ${k}, unnest(ST_Dump(geom)) AS d FROM ${src})`);
  await db.conn.run(`ALTER TABLE ${out}_parts ADD COLUMN km2 DOUBLE`);
  await db.conn.run(`UPDATE ${out}_parts SET km2 = ${sph("g")}`);
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${out} AS
    SELECT ${k}, ST_Collect(list(g ORDER BY n)) AS geom
    FROM ${out}_parts WHERE km2 >= ${minKm2} GROUP BY ${k}`);
  const [d] = await db.all(`
    SELECT count(*) FILTER (km2 < ${minKm2})::INT AS parts,
           coalesce(sum(km2) FILTER (km2 < ${minKm2}), 0) AS km2,
           (SELECT count(*) FROM ${src})::INT - (SELECT count(*) FROM ${out}) AS rows_lost
    FROM ${out}_parts`);
  return {
    partsDropped: num(d?.parts),
    km2Dropped: round(num(d?.km2), 4),
    rowsWithNothingLeft: num(d?.rows_lost),
  };
}

/**
 * Clip the lines of `table` (columns `idCol`, `approved`, `geom`) out of the water in `lakes`:
 * inside a natural lake or a reservoir the line is cut; inside a reservoir it stays when
 * `approved`. Creates `<p>_geom (id, geom, km_before, km_cut, km_sliver, km_after)` for the
 * lines that touch water, and returns the statistics.
 */
async function clipLines(
  db: Db,
  p: string,
  table: string,
  idCol: string,
  minPieceM: number,
) {
  const len = lengthSpheroidKm;
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${p}_hits AS
    SELECT x.${idCol} AS id, l.id AS lake_id, l.source, l.kind, x.approved,
           (l.kind = 'reservoir' AND x.approved) AS keep_inside,
           ${len("ST_CollectionExtract(ST_Intersection(x.geom, l.geom), 2)")} AS km_inside
    FROM ${table} x JOIN lakes l ON ST_Intersects(x.geom, l.geom)`);
  await db.conn.run(`DELETE FROM ${p}_hits WHERE km_inside <= 0`);
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${p}_cut AS
    SELECT h.id, ST_Union_Agg(l.geom) AS g
    FROM ${p}_hits h JOIN lakes l ON l.id = h.lake_id
    WHERE NOT h.keep_inside GROUP BY h.id`);
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${p}_clip AS
    SELECT x.${idCol} AS id, ST_CollectionExtract(ST_Difference(x.geom, c.g), 2) AS geom,
           ${len("x.geom")} AS km_before,
           ${len("ST_CollectionExtract(ST_Intersection(x.geom, c.g), 2)")} AS km_cut
    FROM ${table} x JOIN ${p}_cut c ON c.id = x.${idCol}`);
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${p}_parts AS
    SELECT id, d.geom AS g, d.path[1] AS n, ${len("d.geom")} * 1000 AS m FROM (
      SELECT id, unnest(ST_Dump(geom)) AS d FROM ${p}_clip)`);
  await db.conn.run(`
    CREATE OR REPLACE TABLE ${p}_geom AS
    SELECT c.id, coalesce(k.geom, ST_GeomFromText('LINESTRING EMPTY')) AS geom,
           c.km_before, c.km_cut, coalesce(s.km, 0) AS km_sliver, 0.0::DOUBLE AS km_after
    FROM ${p}_clip c
    LEFT JOIN (SELECT id, ST_Collect(list(g ORDER BY n)) AS geom FROM ${p}_parts
               WHERE m >= ${minPieceM} GROUP BY id) k USING (id)
    LEFT JOIN (SELECT id, sum(m) / 1000 AS km FROM ${p}_parts
               WHERE m < ${minPieceM} GROUP BY id) s USING (id)`);
  await db.conn.run(`
    UPDATE ${p}_geom SET km_after = CASE WHEN ST_IsEmpty(geom) THEN 0 ELSE ${len("geom")} END`);

  const [tot] = await db.all(`
    SELECT count(*)::INT AS touched,
           count(*) FILTER (ST_IsEmpty(geom))::INT AS removed_whole,
           sum(km_before) AS km_before, sum(km_after) AS km_after,
           sum(km_cut) AS km_cut, sum(km_sliver) AS km_sliver,
           coalesce(max(abs(km_before - km_after - km_cut - km_sliver)), 0) AS worst_row_km
    FROM ${p}_geom`);
  const [input] = await db.all(
    `SELECT count(*)::INT AS n, sum(${len("geom")}) AS km FROM ${table}`,
  );
  const [still] = await db.all(`
    SELECT coalesce(sum(${len("ST_CollectionExtract(ST_Intersection(g.geom, c.g), 2)")}), 0) AS km
    FROM ${p}_geom g JOIN ${p}_cut c USING (id) WHERE NOT ST_IsEmpty(g.geom)`);
  const bySource = await db.all(`
    SELECT source, kind, count(DISTINCT id)::INT AS lines,
           round(coalesce(sum(km_inside) FILTER (NOT keep_inside), 0), 3) AS removed_km,
           round(coalesce(sum(km_inside) FILTER (keep_inside), 0), 3) AS kept_inside_km
    FROM ${p}_hits GROUP BY ALL ORDER BY source, kind`);
  const kmBefore = num(tot?.km_before);
  const residual = Math.abs(
    kmBefore - num(tot?.km_after) - num(tot?.km_cut) - num(tot?.km_sliver),
  );
  return {
    inputLines: num(input?.n),
    inputKm: round(num(input?.km), 1),
    linesTouchingWater: num(tot?.touched),
    linesRemovedWhole: num(tot?.removed_whole),
    kmTouchedBefore: round(kmBefore, 3),
    kmKept: round(num(tot?.km_after), 3),
    kmRemovedInWater: round(num(tot?.km_cut), 3),
    kmSliversDropped: round(num(tot?.km_sliver), 3),
    /** kept + removed against the touched input, as a share of it (%) */
    conservationResidualPct: kmBefore > 0 ? (100 * residual) / kmBefore : 0,
    worstRowResidualKm: round(num(tot?.worst_row_km), 6),
    /** length of kept lines inside the water they were cut from (should be 0) */
    keptLineKmInCutWater: round(num(still?.km), 6),
    bySource,
  };
}

export async function runLakesReference(config: LakesConfig) {
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const basinConfig = JSON.parse(
    await readFile(regionFile("basin.config.json"), "utf8"),
  ) as { clippedLayer: LayerConfig };
  const outlineFile = requireInput(workPath("basin/basin.geojson"));
  const hybasFile = requireInput(workPath("basin/hybas_l12.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const linesFile = requireInput(workPath("lines/lines.parquet"));
  const outDir = workPath("lakes");
  await mkdir(outDir, { recursive: true });
  const files = {
    lakesParquet: `${outDir}/lakes.parquet`,
    lakesGeojson: `${outDir}/lakes.geojson`,
    lineGeom: `${outDir}/line_geom.parquet`,
    reachGeom: `${outDir}/reach_geom.parquet`,
  };
  const previous: Record<string, string | null> = {};
  for (const [k, f] of Object.entries(files))
    previous[k] = existsSync(f) ? await sha256(f) : null;

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  try {
    // 0. Province edge, region outline.
    log("province edge and outline…");
    await layerTable(db, "clipped", basinConfig.clippedLayer);
    await db.conn.run(
      `CREATE TABLE prov AS SELECT ST_Union_Agg(geom) AS geom FROM clipped`,
    );
    await db.conn.run(`
      CREATE TABLE outline AS
      SELECT ST_Union_Agg(${plain("geom")}) AS geom FROM ST_Read(${lit(outlineFile)})`);

    // 1. APRHI polygons (natural bodies and reservoirs).
    log("APRHI polygons…");
    const nat = config.aprhi.natural;
    const emb = config.aprhi.reservoirs;
    const aprhiSelect = (
      layer: "nat" | "emb",
      c: typeof nat,
      extra: string,
    ) => `
      SELECT '${layer}' AS layer, ${ident(c.idField)}::BIGINT AS sid,
             NULLIF(trim(${ident(c.nameField)}::VARCHAR), '') AS raw_name,
             ${ident(c.globalIdField)}::VARCHAR AS global_id, ${extra},
             geom IS NULL AS null_geom,
             (geom IS NOT NULL AND NOT ST_IsValid(geom)) AS invalid_in_source,
             CASE WHEN geom IS NULL THEN NULL ELSE ${wgs84("geom", c.srs)} END AS geom
      FROM ST_Read(${source(c.path)})`;
    await db.conn.run(`
      CREATE TABLE apr_src AS
      ${aprhiSelect("nat", nat, "NULL::VARCHAR AS tipo, NULL::DOUBLE AS year_raw, NULL::DOUBLE AS area_ha")}
      UNION ALL
      ${aprhiSelect(
        "emb",
        emb,
        `NULLIF(trim(${ident(emb.typeField)}::VARCHAR), '') AS tipo,
         ${ident(emb.yearField)}::DOUBLE AS year_raw, ${ident(emb.areaHaField)}::DOUBLE AS area_ha`,
      )}`);
    const aprhiSource = await db.all(`
      SELECT layer, count(*)::INT AS rows,
             count(*) FILTER (null_geom)::INT AS null_geometry,
             count(*) FILTER (invalid_in_source)::INT AS invalid_in_source
      FROM apr_src GROUP BY layer ORDER BY layer`);
    const nullGeometry = await db.all(`
      SELECT layer, sid, raw_name FROM apr_src WHERE null_geom ORDER BY layer, sid`);
    const invalidInSource = await db.all(`
      SELECT layer, sid, raw_name,
             round(${sph("geom")}, 2) AS km2_after_make_valid
      FROM apr_src WHERE invalid_in_source ORDER BY layer, sid`);
    await db.conn.run(`
      CREATE TABLE apr_clip AS
      SELECT s.layer, s.sid, s.raw_name, s.global_id, s.tipo, s.year_raw, s.area_ha,
             ${sph("s.geom")} AS km2_source,
             CASE WHEN ST_Within(s.geom, o.geom) THEN s.geom
                  ELSE ST_CollectionExtract(ST_Intersection(s.geom, o.geom), 3) END AS geom
      FROM apr_src s, outline o WHERE NOT s.null_geom`);
    await db.conn.run(`
      CREATE TABLE apr AS SELECT * FROM apr_clip WHERE NOT ST_IsEmpty(geom)`);
    const [aprCounts] = await db.all(`
      SELECT (SELECT count(*) FROM apr_src)::INT AS source_rows,
             (SELECT count(*) FROM apr)::INT AS kept_rows`);
    const [aprClip] = await db.all(`
      SELECT count(*) FILTER (ST_IsEmpty(geom))::INT AS outside_outline_whole,
             round(sum(km2_source) - sum(${sph("geom")}), 3) AS km2_clipped_off
      FROM apr_clip`);

    // Names: expand abbreviations once in JS (one tested definition) and join back.
    const rawNames = await db.all(`
      SELECT DISTINCT raw_name AS v FROM apr WHERE raw_name IS NOT NULL ORDER BY 1`);
    await db.conn.run(
      `CREATE TABLE apr_names (raw VARCHAR, name VARCHAR, blank BOOLEAN)`,
    );
    const unknown = new Map<string, string[]>();
    const expansions = new Map<string, number>();
    const blanks: string[] = [];
    for (const { v } of rawNames) {
      const e = expandWaterName(String(v), config);
      for (const u of e.unknown)
        unknown.set(u, [...(unknown.get(u) ?? []), String(v)]);
      for (const w of e.expanded)
        expansions.set(w, (expansions.get(w) ?? 0) + 1);
      if (e.blank) blanks.push(String(v));
      await db.conn.run(
        `INSERT INTO apr_names VALUES (${lit(String(v))}, ${e.name === null ? "NULL" : lit(e.name)}, ${e.blank})`,
      );
    }
    if (unknown.size > 0)
      throw new Error(
        `APRHI names with dotted words that are neither in abbreviations nor in keepDotted of lakes.config.json: ${JSON.stringify(
          Object.fromEntries(unknown),
        )}`,
      );
    await db.conn.run(
      `CREATE TABLE apr_u AS SELECT ST_Union_Agg(geom) AS geom FROM apr`,
    );

    // 2. IGN polygons: clipped to the outline, then outside the province and outside APRHI.
    log("IGN polygons…");
    const ignRead = (shp: string) =>
      `ST_Read(${lit(requireInput(shp))}, ${IGN_ST_READ_OPTIONS})`;
    await db.conn.run(`
      CREATE TABLE ign_raw AS
      SELECT 'bh130' AS layer, gid::BIGINT AS sid, NULLIF(trim(fna), '') AS fna, geom
      FROM ${ignRead(IGN_WATER_SHP.reservoirs)}
      UNION ALL
      SELECT 'perenne', gid::BIGINT, NULLIF(trim(fna), ''), geom
      FROM ${ignRead(IGN_WATER_SHP.waterBodies)}`);
    await db.conn.run(`
      CREATE TABLE ign_all AS
      SELECT layer, sid, fna,
             ST_CollectionExtract(ST_Intersection(ST_MakeValid(r.geom), o.geom), 3) AS geom
      FROM ign_raw r, outline o WHERE ST_Intersects(r.geom, o.geom)`);
    await db.conn.run(`DELETE FROM ign_all WHERE ST_IsEmpty(geom)`);
    await createNameMap(db, "ign_all", "fna");
    await db.conn.run(`CREATE TABLE ign_names AS SELECT * FROM name_map`);
    await db.conn.run(`
      CREATE TABLE ign_cov AS
      SELECT i.layer, i.sid, i.fna, i.geom, u.g AS apr_g,
             ${sph("i.geom")} AS km2_in_outline,
             coalesce(${sph("ST_Intersection(i.geom, u.g)")}, 0) / nullif(${sph("i.geom")}, 0)
               AS apr_share
      FROM ign_all i
      LEFT JOIN (SELECT i2.layer, i2.sid, ST_Union_Agg(a.geom) AS g
                 FROM ign_all i2 JOIN apr a ON ST_Intersects(i2.geom, a.geom)
                 GROUP BY i2.layer, i2.sid) u USING (layer, sid)`);
    await db.conn.run(`
      CREATE TABLE ign_k0 AS
      SELECT layer, sid, apr_share, km2_in_outline,
             ST_CollectionExtract(
               CASE WHEN apr_g IS NULL THEN ST_Difference(geom, (SELECT geom FROM prov))
                    ELSE ST_Difference(ST_Difference(geom, (SELECT geom FROM prov)), apr_g) END,
               3) AS geom
      FROM ign_cov WHERE coalesce(apr_share, 0) < ${config.ign.dropCoveredShare}`);
    await db.conn.run(`
      CREATE TABLE ign_k0b AS
      SELECT layer, sid, apr_share, km2_in_outline, geom,
             ${sph("geom")} AS km2_outside_province
      FROM ign_k0 WHERE NOT ST_IsEmpty(geom)`);
    const ignParts = await keepParts(
      db,
      "ign_k0b",
      "ign_k",
      ["layer", "sid"],
      config.ign.minKm2,
    );
    const ignDropped = await db.all(`
      SELECT c.layer, c.sid, c.fna, round(c.km2_in_outline, 2) AS km2_in_outline,
             round(c.apr_share, 3) AS aprhi_share
      FROM ign_cov c
      WHERE coalesce(c.apr_share, 0) >= ${config.ign.dropCoveredShare}
      ORDER BY c.km2_in_outline DESC LIMIT 40`);
    const [ignDroppedTotal] = await db.all(`
      SELECT count(*)::INT AS polygons, round(sum(km2_in_outline), 1) AS km2
      FROM ign_cov WHERE coalesce(apr_share, 0) >= ${config.ign.dropCoveredShare}`);
    const [ignCounts] = await db.all(`
      SELECT (SELECT count(*) FROM ign_all)::INT AS in_outline,
             (SELECT count(*) FROM ign_k0)::INT AS not_covered_by_aprhi,
             (SELECT count(*) FROM ign_k0b)::INT AS with_part_outside_province,
             (SELECT count(*) FROM ign_k)::INT AS kept`);
    // IGN water inside the province that APRHI does not cover: reported, never used.
    const ignInsideProvince = await db.all(`
      SELECT layer, sid, fna, round(km2, 3) AS km2 FROM (
        SELECT layer, sid, fna,
               ${sph(`CASE WHEN apr_g IS NULL THEN ST_Intersection(geom, (SELECT geom FROM prov))
                           ELSE ST_Difference(ST_Intersection(geom, (SELECT geom FROM prov)), apr_g) END`)} AS km2
        FROM ign_cov)
      WHERE km2 >= 0.1 ORDER BY km2 DESC LIMIT 15`);

    // 3. HydroLAKES polygons that APRHI and IGN leave uncovered.
    log("HydroLAKES polygons…");
    const hlCache = await hydroLakesBbox(db);
    await db.conn.run(`
      CREATE TABLE hl AS
      SELECT Hylak_id::BIGINT AS sid, NULLIF(trim(Lake_name), '') AS raw_name,
             Lake_type AS hylak_type, Lake_area AS lake_area,
             ST_CollectionExtract(ST_Intersection(ST_MakeValid(l.geom), o.geom), 3) AS geom
      FROM read_parquet(${lit(hlCache)}) l, outline o WHERE ST_Intersects(l.geom, o.geom)`);
    await db.conn.run(`DELETE FROM hl WHERE ST_IsEmpty(geom)`);
    await db.conn.run(`
      CREATE TABLE hl_cov AS
      SELECT h.sid, h.raw_name, h.hylak_type, h.lake_area, h.geom,
             ${sph("h.geom")} AS km2_in_outline, c.g AS cover_g,
             coalesce(${sph("ST_Intersection(h.geom, c.g)")}, 0) / nullif(${sph("h.geom")}, 0)
               AS covered_share
      FROM hl h
      LEFT JOIN (SELECT h2.sid, ST_Union_Agg(w.geom) AS g
                 FROM hl h2 JOIN (SELECT geom FROM apr UNION ALL SELECT geom FROM ign_k) w
                   ON ST_Intersects(h2.geom, w.geom)
                 GROUP BY h2.sid) c USING (sid)`);
    await db.conn.run(`
      CREATE TABLE hl_k0 AS
      SELECT sid, covered_share, km2_in_outline,
             ST_CollectionExtract(
               CASE WHEN cover_g IS NULL THEN geom ELSE ST_Difference(geom, cover_g) END, 3) AS geom
      FROM hl_cov WHERE coalesce(covered_share, 0) < ${config.hydroLakes.maxCoveredShare}`);
    await db.conn.run(`DELETE FROM hl_k0 WHERE ST_IsEmpty(geom)`);
    const hlParts = await keepParts(
      db,
      "hl_k0",
      "hl_k",
      ["sid"],
      config.hydroLakes.minKm2,
    );
    await createNameMap(db, "hl", "raw_name");
    await db.conn.run(`CREATE TABLE hl_names AS SELECT * FROM name_map`);

    // 4. Candidates, precedence and the final cut.
    log("precedence…");
    await db.conn.run(`
      CREATE TABLE cand0 AS
      SELECT layer, sid, a.geom, n.name AS own_name, a.global_id, a.tipo, a.year_raw, a.area_ha,
             NULL::INTEGER AS hylak_type, NULL::VARCHAR AS hl_name
      FROM apr a LEFT JOIN apr_names n ON n.raw = a.raw_name
      UNION ALL
      SELECT k.layer, k.sid, k.geom, m.name, NULL, NULL, NULL, NULL, NULL, NULL
      FROM ign_k k JOIN ign_all i USING (layer, sid) LEFT JOIN ign_names m ON m.raw = i.fna
      UNION ALL
      SELECT 'hydrolakes', k.sid, k.geom, NULL, NULL, NULL, NULL, NULL, h.hylak_type, m.name
      FROM hl_k k JOIN hl h USING (sid) LEFT JOIN hl_names m ON m.raw = h.raw_name`);
    // Ids, source, kind, tier: one tested definition in lib/water-pure.ts, joined back.
    const layerRows = await db.all(
      `SELECT DISTINCT layer, sid, coalesce(hylak_type, -1) AS t FROM cand0 ORDER BY 1, 2`,
    );
    await db.conn.run(
      `CREATE TABLE layer_info (layer VARCHAR, sid BIGINT, t INTEGER, id VARCHAR, source VARCHAR, kind VARCHAR, tier INTEGER)`,
    );
    const infoRows = layerRows.map((r) => {
      const layer = String(r.layer) as WaterLayer;
      const t = num(r.t);
      return `(${lit(layer)}, ${num(r.sid)}, ${t}, ${lit(waterId(layer, num(r.sid)))}, ${lit(sourceOf(layer))}, ${lit(waterKind(layer, t === -1 ? null : t))}, ${TIER[layer]})`;
    });
    for (let i = 0; i < infoRows.length; i += 500)
      await db.conn.run(
        `INSERT INTO layer_info VALUES ${infoRows.slice(i, i + 500).join(", ")}`,
      );
    const yearRows = await db.all(
      `SELECT DISTINCT year_raw AS v FROM cand0 WHERE year_raw IS NOT NULL`,
    );
    await db.conn.run(`CREATE TABLE year_map (raw DOUBLE, year INTEGER)`);
    for (const { v } of yearRows) {
      const y = yearOrNull(num(v), emb.yearNoValue);
      await db.conn.run(
        `INSERT INTO year_map VALUES (${num(v)}, ${y === null ? "NULL" : y})`,
      );
    }
    await db.conn.run(`
      CREATE TABLE cand AS
      SELECT i.id, c.layer, c.sid, i.source, i.kind, i.tier, c.geom, c.own_name,
             c.global_id, c.tipo, y.year AS year_start, c.area_ha, c.hylak_type, c.hl_name,
             ${sph("c.geom")} AS km2_cand,
             row_number() OVER (ORDER BY i.tier, c.own_name IS NULL, ${sph("c.geom")} DESC, i.id)
               AS prio
      FROM cand0 c
      JOIN layer_info i ON i.layer = c.layer AND i.sid = c.sid AND i.t = coalesce(c.hylak_type, -1)
      LEFT JOIN year_map y ON y.raw = c.year_raw`);
    // A candidate loses the parts that a higher-precedence candidate covers.
    await db.conn.run(`
      CREATE TABLE ov AS
      SELECT c1.id, ST_Union_Agg(c2.geom) AS g, count(*)::INT AS n_over
      FROM cand c1
      JOIN cand c2 ON c2.prio < c1.prio AND ST_Intersects(c1.geom, c2.geom)
                  AND ST_Area(ST_Intersection(c1.geom, c2.geom)) > 1e-12
      GROUP BY c1.id`);
    await db.conn.run(`
      CREATE TABLE cut0 AS
      SELECT c.id, ST_CollectionExtract(ST_Difference(c.geom, o.g), 3) AS geom
      FROM cand c JOIN ov o USING (id)`);
    const overlapParts = await keepParts(
      db,
      "cut0",
      "cut_k",
      ["id"],
      config.minPartKm2,
    );
    const overlapped = await db.all(`
      SELECT c.id, c.own_name AS name, c.source, c.kind, round(c.km2_cand, 4) AS km2_before,
             round(${sph("coalesce(k.geom, " + EMPTY_POLYGON + ")")}, 4) AS km2_after,
             o.n_over AS higher_polygons
      FROM cand c JOIN ov o USING (id) LEFT JOIN cut_k k USING (id)
      ORDER BY c.km2_cand DESC`);
    await db.conn.run(`
      CREATE TABLE lk0 AS
      SELECT c.* EXCLUDE (geom), coalesce(k.geom, c.geom) AS geom
      FROM cand c LEFT JOIN cut_k k USING (id)
      WHERE c.id NOT IN (SELECT id FROM ov) OR k.id IS NOT NULL`);

    // 5. Names: own name, else the IGN polygon covering most of the lake, else HydroLAKES'.
    log("names, areas, network…");
    await db.conn.run(`ALTER TABLE lk0 ADD COLUMN area_km2 DOUBLE`);
    await db.conn.run(`UPDATE lk0 SET area_km2 = round(${sph("geom")}, 3)`);
    await db.conn.run(`
      CREATE TABLE ign_named AS
      SELECT i.layer, i.sid, m.name, m.name_key, i.geom
      FROM ign_all i JOIN ign_names m ON m.raw = i.fna`);
    await db.conn.run(`
      CREATE TABLE ign_over AS
      SELECT id, name, overlap FROM (
        SELECT id, name, overlap,
               row_number() OVER (PARTITION BY id ORDER BY overlap DESC, name) AS rn
        FROM (
          SELECT u.id, u.name,
                 ${sph("ST_Intersection(l.geom, u.g)")} / ${sph("l.geom")} AS overlap
          FROM (SELECT l.id, p.name_key, min(p.name) AS name, ST_Union_Agg(p.geom) AS g
                FROM lk0 l JOIN ign_named p ON ST_Intersects(l.geom, p.geom)
                WHERE l.own_name IS NULL AND l.source <> 'ign'
                GROUP BY l.id, p.name_key) u
          JOIN lk0 l USING (id)))
      WHERE rn = 1 AND overlap >= ${config.nameMinOverlap}`);
    await db.conn.run(`
      CREATE TABLE lk1 AS
      SELECT l.id, l.layer, l.sid AS source_id, l.source, l.kind, l.tier,
             coalesce(l.own_name, o.name, l.hl_name) AS name,
             CASE WHEN l.own_name IS NOT NULL THEN l.source
                  WHEN o.name IS NOT NULL THEN 'ign'
                  WHEN l.hl_name IS NOT NULL THEN 'hydrolakes' END AS name_source,
             l.area_km2, l.global_id, l.tipo AS aprhi_type, l.year_start, l.area_ha AS aprhi_area_ha,
             CASE WHEN l.layer = 'hydrolakes' THEN l.sid END AS hylak_id,
             l.hylak_type, l.geom
      FROM lk0 l LEFT JOIN ign_over o USING (id)`);
    const outsideProvince = await assignNetworkForLakes(
      db,
      hybasFile,
      reachesFile,
    );
    await db.conn.run(`
      CREATE TABLE lakes AS
      SELECT l.id, l.source, l.source_id, l.layer, l.kind, l.name, l.name_source, l.area_km2,
             n.network, l.global_id, l.aprhi_type, l.year_start, l.aprhi_area_ha, l.hylak_id,
             l.hylak_type, l.geom
      FROM lk1 l JOIN lake_net n USING (id)`);

    // 6. Lines.
    log("lines…");
    await db.conn.run(`
      CREATE TABLE approved AS
      SELECT DISTINCT HYRIV_ID FROM read_parquet(${lit(mappingFile)}) WHERE river IS NOT NULL`);
    await db.conn.run(`
      CREATE TABLE pieces_in AS
      SELECT pieceId, l.reach, (l.reach IS NOT NULL AND l.reach IN (SELECT HYRIV_ID FROM approved)) AS approved,
             ${plain("l.geom")} AS geom
      FROM read_parquet(${lit(linesFile)}) l`);
    await db.conn.run(`
      CREATE TABLE reaches_in AS
      SELECT r.HYRIV_ID, r.HYRIV_ID IN (SELECT HYRIV_ID FROM approved) AS approved,
             ${plain("r.geom")} AS geom
      FROM read_parquet(${lit(reachesFile)}) r`);
    const pieceStats = await clipLines(
      db,
      "piece",
      "pieces_in",
      "pieceId",
      config.minPieceM,
    );
    const reachStats = await clipLines(
      db,
      "reach",
      "reaches_in",
      "HYRIV_ID",
      config.minPieceM,
    );

    // 7. Checks on the polygons.
    log("checks…");
    const [poly] = await db.all(`
      SELECT count(*)::INT AS n, count(DISTINCT id)::INT AS distinct_ids,
             count(*) FILTER (NOT ST_IsValid(geom) OR ST_IsEmpty(geom))::INT AS invalid
      FROM lakes`);
    const [overlap] = await db.all(`
      SELECT count(*)::INT AS pairs, coalesce(sum(km2), 0) AS km2, coalesce(max(km2), 0) AS max_km2 FROM (
        SELECT ${sph("ST_Intersection(a.geom, b.geom)")} AS km2
        FROM lakes a JOIN lakes b ON a.id < b.id AND ST_Intersects(a.geom, b.geom))
      WHERE km2 > 0`);
    const [outside] = await db.all(`
      SELECT coalesce(sum(${sph("ST_Difference(l.geom, o.geom)")}), 0) AS km2
      FROM lakes l, outline o WHERE NOT ST_Within(l.geom, o.geom)`);

    // 8. Outputs.
    log("writing…");
    await rm(files.lakesGeojson, { force: true });
    await db.conn.run(`
      COPY (SELECT * FROM lakes ORDER BY id) TO ${lit(files.lakesParquet)} (FORMAT parquet)`);
    await db.conn.run(`
      COPY (SELECT id, name, kind, source, network, geom FROM lakes ORDER BY id)
      TO ${lit(files.lakesGeojson)} WITH (FORMAT gdal, DRIVER 'GeoJSON',
                                          LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);
    await db.conn.run(`
      COPY (SELECT id AS pieceId, geom, km_before, km_after FROM piece_geom ORDER BY id)
      TO ${lit(files.lineGeom)} (FORMAT parquet)`);
    await db.conn.run(`
      COPY (SELECT id AS HYRIV_ID, geom, km_before, km_after FROM reach_geom ORDER BY id)
      TO ${lit(files.reachGeom)} (FORMAT parquet)`);
    const shas: Record<string, string> = {};
    for (const [k, f] of Object.entries(files)) shas[k] = await sha256(f);
    const identical = Object.entries(previous).every(([, s]) => s === null)
      ? null
      : Object.entries(previous).every(([k, s]) => s === shas[k]);

    // 9. Report.
    const bySource = await db.all(`
      SELECT source, layer, kind, count(*)::INT AS polygons, round(sum(area_km2), 2) AS km2,
             count(name)::INT AS named
      FROM lakes GROUP BY ALL ORDER BY source, layer, kind`);
    const bySourceTotal = await db.all(`
      SELECT source, count(*)::INT AS polygons, round(sum(area_km2), 2) AS km2
      FROM lakes GROUP BY source ORDER BY source`);
    const hlAdded = await db.all(`
      SELECT l.hylak_id, l.name, l.name_source, l.kind, round(l.area_km2, 2) AS area_km2,
             round(h.covered_share, 3) AS covered_share_by_aprhi_ign,
             round(h.km2_in_outline, 2) AS km2_in_outline, l.network
      FROM lakes l JOIN hl_cov h ON h.sid = l.hylak_id
      WHERE l.source = 'hydrolakes' ORDER BY l.area_km2 DESC`);
    const [hlAddedWhere] = await db.all(`
      SELECT count(*) FILTER (ST_Intersects(ST_PointOnSurface(l.geom), p.geom))::INT AS inside_province,
             round(coalesce(sum(l.area_km2) FILTER (ST_Intersects(ST_PointOnSurface(l.geom), p.geom)), 0), 1) AS inside_province_km2,
             count(*) FILTER (NOT ST_Intersects(ST_PointOnSurface(l.geom), p.geom))::INT AS outside_province,
             round(coalesce(sum(l.area_km2) FILTER (NOT ST_Intersects(ST_PointOnSurface(l.geom), p.geom)), 0), 1) AS outside_province_km2
      FROM lakes l, prov p WHERE l.source = 'hydrolakes'`);
    const hlCovered = await db.all(`
      SELECT count(*)::INT AS polygons, round(sum(km2_in_outline), 1) AS km2,
             count(*) FILTER (covered_share >= ${config.hydroLakes.maxCoveredShare})::INT AS covered
      FROM hl_cov`);
    const [hlSplit] = await db.all(`
      SELECT count(*)::INT AS polygons,
             round(sum(${sph("geom")}), 2) AS km2,
             round(sum(${sph("ST_Intersection(geom, (SELECT geom FROM prov))")}), 2) AS km2_inside_province
      FROM lakes WHERE source = 'hydrolakes'`);
    const hlBig = await db.all(`
      SELECT sid AS hylak_id, raw_name AS name, hylak_type AS type, round(km2_in_outline, 1) AS km2,
             round(covered_share, 3) AS covered_share,
             (covered_share < ${config.hydroLakes.maxCoveredShare}) AS added
      FROM hl_cov ORDER BY km2_in_outline DESC LIMIT 12`);
    const named = await db.all(`
      SELECT source, coalesce(name_source, 'none') AS name_source, count(*)::INT AS polygons
      FROM lakes GROUP BY ALL ORDER BY ALL`);
    const ignNamed = await db.all(`
      SELECT id, name, kind, round(area_km2, 2) AS area_km2 FROM lakes
      WHERE source = 'aprhi' AND name_source = 'ign' ORDER BY area_km2 DESC LIMIT 10`);
    const [ignNamedCount] = await db.all(
      `SELECT count(*)::INT AS n FROM lakes WHERE source = 'aprhi' AND name_source = 'ign'`,
    );
    const hotspots = await db.all(`
      SELECT id, name, name_source, kind, source, round(area_km2, 2) AS area_km2, network
      FROM lakes
      WHERE name ILIKE 'Mar Chiquita%' OR name ILIKE '%Salinas Grandes%' OR name ILIKE 'Chiquita'
         OR hylak_id IN (84, 85) OR kind = 'reservoir' AND area_km2 >= 5
      ORDER BY area_km2 DESC`);
    const reservoirs = await db.all(`
      SELECT id, name, aprhi_type, year_start, round(area_km2, 3) AS area_km2,
             round(aprhi_area_ha / 100, 3) AS source_area_km2,
             round(100 * (area_km2 - aprhi_area_ha / 100) / nullif(aprhi_area_ha / 100, 0), 1) AS diff_pct,
             network
      FROM lakes WHERE layer = 'emb' ORDER BY area_km2 DESC`);
    const damRows = await db.all(`
      SELECT name, area_km2, year_start FROM lakes
      WHERE layer = 'emb' AND aprhi_type IN (${config.aprhi.reservoirs.damTypes.map(lit).join(", ")})`);
    const notDams = await db.all(`
      SELECT name, aprhi_type, round(area_km2, 3) AS area_km2 FROM lakes
      WHERE layer = 'emb' AND aprhi_type NOT IN (${config.aprhi.reservoirs.damTypes.map(lit).join(", ")})`);
    const damCaveat = sortDamCaveat(
      damRows.map((r) => ({
        name: r.name === null ? null : String(r.name),
        areaKm2: round(num(r.area_km2), 3),
        yearStart: r.year_start === null ? null : num(r.year_start),
      })),
    );
    const networkCounts = await db.all(`
      SELECT source, network, count(*)::INT AS polygons, round(sum(area_km2), 1) AS km2
      FROM lakes GROUP BY ALL ORDER BY ALL`);
    const [netStats] = await db.all(`SELECT count(*)::INT AS n FROM hybnet`);

    const checks = {
      idsUnique: num(poly?.n) === num(poly?.distinct_ids),
      polygonsValidAndNotEmpty: num(poly?.invalid) === 0,
      noOverlapBetweenPolygons: num(overlap?.max_km2) <= config.overlapMaxKm2,
      polygonsInsideOutline: num(outside?.km2) <= config.outsideOutlineMaxKm2,
      lineGeomConservesKm:
        pieceStats.conservationResidualPct <= config.conservationPct,
      reachGeomConservesKm:
        reachStats.conservationResidualPct <= config.conservationPct,
      noLineLeftInCutWater:
        pieceStats.keptLineKmInCutWater <= 0.01 &&
        reachStats.keptLineKmInCutWater <= 0.01,
      everyAprhiFeatureAccountedFor:
        num(aprCounts?.source_rows) ===
        num(aprCounts?.kept_rows) +
          nullGeometry.length +
          num(aprClip?.outside_outline_whole),
      identicalToPreviousRun: identical !== false,
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("lakes", {
      ok,
      checks,
      mode: "reference",
      config: {
        ign: config.ign,
        hydroLakes: config.hydroLakes,
        nameMinOverlap: config.nameMinOverlap,
        minPartKm2: config.minPartKm2,
        minPieceM: config.minPieceM,
      },
      water: {
        polygons: num(poly?.n),
        km2: round(
          bySourceTotal.reduce((s, r) => s + num(r.km2), 0),
          2,
        ),
        bySource: bySourceTotal,
        byLayerAndKind: bySource,
        names: named,
      },
      aprhi: {
        source: aprhiSource,
        nullGeometryDropped: nullGeometry,
        invalidInSourceMadeValid: invalidInSource,
        clippedToOutline: aprClip,
        nameInventory: {
          distinctRawNames: rawNames.length,
          expandedWords: Object.fromEntries(expansions),
          blankNames: blanks,
          keptDottedWords: config.keepDotted,
        },
        reservoirs,
        reservoirsNotDams: notDams,
      },
      ign: {
        ...ignCounts,
        dropCoveredShare: config.ign.dropCoveredShare,
        droppedAsSameWaterAsAprhi: {
          total: ignDroppedTotal,
          largest: ignDropped,
        },
        remnantsDropped: ignParts,
        insideProvinceNotCoveredByAprhi: ignInsideProvince,
      },
      hydroLakes: {
        inOutline: hlCovered[0],
        addedTotals: hlSplit,
        addedByProvince: hlAddedWhere,
        added: hlAdded,
        largest: hlBig,
        remnantsDropped: hlParts,
      },
      overlapResolution: {
        higherPrecedenceCuts: overlapped.length,
        cutRemnantsDropped: overlapParts,
        polygons: overlapped,
        remainingOverlap: overlap,
      },
      nameFromIgnForAprhiLakes: {
        count: num(ignNamedCount?.n),
        largest: ignNamed,
      },
      mainWaters: hotspots,
      network: {
        rule: "level-12 HydroBASINS polygon of the point; connected when >= half of its reach km is connected (lib/water-network.ts)",
        polygons: num(netStats?.n),
        pointsOutsideEveryPolygon: outsideProvince,
        bySource: networkCounts,
      },
      outputsCheck: {
        outsideOutlineKm2: round(num(outside?.km2), 6),
      },
      lines: { pieces: pieceStats, reaches: reachStats },
      damCaveat: {
        $comment:
          "APRHI reservoirs of type Presa for the regulated-rivers caveat: polygon area (geodesic), Ano_inicio with 0 and -999 as null. Largest first.",
        count: damCaveat.length,
        reservoirs: damCaveat,
        notDams,
      },
      sha256: shas,
      previousSha256: previous,
      identicalToPreviousRun: identical,
      outputs: Object.values(files).map(rel),
    });
    if (!ok) throw new Error(`lakes checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

/** `lake_net (id, network)` for the polygons of `lk1`; returns the points outside every polygon. */
async function assignNetworkForLakes(
  db: Db,
  hybasFile: string,
  reachesFile: string,
): Promise<number> {
  await createHybasNetwork(db, hybasFile, reachesFile);
  return assignNetwork(db, "lk1", "ST_PointOnSurface(geom)", "lake_net");
}
