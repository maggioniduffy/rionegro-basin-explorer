/**
 * pipeline:ign-layers in reference mode (R3.6; regions/<id>/lakes.config.json). Used by
 * Córdoba. The decision of which water exists, its names and its precedence (APRHI > IGN >
 * HydroLAKES) is made by pipeline:lakes; this step publishes the tile inputs that
 * pipeline:tiles reads, with the same file names and properties as for nqn, and adds IGN's
 * dams and dam walls (APRHI has no dam point or wall layer).
 *
 * Outputs in data/work/<id>/tiles/:
 *  - ign_lakes.geojson       every water polygon of lakes/lakes.parquet (the `lakes` layer):
 *                            id, name, nameSource, kind, areaKm2, network, source
 *  - ign_lakes_extra.geojson empty: the extra-lake layer of nqn (IGN water HydroLAKES lacks)
 *                            does not exist here, IGN polygons are already in `lakes`
 *  - ign_detail.geojson      empty: the displayed lines (pipeline:lines) already include IGN
 *  - ign_dams.geojson, ign_dam_walls.geojson  IGN BH051 points and BI020 lines that touch the
 *                            region outline (points rejected by hand in ign-overrides.json,
 *                            keyed by IGN gid, are left out), with the `network` flag
 * and data/work/<id>/ign-layers/report.json.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { limitResources, lit, openDb } from "./duckdb";
import { IGN_ST_READ_OPTIONS, IGN_WATER_SHP, ALBERS, createNameMap } from "./ign";
import { requireInput } from "./inputs";
import { regionFile, rel, workPath } from "./paths";
import { writeReport } from "./report";
import { assignNetwork, createHybasNetwork } from "./water-network";
import type { LakesConfig } from "./water-pure";

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const plain = (g: string) => `ST_GeomFromWKB(ST_AsWKB(${g}))`;
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const toAlbers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;

/** A hand decision on an IGN dam point (BH051), keyed by its IGN `gid`. */
interface DamOverride {
  gid: number;
  action: "reject";
  note: string;
}

const KINDS = ["lake", "reservoir", "controlled-lake"];

export async function runIgnLayersReference(config: LakesConfig) {
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const overrides = JSON.parse(
    await readFile(regionFile("ign-overrides.json"), "utf8"),
  ) as { dams?: DamOverride[] };
  const rejectedGids = (overrides.dams ?? [])
    .filter((d) => d.action === "reject")
    .map((d) => d.gid);
  const outlineFile = requireInput(workPath("basin/basin.geojson"));
  const hybasFile = requireInput(workPath("basin/hybas_l12.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const lakesFile = requireInput(workPath("lakes/lakes.parquet"));
  const tilesDir = workPath("tiles");
  const outDir = workPath("ign-layers");
  await mkdir(tilesDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const targets = {
    ign_lakes: `${tilesDir}/ign_lakes.geojson`,
    ign_lakes_extra: `${tilesDir}/ign_lakes_extra.geojson`,
    ign_detail: `${tilesDir}/ign_detail.geojson`,
    ign_dams: `${tilesDir}/ign_dams.geojson`,
    ign_dam_walls: `${tilesDir}/ign_dam_walls.geojson`,
  };
  const previous: Record<string, string | null> = {};
  for (const [k, f] of Object.entries(targets))
    previous[k] = existsSync(f) ? await sha256(f) : null;

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  try {
    await db.conn.run(`
      CREATE TABLE outline AS
      SELECT ST_Union_Agg(${plain("geom")}) AS geom FROM ST_Read(${lit(outlineFile)})`);
    const net = await createHybasNetwork(db, hybasFile, reachesFile);

    // 1. Water polygons, as published by pipeline:lakes.
    log("water polygons…");
    await db.conn.run(`
      CREATE TABLE lakes AS
      SELECT id, name, name_source, kind, area_km2, network, source, layer, aprhi_type,
             year_start, ${plain("geom")} AS geom
      FROM read_parquet(${lit(lakesFile)})`);

    // 2. Dams: IGN points and wall lines that touch the outline.
    log("dams…");
    const read = (shp: string) =>
      `ST_Read(${lit(requireInput(shp))}, ${IGN_ST_READ_OPTIONS})`;
    await db.conn.run(`
      CREATE TABLE dam_pts_in AS
      SELECT gid::BIGINT AS gid, NULLIF(trim(fna), '') AS fna, geom
      FROM ${read(IGN_WATER_SHP.damPoints)}
      WHERE ST_Intersects(geom, (SELECT geom FROM outline))`);
    const rejectedList = `[${rejectedGids.map(Number).join(", ")}]::BIGINT[]`;
    await db.conn.run(`
      CREATE TABLE dam_pts_raw AS
      SELECT * FROM dam_pts_in WHERE NOT list_contains(${rejectedList}, gid)`);
    await createNameMap(db, "dam_pts_raw", "fna");
    await db.conn.run(`
      CREATE TABLE dams0 AS
      SELECT CAST(row_number() OVER (ORDER BY gid) AS INTEGER) AS id, gid, m.name, p.geom
      FROM dam_pts_raw p LEFT JOIN name_map m ON m.raw = p.fna`);
    await db.conn.run(`
      CREATE TABLE wall_raw AS
      SELECT gid::BIGINT AS gid, NULLIF(trim(fna), '') AS fna, geom
      FROM ${read(IGN_WATER_SHP.damWalls)}
      WHERE ST_Intersects(geom, (SELECT geom FROM outline))`);
    await createNameMap(db, "wall_raw", "fna");
    await db.conn.run(`
      CREATE TABLE walls0 AS
      SELECT CAST(row_number() OVER (ORDER BY gid) AS INTEGER) AS id, gid, m.name, w.geom
      FROM wall_raw w LEFT JOIN name_map m ON m.raw = w.fna`);
    const outsideDams = await assignNetwork(db, "dams0", "geom", "dams_net");
    const outsideWalls = await assignNetwork(
      db,
      "walls0",
      "ST_LineInterpolatePoint(geom, 0.5)",
      "walls_net",
    );
    await db.conn.run(`
      CREATE TABLE dams AS
      SELECT d.id, d.name, n.network, d.geom FROM dams0 d JOIN dams_net n USING (id)`);
    await db.conn.run(`
      CREATE TABLE walls AS
      SELECT w.id, w.name, n.network, w.geom FROM walls0 w JOIN walls_net n USING (id)`);

    // 3. GeoJSON for tippecanoe.
    log("writing…");
    const outputs: [keyof typeof targets, string, string][] = [
      [
        "ign_lakes",
        "id, name, name_source AS nameSource, kind, area_km2 AS areaKm2, network, source, geom",
        "lakes",
      ],
      ["ign_dams", "id, name, network, geom", "dams"],
      ["ign_dam_walls", "id, name, network, geom", "walls"],
    ];
    const sizes: Record<string, number> = {};
    for (const [file, cols, table] of outputs) {
      const target = targets[file];
      await rm(target, { force: true });
      await db.conn.run(`
        COPY (SELECT ${cols} FROM ${table} ORDER BY id) TO ${lit(target)}
        WITH (FORMAT gdal, DRIVER 'GeoJSON',
              LAYER_CREATION_OPTIONS 'COORDINATE_PRECISION=6')`);
    }
    for (const file of ["ign_lakes_extra", "ign_detail"] as const)
      await writeFile(
        targets[file],
        '{"type":"FeatureCollection","features":[]}\n',
      );
    const shas: Record<string, string> = {};
    for (const [k, f] of Object.entries(targets)) {
      sizes[rel(f)] = (await stat(f)).size;
      shas[k] = await sha256(f);
    }
    const identical = Object.values(previous).every((s) => s === null)
      ? null
      : Object.entries(previous).every(([k, s]) => s === shas[k]);

    // 4. Report and checks.
    const written = JSON.parse(
      await readFile(targets.ign_lakes, "utf8"),
    ) as { features: { properties: Record<string, unknown> }[] };
    const writtenIds = written.features.map((f) => String(f.properties.id));
    const [lakeCounts] = await db.all(`
      SELECT count(*)::INT AS n, count(DISTINCT id)::INT AS distinct_ids,
             count(*) FILTER (kind NOT IN (${KINDS.map(lit).join(", ")}))::INT AS bad_kind,
             count(*) FILTER (area_km2 IS NULL OR area_km2 <= 0)::INT AS no_area
      FROM lakes`);
    const lakeKinds = await db.all(`
      SELECT source, kind, network, count(*)::INT AS n, round(sum(area_km2), 1) AS km2,
             count(name)::INT AS named
      FROM lakes GROUP BY ALL ORDER BY ALL`);
    const [damCounts] = await db.all(`
      SELECT (SELECT count(*) FROM dams)::INT AS points,
             (SELECT count(*) FROM dam_pts_in)::INT - (SELECT count(*) FROM dam_pts_raw)::INT AS points_rejected,
             (SELECT count(name) FROM dams)::INT AS points_named,
             (SELECT count(*) FROM dams WHERE network = 'endorheic')::INT AS points_endorheic,
             (SELECT count(*) FROM walls)::INT AS walls,
             (SELECT count(name) FROM walls)::INT AS walls_named,
             (SELECT count(*) FROM walls WHERE network = 'endorheic')::INT AS walls_endorheic,
             (SELECT list(DISTINCT name ORDER BY name) FROM dams WHERE name IS NOT NULL) AS point_names,
             (SELECT list(DISTINCT name ORDER BY name) FROM walls WHERE name IS NOT NULL) AS wall_names`);
    // APRHI dam reservoirs: does an IGN dam point or wall lie within damMatchM of them?
    const damTypes = config.aprhi.reservoirs.damTypes.map(lit).join(", ");
    const marked = await db.all(`
      SELECT l.name, round(l.area_km2, 3) AS area_km2, l.year_start,
             round(least(
               coalesce((SELECT min(ST_Distance(${toAlbers("l.geom")}, ${toAlbers("d.geom")})) FROM dams d), 1e9),
               coalesce((SELECT min(ST_Distance(${toAlbers("l.geom")}, ${toAlbers("w.geom")})) FROM walls w), 1e9))) AS nearest_ign_dam_m
      FROM lakes l WHERE l.layer = 'emb' AND l.aprhi_type IN (${damTypes})
      ORDER BY l.area_km2 DESC`);
    const markedCount = marked.filter(
      (r) => num(r.nearest_ign_dam_m) <= config.damMatchM,
    ).length;

    const checks = {
      everyLakeWritten:
        writtenIds.length === num(lakeCounts?.n) &&
        new Set(writtenIds).size === writtenIds.length,
      lakeIdsUnique: num(lakeCounts?.n) === num(lakeCounts?.distinct_ids),
      lakeKindsKnown: num(lakeCounts?.bad_kind) === 0,
      lakeAreasPositive: num(lakeCounts?.no_area) === 0,
      // A stale override (gid no longer among the outline's IGN points) fails the step.
      everyDamRejectFound:
        num(damCounts?.points_rejected) === rejectedGids.length,
      emptyLayersAreEmpty: true,
      identicalToPreviousRun: identical !== false,
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("ign-layers", {
      ok,
      checks,
      mode: "reference",
      note: "Water polygons come from pipeline:lakes (APRHI > IGN > HydroLAKES); ign_lakes_extra and ign_detail are empty on purpose.",
      lakes: {
        polygons: num(lakeCounts?.n),
        bySourceKindNetwork: lakeKinds,
      },
      dams: {
        points: num(damCounts?.points),
        pointsNamed: num(damCounts?.points_named),
        pointsRejected: num(damCounts?.points_rejected),
        pointsEndorheic: num(damCounts?.points_endorheic),
        walls: num(damCounts?.walls),
        wallsNamed: num(damCounts?.walls_named),
        wallsEndorheic: num(damCounts?.walls_endorheic),
        pointNames: damCounts?.point_names,
        wallNames: damCounts?.wall_names,
        pointsOutsideEveryNetworkPolygon: outsideDams,
        wallsOutsideEveryNetworkPolygon: outsideWalls,
      },
      aprhiDamReservoirsMarkedByIgn: {
        $comment: `APRHI reservoirs of type ${config.aprhi.reservoirs.damTypes.join("/")} with an IGN dam point or wall within ${config.damMatchM} m of the polygon (nearest distance listed).`,
        marked: markedCount,
        of: marked.length,
        reservoirs: marked,
      },
      network: { polygons: net.polygons, fromReaches: net.fromReaches, fromEndoField: net.fromEndoField },
      geojsonBytes: sizes,
      sha256: shas,
      identicalToPreviousRun: identical,
      outputs: Object.keys(sizes),
    });
    if (!ok)
      throw new Error(`ign-layers checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}
