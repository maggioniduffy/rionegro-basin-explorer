/**
 * pipeline:subbasins, reference mode (R3.5): the sub-basin hierarchy of a region whose
 * management areas come from a reference agency (Córdoba: APRHI), not from HydroBASINS.
 *
 * Levels: 0 the region (the R3.1 outline), 1 the basins (the R3.1 roots, data/work/<r>/basin/
 * basins.geojson), 2 the subcuencas, 3 the unidades de gestión hídrica (UGH).
 *
 * 1. Ids. regions/<r>/subbasin-ids.json maps each source feature to a node id; created on the
 *    first run, then fixed (a feature without an id, or an id without a feature, fails).
 * 2. Parents by geometry, never by source code: a subcuenca belongs to the basin holding the
 *    largest share of its area, a UGH to the subcuenca holding the largest share. Each child is
 *    clipped to its parent. A node's own area is the node minus its children, so the salar,
 *    the lagoon and the parts of whole basins outside the province stay in the basin's own
 *    area. Areas are geodesic, from the polygons, never from the layers' area fields.
 * 3. Reaches (data/work/<r>/rivers/reaches.parquet): each keeps its R3.2 `root` (level 1).
 *    Within it, it goes to the subcuenca holding the largest share of its length (South
 *    America Albers) when that share reaches reachMinShare, then the same for the UGH within
 *    the subcuenca; otherwise it stays at the parent level.
 * 4. Metrics over the node and its descendants, as in the HydroBASINS mode (same formulas
 *    over RiverATLAS catchment attributes); endorheicAreaKm2 is the CATCH_SKM of the node's
 *    endorheic reaches.
 * 5. Outlet: none for the region; level 1 the root's expectedExitReach (basin.config.json);
 *    levels 2-3 the node's largest-UPLAND_SKM reach, kept only if at least outletMinShare of
 *    the node's stream km drain to it.
 *
 * Outputs: data/out/<r>/subbasins.ndjson, data/work/<r>/tiles/subbasins.geojson (own areas,
 * with each node's ancestor path), subbasin_outlines.geojson (whole areas), report.json and
 * data/work/<r>/subbasins/reach_node.parquet (HYRIV_ID -> the deepest node owning the reach;
 * read by pipeline:export to place streams).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { polygons, readOptions, source, wgs84, ident } from "./basin-reference";
import { lit, limitResources, openDb, type Row } from "./duckdb";
import { areaSpheroidKm2, pctDiff } from "./geo";
import { ALBERS } from "./ign";
import { requireInput } from "./inputs";
import { cleanName } from "./names";
import { OUT_DIR, rawPath, regionFile, rel, workPath } from "./paths";
import { writeReport } from "./report";
import {
  type IdCandidate,
  type IdsFile,
  type NameFix,
  assignByShare,
  chooseOutlet,
  compareCodePoints,
  depthFirst,
  fixName,
  generateIds,
  idsProblems,
  largestShare,
} from "./subbasins-reference-pure";
import { ancestorPath } from "./subbasins";

interface LayerConfig {
  path: string;
  srs: string;
  codeField: string;
  nameField: string;
  systemField?: string;
  layerName: string;
}

export interface ReferenceSubbasinsConfig {
  mode: "reference";
  region: { id: string; name: string };
  source: string;
  rootSlugs: Record<string, string>;
  subcuencaLayer: LayerConfig;
  ughLayer: LayerConfig & { systemField: string };
  nameFixes: NameFix[];
  counts: { level1: number; level2: number; level3: number };
  outletMinShare: number;
  reachMinShare: number;
}

interface RiverDoc {
  _id: string;
  mouthReach: number;
  mouth: { uplandKm2: number };
}

/** A node of the hierarchy, with everything the outputs need. */
interface RefNode {
  id: string;
  parentId: string | null;
  level: 0 | 1 | 2 | 3;
  /** Source key in the ids file ("" for the region). */
  key: string;
  name: string;
  /** Root code (level 1 and below). */
  rootCode: string | null;
}

/** Tolerances. */
const SLIVER_KM2 = 1;
/** Own areas + children must add up to the node this closely (percent). */
const PARTITION_PCT = 0.1;
/** Own areas below this (km²) are not drawn: slivers from clipping, not a pickable area. */
const MIN_TILE_OWN_KM2 = 0.01;
/** Parent shares and mismatches are listed for clipped-off areas above this (km²). */
const REPORT_CLIPPED_KM2 = SLIVER_KM2;
/** A parent holding less than this share of a child's area is flagged as weak. */
const WEAK_PARENT_SHARE = 0.5;

/**
 * Coverage of subcuencas and UGH per basin code (km²) from the inspection of 2026-10-12
 * (owner's brief), to compare with the clipped figures; informational, not a check.
 */
const INSPECTION_COVERAGE_KM2: Record<string, number> = {
  "01": 22297,
  "02": 49096,
  "03": 65534,
  "04": 14843,
  "05": 2451,
  "06": 2000,
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

const MODELED_LAND = [
  "nonPerennialPct",
  "floodedMinPct",
  "floodedMaxPct",
  "population",
];
const MODELED_OUTLET = ["outlet.dischargeM3s", "outlet.regulationPct"];

/** Provenance texts shared with the HydroBASINS mode (pipeline/steps/subbasins.ts). */
const COMMON_PROVENANCE = {
  lengthKm: "HydroRIVERS v1.0 LENGTH_KM, summed",
  nonPerennialPct:
    "GIRES v1.0 predcat1 = 1 (modeled, ≥ 1 no-flow day per year), share of lengthKm; reaches without a prediction are counted in unknownPct",
  elevationMinM:
    "Minimum of RiverATLAS v1.0 ele_mt_cmn over the reach catchments (EarthEnv-DEM90)",
  elevationMaxM:
    "Maximum of RiverATLAS v1.0 ele_mt_cmx over the reach catchments (EarthEnv-DEM90)",
  population:
    "RiverATLAS v1.0 pop_ct_csu × 1000, summed over the reach catchments; modeled 2010 estimate (GPWv4)",
  lakesPct:
    "RiverATLAS v1.0 lka_pc_cse / 10, mean over the reach catchments weighted by HydroRIVERS CATCH_SKM (HydroLAKES)",
  floodedMinPct:
    "RiverATLAS v1.0 inu_pc_cmn, mean over the reach catchments weighted by CATCH_SKM: mean annual minimum inundation extent, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  floodedMaxPct:
    "RiverATLAS v1.0 inu_pc_cmx, mean over the reach catchments weighted by CATCH_SKM: mean annual maximum inundation extent, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  "outlet.dischargeM3s":
    "HydroRIVERS v1.0 DIS_AV_CMS at the outlet reach; modeled natural long-term average 1971–2000 (WaterGAP), does not reflect dam regulation",
  "outlet.regulationPct":
    "RiverATLAS v1.0 dor_pc_pva / 10 at the outlet reach: degree of regulation from GRanD v1.1 dams",
};

function provenance(
  config: ReferenceSubbasinsConfig,
  level: number,
): Record<string, string> {
  const src = config.source;
  const areaByLevel: Record<number, string> = {
    0: `Geodesic area of the region outline of pipeline:basin (union of the six APRHI basins; FUENTE: ${src}; ${config.subcuencaLayer.layerName} and the basin layers are APRHI's)`,
    1: `Geodesic area of the APRHI basin polygon (Cuencas interprovinciales, whole or clipped to the province as in pipeline:basin; FUENTE: ${src}); includes the salar, the lagoon and, for whole basins, the parts outside the province`,
    2: `Geodesic area of the APRHI ${config.subcuencaLayer.layerName} polygon (FUENTE: ${src}), clipped to the basin holding the largest share of it`,
    3: `Geodesic area of the APRHI ${config.ughLayer.layerName} polygon (FUENTE: ${src}), clipped to the subcuenca holding the largest share of it`,
  };
  return {
    areaKm2: areaByLevel[level] as string,
    endorheicAreaKm2:
      "HydroRIVERS v1.0 CATCH_SKM, summed over the node's reaches with network = 'endorheic' (pipeline:rivers); reach catchments, not the APRHI polygon",
    reachCount:
      level === 1
        ? "HydroRIVERS v1.0 reaches of the root (pipeline:rivers)"
        : level === 0
          ? "HydroRIVERS v1.0 reaches of the region (pipeline:rivers)"
          : `HydroRIVERS v1.0 reaches assigned to the node: the one holding at least ${config.reachMinShare * 100}% of the reach's length, within the reach's root (South America Albers)`,
    ...COMMON_PROVENANCE,
    rivers: "Named rivers whose mouth reach is assigned to the node",
  };
}

/** Write and read tolerant JSON helper. */
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** Layer rows without geometry: id attributes of each source feature. */
async function layerAttributes(
  db: Awaited<ReturnType<typeof openDb>>,
  layer: LayerConfig,
) {
  const fields = [layer.codeField, layer.nameField, layer.systemField]
    .filter((f): f is string => f !== undefined)
    .map((f) => `${ident(f)}::VARCHAR AS ${ident(f)}`)
    .join(", ");
  return db.all(`
    SELECT OGC_FID::BIGINT AS fid, ${fields}, geom IS NULL AS no_geom
    FROM ST_Read(${source(layer.path)}${readOptions(undefined)})
    ORDER BY OGC_FID`);
}

export async function runReferenceSubbasins(
  config: ReferenceSubbasinsConfig,
): Promise<void> {
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const regionNode = config.region;
  const outDir = workPath("subbasins");
  const tilesDir = workPath("tiles");
  await mkdir(outDir, { recursive: true });
  await mkdir(tilesDir, { recursive: true });

  const basinsFile = requireInput(workPath("basin/basins.geojson"));
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const basinReportFile = requireInput(workPath("basin/report.json"));
  const rootsFile = requireInput(workPath("basin/roots.json"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const riversNdjson = requireInput(`${OUT_DIR}/rivers.ndjson`);
  const basinConfig = await readJson<{
    roots: { code: string; expectedExitReach: number | null }[];
  }>(regionFile("basin.config.json"));
  const rivers = (await readFile(riversNdjson, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RiverDoc);
  const idsFile = regionFile("subbasin-ids.json");

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  // One thread: the unions below must give byte-identical output on every run.
  await db.conn.run("SET threads=1");

  try {
    // 0. Source features.
    const scAttrs = await layerAttributes(db, config.subcuencaLayer);
    const ughAttrs = await layerAttributes(db, config.ughLayer);
    const scRows = scAttrs.filter((r) => !r.no_geom);
    const ughRows = ughAttrs.filter((r) => !r.no_geom);
    const droppedNoGeometry = [
      ...scAttrs
        .filter((r) => r.no_geom)
        .map((r) => ({ layer: "subcuencas", ...r })),
      ...ughAttrs.filter((r) => r.no_geom).map((r) => ({ layer: "ugh", ...r })),
    ];
    log(
      `${scRows.length} subcuencas, ${ughRows.length} UGH (${droppedNoGeometry.length} row(s) without geometry dropped)`,
    );
    const roots = await db.all(
      `SELECT code, name FROM ST_Read(${lit(basinsFile)}) ORDER BY code`,
    );

    // Source keys.
    const sc = scRows.map((r) => {
      const key = cleanName(str(r[config.subcuencaLayer.nameField]));
      if (key === null) throw new Error(`subcuenca fid ${r.fid} has no name`);
      return {
        fid: num(r.fid),
        key,
        code: str(r[config.subcuencaLayer.codeField]),
      };
    });
    const ugh = ughRows.map((r) => {
      const system = cleanName(str(r[config.ughLayer.systemField]) || null);
      const name = cleanName(str(r[config.ughLayer.nameField]));
      const key = system ?? name;
      if (key === null) throw new Error(`UGH fid ${r.fid} has no code or name`);
      return {
        fid: num(r.fid),
        key,
        system,
        name: name ?? key,
        code: cleanName(str(r[config.ughLayer.codeField])),
      };
    });
    for (const [label, keys] of [
      ["subcuenca", sc.map((s) => s.key)],
      ["UGH", ugh.map((u) => u.key)],
      ["basin", roots.map((r) => str(r.code))],
    ] as const) {
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dup.length > 0)
        throw new Error(`duplicate ${label} keys: ${dup.join(", ")}`);
    }

    // 1. Ids.
    const reserved = [regionNode.id];
    const sourceKeys = [
      ...roots.map((r) => ({ level: 1 as const, key: str(r.code) })),
      ...sc.map((s) => ({ level: 2 as const, key: s.key })),
      ...ugh.map((u) => ({ level: 3 as const, key: u.key })),
    ];
    let ids: IdsFile;
    let idsGenerated = false;
    let disambiguated: unknown[] = [];
    if (existsSync(idsFile)) {
      ids = await readJson<IdsFile>(idsFile);
    } else {
      const candidates: IdCandidate[] = [
        ...roots.map((r) => {
          const preset = config.rootSlugs[str(r.code)];
          if (preset === undefined)
            throw new Error(`rootSlugs has no slug for basin ${str(r.code)}`);
          return {
            level: 1 as const,
            key: str(r.code),
            basis: str(r.code),
            preset,
          };
        }),
        ...sc.map((s) => ({ level: 2 as const, key: s.key, basis: s.key })),
        ...ugh.map((u) => ({ level: 3 as const, key: u.key, basis: u.key })),
      ];
      const generated = generateIds(candidates, reserved);
      ids = {
        $comment:
          "Stable node ids of pipeline:subbasins in reference mode (R3.5), created once from regions/cba/subbasins.config.json (level 1: rootSlugs) and the source names, then fixed: level 1 is keyed by basin code, level 2 by the APRHI subcuenca name (whitespace cleaned, before nameFixes), level 3 by the UGH COD_SIST, or by its name where COD_SIST is null. Slugs come from pipeline/lib/names.ts slugify; one that was already taken got the level suffix (-subcuenca, -ugh), listed in the step's report.json (idsDisambiguated). The step fails when a source feature has no id here or an id here has no feature, so ids never change silently. To change an id on purpose, edit it here and say so in context/DECISSIONS.md; ids are the URL slugs of the sub-basins.",
        ...generated.ids,
      };
      disambiguated = generated.disambiguated;
      idsGenerated = true;
    }
    const problems = idsProblems(ids, sourceKeys, reserved);
    if (problems.length > 0)
      throw new Error(`subbasin-ids.json: ${problems.join("; ")}`);
    if (idsGenerated) {
      const sorted = (m: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(m).sort(([a], [b]) => compareCodePoints(a, b)),
        );
      await writeFile(
        idsFile,
        JSON.stringify(
          {
            $comment: ids.$comment,
            level1: sorted(ids.level1),
            level2: sorted(ids.level2),
            level3: sorted(ids.level3),
          },
          null,
          2,
        ) + "\n",
      );
      log(`wrote ${rel(idsFile)}`);
    }

    // Nodes (names fixed, ids known).
    const nameFixLog = new Map<
      string,
      { from: string; to: string; level: number }[]
    >();
    const display = (raw: string, level: number) => {
      const { name, applied } = fixName(raw, config.nameFixes);
      for (const a of applied) {
        const list = nameFixLog.get(a) ?? [];
        list.push({ from: raw, to: name, level });
        nameFixLog.set(a, list);
      }
      return name;
    };
    const nodes: RefNode[] = [
      {
        id: regionNode.id,
        parentId: null,
        level: 0,
        key: "",
        name: regionNode.name,
        rootCode: null,
      },
      ...roots.map((r) => ({
        id: ids.level1[str(r.code)] as string,
        parentId: regionNode.id,
        level: 1 as const,
        key: str(r.code),
        name: display(str(r.name), 1),
        rootCode: str(r.code),
      })),
    ];
    // Subcuenca and UGH parents are decided by geometry below; they are added then.

    // 2. Geometry tables.
    const layerSource = (l: LayerConfig) =>
      `ST_Read(${source(l.path)}${readOptions(undefined)})`;
    await db.conn.run(`
      CREATE TABLE roots AS
      SELECT code, geom FROM ST_Read(${lit(basinsFile)})`);
    await db.conn.run(`
      CREATE TABLE root_map (code VARCHAR, id VARCHAR)`);
    await db.conn.run(
      `INSERT INTO root_map VALUES ${roots
        .map(
          (r) =>
            `(${lit(str(r.code))}, ${lit(ids.level1[str(r.code)] as string)})`,
        )
        .join(",")}`,
    );
    await db.conn.run(
      `CREATE TABLE outline AS SELECT geom FROM ST_Read(${lit(basinFile)})`,
    );
    await db.conn.run(`
      CREATE TABLE sc_src AS
      SELECT OGC_FID::BIGINT AS fid, ${wgs84("geom", config.subcuencaLayer.srs)} AS geom
      FROM ${layerSource(config.subcuencaLayer)} WHERE geom IS NOT NULL`);
    await db.conn.run(`
      CREATE TABLE ugh_src AS
      SELECT OGC_FID::BIGINT AS fid, ${wgs84("geom", config.ughLayer.srs)} AS geom
      FROM ${layerSource(config.ughLayer)} WHERE geom IS NOT NULL`);
    log("layers read");

    // 2a. Subcuenca parents: the basin holding the largest share of the area.
    const scShareRows = await db.all(`
      SELECT s.fid, m.id AS parent, m.code,
             ${areaSpheroidKm2(polygons("ST_Intersection(s.geom, r.geom)"))} AS km2,
             ${areaSpheroidKm2("s.geom")} AS total
      FROM sc_src s JOIN roots r ON ST_Intersects(s.geom, r.geom)
      JOIN root_map m ON m.code = r.code
      ORDER BY s.fid, m.code`);
    const parentMismatches: unknown[] = [];
    const weakParents: unknown[] = [];
    const sharesByFid = (rows: Row[]) => {
      const out = new Map<
        number,
        { total: number; shares: Map<string, number>; km2: Map<string, number> }
      >();
      for (const r of rows) {
        const e = out.get(num(r.fid)) ?? {
          total: num(r.total),
          shares: new Map<string, number>(),
          km2: new Map<string, number>(),
        };
        e.shares.set(str(r.parent), num(r.km2) / num(r.total));
        e.km2.set(str(r.parent), num(r.km2));
        out.set(num(r.fid), e);
      }
      return out;
    };
    const scShares = sharesByFid(scShareRows);
    const rootIdToCode = new Map(
      roots.map((r) => [ids.level1[str(r.code)] as string, str(r.code)]),
    );
    const scNodes: (RefNode & { fid: number })[] = [];
    for (const s of sc) {
      const e = scShares.get(s.fid);
      const best = e ? largestShare(e.shares) : null;
      if (!e || !best)
        throw new Error(`subcuenca "${s.key}" overlaps no basin`);
      const parentCode = rootIdToCode.get(best.key) as string;
      const breakdown = [...e.shares]
        .sort((a, b) => b[1] - a[1])
        .map(([id, share]) => ({
          basin: rootIdToCode.get(id),
          sharePct: r2(share * 100),
          km2: r1(e.km2.get(id) ?? 0),
        }));
      if (parentCode !== s.code)
        parentMismatches.push({
          level: 2,
          key: s.key,
          sourceCode: s.code,
          geometricParent: parentCode,
          shares: breakdown,
        });
      if (best.share < WEAK_PARENT_SHARE)
        weakParents.push({ level: 2, key: s.key, shares: breakdown });
      scNodes.push({
        id: ids.level2[s.key] as string,
        parentId: best.key,
        level: 2,
        key: s.key,
        name: display(s.key, 2),
        rootCode: parentCode,
        fid: s.fid,
      });
    }
    await db.conn.run(
      `CREATE TABLE sc_map (fid BIGINT, id VARCHAR, parent VARCHAR)`,
    );
    await db.conn.run(
      `INSERT INTO sc_map VALUES ${scNodes
        .map((n) => `(${n.fid}, ${lit(n.id)}, ${lit(n.parentId as string)})`)
        .join(",")}`,
    );
    await db.conn.run(`
      CREATE TABLE sc_clip AS
      SELECT m.id, m.parent, ${polygons("ST_Intersection(s.geom, r.geom)")} AS geom,
             ${areaSpheroidKm2("s.geom")} AS full_km2
      FROM sc_src s JOIN sc_map m USING (fid)
      JOIN root_map rm ON rm.id = m.parent JOIN roots r ON r.code = rm.code`);
    log("subcuencas clipped");

    // 2b. UGH parents: the (clipped) subcuenca holding the largest share.
    const ughShareRows = await db.all(`
      SELECT u.fid, c.id AS parent,
             ${areaSpheroidKm2(polygons("ST_Intersection(u.geom, c.geom)"))} AS km2,
             ${areaSpheroidKm2("u.geom")} AS total
      FROM ugh_src u JOIN sc_clip c ON ST_Intersects(u.geom, c.geom)
      ORDER BY u.fid, c.id`);
    const ughShares = sharesByFid(ughShareRows);
    const scById = new Map(scNodes.map((n) => [n.id, n]));
    const ughNodes: (RefNode & { fid: number })[] = [];
    for (const u of ugh) {
      const e = ughShares.get(u.fid);
      const best = e ? largestShare(e.shares) : null;
      if (!e || !best) throw new Error(`UGH "${u.key}" overlaps no subcuenca`);
      const parent = scById.get(best.key) as RefNode;
      const breakdown = [...e.shares]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, share]) => ({
          subcuenca: scById.get(id)?.name,
          sharePct: r2(share * 100),
          km2: r1(e.km2.get(id) ?? 0),
        }));
      if (u.code === null || parent.rootCode !== u.code)
        parentMismatches.push({
          level: 3,
          key: u.key,
          name: u.name,
          sourceCode: u.code,
          sourceSystem: u.system,
          geometricParent: parent.name,
          geometricBasin: parent.rootCode,
          shares: breakdown,
        });
      if (best.share < WEAK_PARENT_SHARE)
        weakParents.push({ level: 3, key: u.key, shares: breakdown });
      ughNodes.push({
        id: ids.level3[u.key] as string,
        parentId: best.key,
        level: 3,
        key: u.key,
        name: display(u.name, 3),
        rootCode: parent.rootCode,
        fid: u.fid,
      });
    }
    await db.conn.run(
      `CREATE TABLE ugh_map (fid BIGINT, id VARCHAR, parent VARCHAR)`,
    );
    await db.conn.run(
      `INSERT INTO ugh_map VALUES ${ughNodes
        .map((n) => `(${n.fid}, ${lit(n.id)}, ${lit(n.parentId as string)})`)
        .join(",")}`,
    );
    await db.conn.run(`
      CREATE TABLE ugh_clip AS
      SELECT m.id, m.parent, ${polygons("ST_Intersection(u.geom, c.geom)")} AS geom,
             ${areaSpheroidKm2("u.geom")} AS full_km2
      FROM ugh_src u JOIN ugh_map m USING (fid) JOIN sc_clip c ON c.id = m.parent`);
    log("UGH clipped");

    // Hierarchy in depth-first order.
    const allNodes = depthFirst<RefNode>([
      ...nodes,
      ...scNodes,
      ...ughNodes,
    ] as RefNode[]);
    const nodeById = new Map(allNodes.map((n) => [n.id, n]));
    const childIdsOf = (id: string) =>
      allNodes.filter((n) => n.parentId === id).map((n) => n.id);
    const pathOf = (id: string) => ancestorPath(allNodes, id);

    // Node geometries.
    await db.conn.run(
      `CREATE TABLE nodes (id VARCHAR, parent VARCHAR, level INT, geom GEOMETRY)`,
    );
    await db.conn.run(`
      INSERT INTO nodes SELECT ${lit(regionNode.id)}, NULL, 0, geom FROM outline`);
    await db.conn.run(`
      INSERT INTO nodes SELECT m.id, ${lit(regionNode.id)}, 1, r.geom
      FROM roots r JOIN root_map m USING (code)`);
    await db.conn.run(
      `INSERT INTO nodes SELECT id, parent, 2, geom FROM sc_clip`,
    );
    await db.conn.run(
      `INSERT INTO nodes SELECT id, parent, 3, geom FROM ugh_clip`,
    );
    await db.conn.run(`
      CREATE TABLE own_geom AS
      SELECT n.id, n.level,
             CASE WHEN c.geom IS NULL THEN n.geom
                  ELSE ${polygons("ST_Difference(n.geom, c.geom)")} END AS geom
      FROM nodes n
      LEFT JOIN (SELECT parent AS id, ST_Union_Agg(geom) AS geom FROM nodes
                 WHERE parent IS NOT NULL GROUP BY parent) c USING (id)`);

    // 2c. Geometry checks.
    const nodeAreas = new Map(
      (
        await db.all(`SELECT id, ${areaSpheroidKm2("geom")} AS km2 FROM nodes`)
      ).map((r) => [str(r.id), num(r.km2)]),
    );
    const ownAreas = new Map(
      (
        await db.all(
          `SELECT id, ${areaSpheroidKm2("geom")} AS km2 FROM own_geom`,
        )
      ).map((r) => [str(r.id), num(r.km2)]),
    );
    const outsideParent = await db.all(`
      SELECT n.id, ${areaSpheroidKm2(polygons("ST_Difference(n.geom, p.geom)"))} AS km2
      FROM nodes n JOIN nodes p ON p.id = n.parent
      ORDER BY km2 DESC LIMIT 5`);
    const overlaps = await db.all(`
      SELECT a.id AS a, b.id AS b, a.parent,
             ${areaSpheroidKm2(polygons("ST_Intersection(a.geom, b.geom)"))} AS km2
      FROM nodes a JOIN nodes b ON a.parent = b.parent AND a.id < b.id
      AND ST_Intersects(a.geom, b.geom)
      ORDER BY km2 DESC`);
    const clippedOff = [
      ...(await db.all(`SELECT id, 2 AS level, full_km2 FROM sc_clip`)),
      ...(await db.all(`SELECT id, 3 AS level, full_km2 FROM ugh_clip`)),
    ]
      .map((r) => {
        const id = str(r.id);
        const full = num(r.full_km2);
        return {
          id,
          level: num(r.level),
          name: nodeById.get(id)?.name,
          parent: nodeById.get(id)?.parentId,
          fullKm2: r1(full),
          clippedOffKm2: r1(full - (nodeAreas.get(id) ?? 0)),
        };
      })
      .filter((c) => c.clippedOffKm2 > REPORT_CLIPPED_KM2)
      .sort((a, b) => b.clippedOffKm2 - a.clippedOffKm2);

    const partitionRows = allNodes.map((n) => {
      const kids = childIdsOf(n.id);
      const childSum = kids.reduce((s, k) => s + (nodeAreas.get(k) ?? 0), 0);
      const own = ownAreas.get(n.id) ?? 0;
      const area = nodeAreas.get(n.id) ?? 0;
      return {
        id: n.id,
        level: n.level,
        areaKm2: r1(area),
        ownKm2: r1(own),
        childrenKm2: r1(childSum),
        diffPct: pctDiff(own + childSum, area),
      };
    });
    const ownSum = [...ownAreas.values()].reduce((s, v) => s + v, 0);
    const regionArea = nodeAreas.get(regionNode.id) as number;
    const basinReport = await readJson<{
      outline: { areaSpheroidKm2: number };
    }>(basinReportFile);
    const rootsReport =
      await readJson<{ code: string; areaKm2: number }[]>(rootsFile);

    // Coverage per basin code.
    const coverage = roots.map((r) => {
      const code = str(r.code);
      const sum = (level: number) =>
        allNodes
          .filter((n) => n.level === level && n.rootCode === code)
          .reduce((s, n) => s + (nodeAreas.get(n.id) ?? 0), 0);
      const sc2 = sum(2);
      const ug3 = sum(3);
      const expected = INSPECTION_COVERAGE_KM2[code] ?? null;
      return {
        code,
        basinKm2: r1(nodeAreas.get(ids.level1[code] as string) ?? 0),
        subcuencasKm2: r1(sc2),
        ughKm2: r1(ug3),
        inspectionKm2: expected,
        subcuencasVsInspectionKm2:
          expected === null ? null : r1(sc2 - expected),
        ughVsInspectionKm2: expected === null ? null : r1(ug3 - expected),
      };
    });

    // 3. Reaches.
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT r.HYRIV_ID, r.NEXT_DOWN, r.root, r.network, r.LENGTH_KM, r.CATCH_SKM,
             r.UPLAND_SKM, r.DIS_AV_CMS, r.predcat1, r.geom,
             ST_Transform(r.geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS galb,
             a.pop_ct_csu, a.lka_pc_cse, a.inu_pc_cmn, a.inu_pc_cmx,
             a.ele_mt_cmn, a.ele_mt_cmx, a.dor_pc_pva
      FROM read_parquet(${lit(reachesFile)}) r
      JOIN read_parquet(${lit(atlasFile)}) a USING (HYRIV_ID)`);
    await db.conn.run(
      `CREATE TABLE reach_len AS SELECT HYRIV_ID, ST_Length(galb) AS len_m FROM reaches`,
    );
    await db.conn.run(`
      CREATE TABLE sc_alb AS
      SELECT id, parent, ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom
      FROM sc_clip`);
    await db.conn.run(`
      CREATE TABLE ugh_alb AS
      SELECT id, parent, ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom
      FROM ugh_clip`);
    const [reachCounts] = await db.all(`
      SELECT (SELECT count(*) FROM read_parquet(${lit(reachesFile)}))::INT AS parquet_rows,
             count(*)::INT AS joined, count(DISTINCT HYRIV_ID)::INT AS distinct_ids FROM reaches`);

    const groupShares = (rows: Row[]) => {
      const out = new Map<number, Map<string, number>>();
      for (const r of rows) {
        const m = out.get(num(r.rid)) ?? new Map<string, number>();
        m.set(str(r.node), num(r.share));
        out.set(num(r.rid), m);
      }
      return out;
    };
    const reachInfo = new Map(
      (
        await db.all(
          `SELECT HYRIV_ID, root, NEXT_DOWN, UPLAND_SKM, LENGTH_KM FROM reaches ORDER BY HYRIV_ID`,
        )
      ).map((r) => [
        num(r.HYRIV_ID),
        {
          root: str(r.root),
          nextDown: num(r.NEXT_DOWN),
          upland: num(r.UPLAND_SKM),
          lengthKm: num(r.LENGTH_KM),
        },
      ]),
    );
    const scReachShares = groupShares(
      await db.all(
        `SELECT r.HYRIV_ID AS rid, p.id AS node,
                coalesce(ST_Length(ST_CollectionExtract(ST_Intersection(r.galb, p.geom), 2)), 0)
                  / l.len_m AS share
         FROM reaches r JOIN reach_len l USING (HYRIV_ID)
         JOIN sc_alb p ON ST_Intersects(r.galb, p.geom)`,
      ),
    );
    log("reach shares vs subcuencas");

    const owner = new Map<number, string>();
    const crossRoot: {
      reach: number;
      root: string;
      subcuenca: string;
      basin: string;
      sharePct: number;
      lengthKm: number;
    }[] = [];
    const scOwnerRows: [number, string][] = [];
    for (const [rid, info] of [...reachInfo].sort((a, b) => a[0] - b[0])) {
      const all = scReachShares.get(rid) ?? new Map<string, number>();
      const sameRoot = new Map(
        [...all].filter(([id]) => scById.get(id)?.rootCode === info.root),
      );
      const rootId = ids.level1[info.root] as string;
      const pick = assignByShare(sameRoot, config.reachMinShare);
      owner.set(rid, pick ? pick.key : rootId);
      if (pick) scOwnerRows.push([rid, pick.key]);
      const best = largestShare(all);
      if (
        best &&
        best.share >= config.reachMinShare &&
        scById.get(best.key)?.rootCode !== info.root
      )
        crossRoot.push({
          reach: rid,
          root: info.root,
          subcuenca: best.key,
          basin: scById.get(best.key)?.rootCode ?? "",
          sharePct: r1(best.share * 100),
          lengthKm: info.lengthKm,
        });
    }
    await db.conn.run(`CREATE TABLE reach_sc_owner (rid INTEGER, sc VARCHAR)`);
    for (let i = 0; i < scOwnerRows.length; i += 4000)
      await db.conn.run(
        `INSERT INTO reach_sc_owner VALUES ${scOwnerRows
          .slice(i, i + 4000)
          .map(([rid, id]) => `(${rid}, ${lit(id)})`)
          .join(",")}`,
      );
    const ughReachShares = groupShares(
      await db.all(
        `SELECT r.HYRIV_ID AS rid, p.id AS node,
                coalesce(ST_Length(ST_CollectionExtract(ST_Intersection(r.galb, p.geom), 2)), 0)
                  / l.len_m AS share
         FROM reaches r JOIN reach_len l USING (HYRIV_ID)
         JOIN reach_sc_owner o ON o.rid = r.HYRIV_ID
         JOIN ugh_alb p ON p.parent = o.sc AND ST_Intersects(r.galb, p.geom)`,
      ),
    );
    log("reach shares vs UGH");
    for (const [rid] of [...reachInfo].sort((a, b) => a[0] - b[0])) {
      const sc2 = owner.get(rid) as string;
      if (nodeById.get(sc2)?.level !== 2) continue;
      const pick = assignByShare(
        ughReachShares.get(rid) ?? new Map(),
        config.reachMinShare,
      );
      if (pick) owner.set(rid, pick.key);
    }

    // Membership: every reach in its owner and every ancestor.
    const membersOf = new Map<string, number[]>(
      allNodes.map((n) => [n.id, []]),
    );
    const membershipRows: [number, string][] = [];
    for (const [rid, id] of [...owner].sort((a, b) => a[0] - b[0])) {
      for (const anc of pathOf(id)) {
        (membersOf.get(anc) as number[]).push(rid);
        membershipRows.push([rid, anc]);
      }
    }
    await db.conn.run(`CREATE TABLE membership (rid INTEGER, node VARCHAR)`);
    for (let i = 0; i < membershipRows.length; i += 4000)
      await db.conn.run(
        `INSERT INTO membership VALUES ${membershipRows
          .slice(i, i + 4000)
          .map(([rid, id]) => `(${rid}, ${lit(id)})`)
          .join(",")}`,
      );

    // The deepest node of every reach, for pipeline:export (R3.7): where a stream's mouth
    // reach lies.
    await db.conn.run(
      `CREATE TABLE reach_owner (HYRIV_ID INTEGER, node VARCHAR)`,
    );
    const ownerRows = [...owner].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < ownerRows.length; i += 4000)
      await db.conn.run(
        `INSERT INTO reach_owner VALUES ${ownerRows
          .slice(i, i + 4000)
          .map(([rid, id]) => `(${rid}, ${lit(id)})`)
          .join(",")}`,
      );
    const reachNodeFile = workPath("subbasins/reach_node.parquet");
    await db.conn.run(
      `COPY (SELECT * FROM reach_owner ORDER BY HYRIV_ID) TO ${lit(reachNodeFile)} (FORMAT parquet)`,
    );

    const byLevel = [0, 1, 2, 3].map((level) => {
      const own = [...owner].filter(
        ([, id]) => nodeById.get(id)?.level === level,
      );
      return {
        level,
        reaches: own.length,
        km: r1(
          own.reduce((s, [rid]) => s + (reachInfo.get(rid)?.lengthKm ?? 0), 0),
        ),
      };
    });
    const rootKept = [...owner].every(
      ([rid, id]) =>
        pathOf(id)[1] === ids.level1[reachInfo.get(rid)?.root ?? ""],
    );

    // 4. Metrics.
    const aggregate = new Map(
      (
        await db.all(`
          SELECT m.node, count(*)::INT AS reaches, sum(r.LENGTH_KM) AS km,
                 sum(CASE WHEN r.network = 'endorheic' THEN r.LENGTH_KM ELSE 0 END) AS endo_km,
                 sum(CASE WHEN r.network = 'endorheic' THEN r.CATCH_SKM ELSE 0 END) AS endo_catch_km2,
                 sum(CASE WHEN r.predcat1 = 1 THEN r.LENGTH_KM ELSE 0 END) AS nonperennial_km,
                 sum(CASE WHEN r.predcat1 IS NULL THEN r.LENGTH_KM ELSE 0 END) AS unknown_km,
                 sum(r.pop_ct_csu) * 1000 AS population,
                 sum(r.lka_pc_cse / 10.0 * r.CATCH_SKM) / sum(r.CATCH_SKM) AS lakes_pct,
                 sum(r.inu_pc_cmn * r.CATCH_SKM) / sum(r.CATCH_SKM) AS flooded_min_pct,
                 sum(r.inu_pc_cmx * r.CATCH_SKM) / sum(r.CATCH_SKM) AS flooded_max_pct,
                 min(r.ele_mt_cmn) AS ele_min, max(r.ele_mt_cmx) AS ele_max
          FROM reaches r JOIN membership m ON m.rid = r.HYRIV_ID
          GROUP BY m.node`)
      ).map((r) => [str(r.node), r]),
    );
    const bboxes = new Map(
      (
        await db.all(`
          SELECT id, [round(ST_XMin(geom), 5), round(ST_YMin(geom), 5),
                      round(ST_XMax(geom), 5), round(ST_YMax(geom), 5)] AS bbox
          FROM nodes`)
      ).map((r) => [str(r.id), r.bbox]),
    );

    // 5. Outlets.
    const exitOf = new Map(
      basinConfig.roots.map((r) => [r.code, r.expectedExitReach]),
    );
    const outletReport: unknown[] = [];
    const outletOf = new Map<string, number>();
    const outletProblems: string[] = [];
    for (const n of allNodes) {
      if (n.level === 0) continue;
      const members = membersOf.get(n.id) as number[];
      const reaches = members.map((rid) => {
        const info = reachInfo.get(rid) as NonNullable<
          ReturnType<typeof reachInfo.get>
        >;
        return {
          id: rid,
          nextDown: info.nextDown,
          upland: info.upland,
          lengthKm: info.lengthKm,
        };
      });
      const expected = n.level === 1 ? (exitOf.get(n.key) ?? null) : null;
      if (n.level === 1 && expected !== null && !members.includes(expected))
        outletProblems.push(
          `${n.id}: expectedExitReach ${expected} is not in the root`,
        );
      const choice =
        n.level === 1 && expected !== null && members.includes(expected)
          ? chooseOutlet(reaches, 0, expected)
          : chooseOutlet(reaches, config.outletMinShare);
      const fromConfig = n.level === 1 && expected !== null;
      const kept = fromConfig || choice.kept;
      if (kept && choice.reachId !== null) outletOf.set(n.id, choice.reachId);
      outletReport.push({
        id: n.id,
        level: n.level,
        name: n.name,
        source: fromConfig ? "expectedExitReach" : "largestUpland",
        reach: choice.reachId,
        sharePct: r1(choice.share * 100),
        upstreamReaches: choice.upstreamReaches,
        reaches: reaches.length,
        kept,
      });
    }
    const outletRows = new Map(
      outletOf.size === 0
        ? []
        : (
            await db.all(`
              SELECT HYRIV_ID, DIS_AV_CMS, dor_pc_pva,
                     ST_X(ST_EndPoint(geom)) AS lon, ST_Y(ST_EndPoint(geom)) AS lat
              FROM reaches WHERE HYRIV_ID IN (${[...new Set(outletOf.values())].join(",")})`)
          ).map((r) => [num(r.HYRIV_ID), r]),
    );

    // Docs.
    const mouthNode = (r: RiverDoc) => owner.get(r.mouthReach);
    const docs: Record<string, unknown>[] = [];
    const emptyNodes: string[] = [];
    for (const n of allNodes) {
      const a = aggregate.get(n.id);
      if (!a) {
        emptyNodes.push(n.id);
        continue;
      }
      const km = num(a.km);
      const outletReach = outletOf.get(n.id);
      const o = outletReach === undefined ? null : outletRows.get(outletReach);
      docs.push({
        _id: n.id,
        kind: "area",
        name: n.name,
        level: n.level,
        parentId: n.parentId,
        path: pathOf(n.id),
        childIds: childIdsOf(n.id),
        river: null,
        areaKm2: Math.round(nodeAreas.get(n.id) ?? 0),
        endorheicAreaKm2: Math.round(num(a.endo_catch_km2)),
        reachCount: num(a.reaches),
        lengthKm: r1(km),
        endorheicLengthKm: r1(num(a.endo_km)),
        nonPerennialPct: r1((num(a.nonperennial_km) / km) * 100),
        unknownPct: r1((num(a.unknown_km) / km) * 100),
        elevationMinM: num(a.ele_min),
        elevationMaxM: num(a.ele_max),
        population: Math.round(num(a.population)),
        lakesPct: r1(num(a.lakes_pct)),
        floodedMinPct: r1(num(a.flooded_min_pct)),
        floodedMaxPct: r1(num(a.flooded_max_pct)),
        outlet: o
          ? {
              hyrivId: num(o.HYRIV_ID),
              lat: num(o.lat),
              lon: num(o.lon),
              dischargeM3s: r1(num(o.DIS_AV_CMS)),
              regulationPct: r1(num(o.dor_pc_pva) / 10),
            }
          : null,
        rivers: rivers
          .filter((r) => {
            const id = mouthNode(r);
            return id !== undefined && pathOf(id).includes(n.id);
          })
          .sort((x, y) => y.mouth.uplandKm2 - x.mouth.uplandKm2)
          .map((r) => r._id),
        bbox: bboxes.get(n.id),
        modeled: o ? [...MODELED_OUTLET, ...MODELED_LAND] : MODELED_LAND,
        provenance: provenance(config, n.level),
      });
    }
    const docById = new Map(docs.map((d) => [str(d._id), d]));

    // Outputs.
    const ndjson = `${OUT_DIR}/subbasins.ndjson`;
    const ndjsonText = docs.map((d) => JSON.stringify(d)).join("\n") + "\n";
    const geojson = `${tilesDir}/subbasins.geojson`;
    const outlines = `${tilesDir}/subbasin_outlines.geojson`;
    const ownRows = await db.all(
      `SELECT id, ST_AsGeoJSON(geom) AS g FROM own_geom
       WHERE NOT ST_IsEmpty(geom) AND ${areaSpheroidKm2("geom")} >= ${MIN_TILE_OWN_KM2} ORDER BY id`,
    );
    const droppedOwn = [...ownAreas]
      .filter(([, km2]) => km2 < MIN_TILE_OWN_KM2)
      .map(([id, km2]) => ({ id, km2: Math.round(km2 * 1e6) / 1e6 }));
    const geojsonText = JSON.stringify({
      type: "FeatureCollection",
      features: ownRows.map((f) => {
        const node = nodeById.get(str(f.id)) as RefNode;
        return {
          type: "Feature",
          properties: {
            id: f.id,
            kind: "area",
            level: node.level,
            // ",cordoba,carcarana," — the map matches a whole subtree with one substring
            // test (vector tiles cannot hold arrays).
            path: `,${pathOf(node.id).join(",")},`,
          },
          geometry: JSON.parse(str(f.g)),
        };
      }),
    });
    const outlineRows = await db.all(
      `SELECT id, ST_AsGeoJSON(geom) AS g FROM nodes ORDER BY id`,
    );
    const outlinesText = JSON.stringify({
      type: "FeatureCollection",
      features: outlineRows.map((f) => ({
        type: "Feature",
        properties: { id: f.id, level: nodeById.get(str(f.id))?.level },
        geometry: JSON.parse(str(f.g)),
      })),
    });

    // Repeatability: same inputs and code must give the same bytes as the previous run.
    const inputFiles = [
      basinsFile,
      basinFile,
      reachesFile,
      atlasFile,
      riversNdjson,
      rawPath(config.subcuencaLayer.path),
      rawPath(config.ughLayer.path),
      regionFile("basin.config.json"),
    ];
    const fingerprint = sha256(
      JSON.stringify({
        config,
        ids,
        code: [
          sha256(await readFile(new URL(import.meta.url))),
          sha256(
            await readFile(
              new URL("./subbasins-reference-pure.ts", import.meta.url),
            ),
          ),
        ],
        inputs: await Promise.all(
          inputFiles.map(async (f) => {
            const s = await stat(f);
            return [rel(f), s.size, Math.round(s.mtimeMs)];
          }),
        ),
      }),
    );
    const hashes = {
      ndjson: sha256(ndjsonText),
      tiles: sha256(geojsonText),
      outlines: sha256(outlinesText),
    };
    const previous = await readJson<{
      fingerprint?: string;
      outputsSha256?: typeof hashes;
    }>(workPath("subbasins/report.json")).catch(() => null);
    const comparable =
      previous?.fingerprint === fingerprint &&
      previous.outputsSha256 !== undefined;
    const identical =
      comparable &&
      JSON.stringify(previous?.outputsSha256) === JSON.stringify(hashes);

    await writeFile(ndjson, ndjsonText);
    await writeFile(geojson, geojsonText);
    await writeFile(outlines, outlinesText);

    // Checks.
    const levelCounts = [0, 1, 2, 3].map(
      (l) => allNodes.filter((n) => n.level === l).length,
    );
    const expectedCounts = [
      1,
      config.counts.level1,
      config.counts.level2,
      config.counts.level3,
    ];
    const outsideMax = Math.max(0, ...outsideParent.map((o) => num(o.km2)));
    const overlapMax = Math.max(0, ...overlaps.map((o) => num(o.km2)));
    const partitionOk = partitionRows.every(
      (p) => Math.abs(p.diffPct) <= PARTITION_PCT,
    );
    const docsHave = (
      f: (d: Record<string, unknown>, p: Record<string, unknown>) => boolean,
    ) =>
      docs.every((d) => {
        const p = docById.get(str(d.parentId));
        return !p || f(d, p);
      });
    const checks = {
      idsMatchFeatures: problems.length === 0,
      idsUnique: new Set(allNodes.map((n) => n.id)).size === allNodes.length,
      nodeCountsMatchConfig:
        JSON.stringify(levelCounts) === JSON.stringify(expectedCounts) &&
        allNodes.length === expectedCounts.reduce((s, v) => s + v, 0),
      everyChildWithinParent: outsideMax <= SLIVER_KM2,
      siblingsDoNotOverlap: overlapMax <= SLIVER_KM2,
      ownPlusChildrenEqualNode: partitionOk,
      ownAreasSumToRegion:
        Math.abs(pctDiff(ownSum, regionArea)) <= PARTITION_PCT,
      regionAreaMatchesOutline:
        Math.abs(pctDiff(regionArea, basinReport.outline.areaSpheroidKm2)) <=
        PARTITION_PCT,
      basinAreasMatchRoots: rootsReport.every((r) => {
        const area = nodeAreas.get(ids.level1[r.code] as string);
        return (
          area !== undefined &&
          Math.abs(pctDiff(area, r.areaKm2)) <= PARTITION_PCT
        );
      }),
      everyReachInExactlyOneNode:
        owner.size === num(reachCounts?.parquet_rows) &&
        num(reachCounts?.joined) === num(reachCounts?.parquet_rows) &&
        num(reachCounts?.distinct_ids) === num(reachCounts?.joined),
      reachRootsKept: rootKept,
      everyNodeHasReaches: emptyNodes.length === 0,
      outletsBelongToNodes: outletProblems.length === 0,
      childMetricsWithinParent: docsHave(
        (d, p) =>
          num(d.areaKm2) <= num(p.areaKm2) + 1 &&
          num(d.reachCount) <= num(p.reachCount) &&
          num(d.lengthKm) <= num(p.lengthKm) + 0.05 &&
          num(d.population) <= num(p.population),
      ),
      outputsRepeatable: !comparable || identical,
    };
    const ok = Object.values(checks).every(Boolean);
    const nodesReport = allNodes.map((n) => ({
      id: n.id,
      level: n.level,
      name: n.name,
      parent: n.parentId,
      areaKm2: r1(nodeAreas.get(n.id) ?? 0),
      ownKm2: r1(ownAreas.get(n.id) ?? 0),
      reaches: membersOf.get(n.id)?.length ?? 0,
    }));
    await writeReport("subbasins", {
      ok,
      mode: "reference",
      checks,
      fingerprint,
      outputsSha256: hashes,
      previousRun: comparable
        ? { identical }
        : "inputs or code changed, or first run",
      counts: { byLevel: levelCounts, total: allNodes.length },
      ids: {
        file: rel(idsFile),
        generatedThisRun: idsGenerated,
        idsDisambiguated: disambiguated,
        problems,
      },
      sourceFeatures: {
        subcuencas: scRows.length,
        ugh: ughRows.length,
        droppedNoGeometry,
      },
      nameFixes: Object.fromEntries(nameFixLog),
      parentByGeometry: {
        codeMismatches: parentMismatches,
        weakParents,
        clippedOffOver1Km2: clippedOff,
      },
      areaKm2: {
        region: r1(regionArea),
        outlineInBasinReport: basinReport.outline.areaSpheroidKm2,
        ownSum: r1(ownSum),
        ownSumDiffPct: pctDiff(ownSum, regionArea),
        maxOutsideParent: r2(outsideMax),
        maxSiblingOverlap: r2(overlapMax),
        siblingOverlaps: overlaps.filter((o) => num(o.km2) > 0.01).slice(0, 20),
        coverage,
        partition: partitionRows,
        ownAreasDroppedFromTiles: droppedOwn,
      },
      reaches: {
        total: owner.size,
        byOwnerLevel: byLevel,
        mostlyInAnotherRootsSubcuenca: {
          count: crossRoot.length,
          km: r1(crossRoot.reduce((s, c) => s + c.lengthKm, 0)),
          largest: crossRoot
            .sort((a, b) => b.lengthKm - a.lengthKm)
            .slice(0, 15),
        },
        emptyNodes,
      },
      outlets: {
        minShare: config.outletMinShare,
        problems: outletProblems,
        kept: outletReport.filter((o) => (o as { kept: boolean }).kept).length,
        nodes: outletReport,
      },
      nodes: nodesReport,
      outputs: [rel(ndjson), rel(geojson), rel(outlines), rel(reachNodeFile)],
    });
    if (!ok)
      throw new Error(`subbasins checks failed: ${JSON.stringify(checks)}`);
    log("done");
  } finally {
    db.close();
  }
}
