/**
 * pipeline:subbasins — sub-basin hierarchy from HydroBASINS level 12 (Phase 4: level 1).
 *
 * 1. Sets. Two kinds of node in subbasins.config.json:
 *    - river: the level-12 polygon holding its river's mouthReach (data/out/rivers.ndjson)
 *      plus everything upstream via NEXT_DOWN. Below the root, endorheic polygons
 *      (ENDO > 0) are left out: they drain to closed depressions, not to the river, even
 *      where HydroBASINS links them to it with a virtual NEXT_DOWN. The root keeps them,
 *      since it is the whole basin.
 *    - endorheic: every endorheic polygon of its parent.
 * 2. Partition. A node's own area is its set minus its children's sets; the own areas
 *    must partition the root (the whole basin). Polygons are ST_MakeValid'ed first.
 * 3. Reaches. Assigned by their HydroRIVERS HYBAS_L12 attribute. Cross-checks: the
 *    connected reaches of each river node equal the HydroRIVERS upstream set of its mouth
 *    reach; endorheic reaches lie in endorheic polygons and connected ones outside them;
 *    a point on each reach falls in its owner's polygon (reported only).
 * 4. Metrics. Summed or CATCH_SKM-weighted over every reach catchment in the node, from
 *    RiverATLAS v1.0 catchment ("c") attributes: pop_ct_csu (thousands), lka_pc_cse
 *    (percent × 10), inu_pc_cmn / inu_pc_cmx (percent), ele_mt_cmn / ele_mt_cmx (m).
 *    Their units are confirmed by the report: over the connected reaches of a river node
 *    they must reproduce the upstream ("u") values at the mouth reach, whose units come
 *    from the catalog (see export.ts).
 *
 * Outputs: data/out/subbasins.ndjson (seed input, committed),
 * data/work/tiles/subbasins.geojson (own areas, tippecanoe input), report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb, type Row } from "../lib/duckdb";
import { areaSpheroidKm2, pctDiff } from "../lib/geo";
import { difference, upstreamIndex, upstreamSet } from "../lib/graph";
import { requireInput } from "../lib/inputs";
import { OUT_DIR, ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import { partition, type SubbasinNode } from "../lib/subbasins";

type ConfigNode = SubbasinNode & { level: number } & (
    { kind: "river"; river: string } | { kind: "endorheic" }
  );
type RiverNode = Extract<ConfigNode, { kind: "river" }>;
interface RiverDoc {
  _id: string;
  name: string;
  mouthReach: number;
  mouth: { uplandKm2: number };
}

/** Area figures for the same polygon set must agree this closely (as in pipeline:basin). */
const AREA_AGREEMENT_PCT = 1;
/** The own areas must add up to the basin outline this closely. */
const PARTITION_AREA_PCT = 0.1;
/** Largest tolerated overlap or gap, in km² (slivers from dissolving). */
const SLIVER_KM2 = 1;
/** Catchment aggregates vs upstream values at the mouth (unit cross-check). */
const POPULATION_PCT = 1;
const PERCENT_POINTS = 0.5;

const r1 = (x: number) => Math.round(x * 10) / 10;
const num = (v: unknown) => Number(v);

const MODELED_LAND = [
  "nonPerennialPct",
  "floodedMinPct",
  "floodedMaxPct",
  "population",
];
const MODELED_OUTLET = ["outlet.dischargeM3s", "outlet.regulationPct"];
const PROVENANCE = {
  areaKm2:
    "Geodesic area of the dissolved HydroBASINS v1c level-12 polygons upstream of the mouth reach's polygon (NEXT_DOWN); below the root, endorheic polygons (ENDO > 0) are left out",
  endorheicAreaKm2:
    "Geodesic area of the node's HydroBASINS v1c level-12 polygons with ENDO > 0",
  reachCount: "HydroRIVERS v1.0 reaches whose HYBAS_L12 is in the node",
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
    "HydroRIVERS v1.0 DIS_AV_CMS at the mouth reach; modeled natural long-term average 1971–2000 (WaterGAP), does not reflect dam regulation",
  "outlet.regulationPct":
    "RiverATLAS v1.0 dor_pc_pva / 10 at the mouth reach: degree of regulation from GRanD v1.1 dams",
  rivers: "Named rivers whose mouth reach lies in the node",
};
const ENDORHEIC_PROVENANCE = {
  ...PROVENANCE,
  areaKm2:
    "Geodesic area of the dissolved HydroBASINS v1c level-12 polygons with ENDO > 0 in the parent: land draining to closed depressions, not to a river",
};

async function main() {
  const { subbasins: nodes } = JSON.parse(
    await readFile(`${ROOT}/pipeline/subbasins.config.json`, "utf8"),
  ) as { subbasins: ConfigNode[] };
  const riverNodes = nodes.filter((n): n is RiverNode => n.kind === "river");
  const lev12File = requireInput(workPath("basin/hybas_l12.parquet"));
  const basinFile = requireInput(workPath("basin/basin.geojson"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  const rivers = (
    await readFile(requireInput(`${OUT_DIR}/rivers.ndjson`), "utf8")
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RiverDoc);
  const riverById = new Map(rivers.map((r) => [r._id, r]));
  const riverOf = (node: RiverNode) => {
    const river = riverById.get(node.river);
    if (!river) throw new Error(`${node.id}: river ${node.river} not found`);
    return river;
  };
  const tilesDir = workPath("tiles");
  await mkdir(tilesDir, { recursive: true });
  const db = await openDb();

  try {
    await db.conn.run(`
      CREATE TABLE lev12 AS
      SELECT HYBAS_ID, NEXT_DOWN, SUB_AREA, UP_AREA, ENDO,
             ST_IsValid(geom) AS was_valid, ST_MakeValid(geom) AS geom
      FROM read_parquet(${lit(lev12File)})`);
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT r.HYRIV_ID, r.NEXT_DOWN, r.HYBAS_L12, r.network, r.LENGTH_KM, r.CATCH_SKM,
             r.UPLAND_SKM, r.DIS_AV_CMS, r.predcat1, r.geom,
             a.pop_ct_csu, a.lka_pc_cse, a.inu_pc_cmn, a.inu_pc_cmx,
             a.ele_mt_cmn, a.ele_mt_cmx, a.dor_pc_pva,
             a.pop_ct_usu, a.lka_pc_use, a.inu_pc_umn, a.inu_pc_umx
      FROM read_parquet(${lit(reachesFile)}) r
      JOIN read_parquet(${lit(atlasFile)}) a USING (HYRIV_ID)`);

    // 1. Polygon sets.
    const links = await db.all(
      `SELECT HYBAS_ID, NEXT_DOWN, UP_AREA, ENDO FROM lev12`,
    );
    const polyIndex = upstreamIndex(
      links.map((r) => ({
        id: String(r.HYBAS_ID),
        nextDown: String(r.NEXT_DOWN),
      })),
    );
    const upAreaOf = new Map(
      links.map((r) => [String(r.HYBAS_ID), num(r.UP_AREA)]),
    );
    const endoPolygons = new Set(
      links.filter((r) => num(r.ENDO) > 0).map((r) => String(r.HYBAS_ID)),
    );
    const reachLinks = await db.all(
      `SELECT HYRIV_ID, NEXT_DOWN, HYBAS_L12, network FROM reaches`,
    );
    const reachById = new Map(reachLinks.map((r) => [num(r.HYRIV_ID), r]));
    const reachIndex = upstreamIndex(
      reachLinks.map((r) => ({
        id: num(r.HYRIV_ID),
        nextDown: num(r.NEXT_DOWN),
      })),
    );

    const setOf = new Map<string, Set<string>>();
    const mouthPolygon = new Map<string, string>();
    for (const node of riverNodes) {
      const river = riverOf(node);
      const reach = reachById.get(river.mouthReach);
      if (!reach)
        throw new Error(`${node.id}: mouth reach ${river.mouthReach} missing`);
      const poly = String(reach.HYBAS_L12);
      mouthPolygon.set(node.id, poly);
      const set = upstreamSet(polyIndex, poly);
      if (node.parentId !== null) for (const p of endoPolygons) set.delete(p);
      setOf.set(node.id, set);
    }
    for (const node of nodes) {
      if (node.kind !== "endorheic") continue;
      const parent =
        node.parentId === null ? undefined : setOf.get(node.parentId);
      if (!parent) throw new Error(`${node.id}: endorheic node needs a parent`);
      setOf.set(
        node.id,
        new Set([...parent].filter((p) => endoPolygons.has(p))),
      );
    }
    const allPolygons = new Set(links.map((r) => String(r.HYBAS_ID)));
    const root = nodes.find((n) => n.parentId === null);
    const rootSet = root ? (setOf.get(root.id) ?? new Set()) : new Set();
    const rootMissing = difference(allPolygons, rootSet as Set<string>);

    // 2. Partition into own areas.
    const { ownerOf, problems } = partition(nodes, setOf);
    await db.conn.run(`CREATE TABLE owner (HYBAS_ID BIGINT, node VARCHAR)`);
    await db.conn.run(
      `INSERT INTO owner VALUES ${[...ownerOf].map(([p, n]) => `(${p}, ${lit(n)})`).join(",")}`,
    );
    await db.conn.run(
      `CREATE TABLE membership (HYBAS_ID BIGINT, node VARCHAR)`,
    );
    await db.conn.run(
      `INSERT INTO membership VALUES ${[...setOf]
        .flatMap(([n, set]) => [...set].map((p) => `(${p}, ${lit(n)})`))
        .join(",")}`,
    );

    await db.conn.run(`
      CREATE TABLE own_geom AS
      SELECT o.node, ST_Union_Agg(l.geom) AS geom
      FROM lev12 l JOIN owner o USING (HYBAS_ID) GROUP BY o.node`);
    await db.conn.run(`
      CREATE TABLE node_geom AS
      SELECT m.node, ST_Union_Agg(l.geom) AS geom,
             ST_Union_Agg(CASE WHEN l.ENDO > 0 THEN l.geom END) AS endo_geom,
             sum(l.SUB_AREA) AS sum_sub_area,
             sum(CASE WHEN l.ENDO = 0 THEN l.SUB_AREA ELSE 0 END) AS connected_sub_area,
             count(*)::INT AS polygons, sum((l.ENDO = 2)::INT)::INT AS endo_sinks
      FROM lev12 l JOIN membership m USING (HYBAS_ID) GROUP BY m.node`);
    await db.conn.run(
      `CREATE TABLE basin AS SELECT geom FROM ST_Read(${lit(basinFile)})`,
    );

    const [areas] = await db.all(`
      SELECT (SELECT ${areaSpheroidKm2("geom")} FROM basin) AS basin,
             (SELECT sum(${areaSpheroidKm2("geom")}) FROM own_geom) AS own_sum,
             (SELECT ${areaSpheroidKm2("ST_Difference((SELECT geom FROM basin), ST_Union_Agg(geom))")}
              FROM own_geom) AS gap,
             (SELECT count(*) FROM lev12 WHERE NOT was_valid)::INT AS made_valid`);
    const overlaps = await db.all(`
      SELECT a.node AS a, b.node AS b,
             ${areaSpheroidKm2("ST_Intersection(a.geom, b.geom)")} AS km2
      FROM own_geom a JOIN own_geom b ON a.node < b.node`);
    const ownAreas = await db.all(`
      SELECT node, ${areaSpheroidKm2("geom")} AS km2, ST_NumGeometries(geom) AS parts
      FROM own_geom ORDER BY node`);

    // 3. Reaches.
    const [assigned] = await db.all(`
      SELECT count(*)::INT AS n, count(o.node)::INT AS with_owner,
             (SELECT count(*) FROM reaches)::INT AS total
      FROM reaches r LEFT JOIN owner o ON o.HYBAS_ID = r.HYBAS_L12`);
    const [network] = await db.all(`
      SELECT sum((r.network = 'endorheic' AND l.ENDO = 0)::INT)::INT AS endorheic_outside,
             sum((r.network = 'connected' AND l.ENDO > 0)::INT)::INT AS connected_inside,
             list(r.HYRIV_ID) FILTER (WHERE (r.network = 'endorheic') <> (l.ENDO > 0))[1:10] AS sample
      FROM reaches r JOIN lev12 l ON l.HYBAS_ID = r.HYBAS_L12`);
    const [pip] = await db.all(`
      WITH pts AS (
        SELECT r.HYRIV_ID, r.LENGTH_KM, o.node,
               ST_PointN(r.geom, ((ST_NPoints(r.geom) + 1) // 2)::INT) AS pt
        FROM reaches r JOIN owner o ON o.HYBAS_ID = r.HYBAS_L12)
      SELECT count(*)::INT AS n, coalesce(sum(p.LENGTH_KM), 0) AS km,
             list(p.HYRIV_ID ORDER BY p.LENGTH_KM DESC)[1:10] AS sample
      FROM pts p JOIN own_geom g ON g.node = p.node
      WHERE NOT ST_Intersects(g.geom, p.pt)`);
    const connectedOf = async (node: string) =>
      new Set(
        (
          await db.all(`
            SELECT r.HYRIV_ID FROM reaches r JOIN membership m ON m.HYBAS_ID = r.HYBAS_L12
            WHERE m.node = ${lit(node)} AND r.network = 'connected'`)
        ).map((r) => num(r.HYRIV_ID)),
      );
    const topology = [];
    for (const node of riverNodes) {
      const upstream = upstreamSet(reachIndex, riverOf(node).mouthReach);
      const inPolygons = await connectedOf(node.id);
      topology.push({
        node: node.id,
        upstreamOfMouth: upstream.size,
        connectedInPolygons: inPolygons.size,
        onlyUpstream: difference(upstream, inPolygons).slice(0, 10),
        onlyPolygons: difference(inPolygons, upstream).slice(0, 10),
      });
    }

    // 4. Metrics, all reaches and connected-only (the latter for the unit cross-check).
    const aggregate = (where: string) =>
      db.all(`
        SELECT m.node, count(*)::INT AS reaches, sum(r.LENGTH_KM) AS km,
               sum(CASE WHEN r.network = 'endorheic' THEN r.LENGTH_KM ELSE 0 END) AS endo_km,
               sum(CASE WHEN r.predcat1 = 1 THEN r.LENGTH_KM ELSE 0 END) AS nonperennial_km,
               sum(CASE WHEN r.predcat1 IS NULL THEN r.LENGTH_KM ELSE 0 END) AS unknown_km,
               sum(r.CATCH_SKM) AS catch_km2,
               sum(r.pop_ct_csu) * 1000 AS population,
               sum(r.lka_pc_cse / 10.0 * r.CATCH_SKM) / sum(r.CATCH_SKM) AS lakes_pct,
               sum(r.inu_pc_cmn * r.CATCH_SKM) / sum(r.CATCH_SKM) AS flooded_min_pct,
               sum(r.inu_pc_cmx * r.CATCH_SKM) / sum(r.CATCH_SKM) AS flooded_max_pct,
               min(r.ele_mt_cmn) AS ele_min, max(r.ele_mt_cmx) AS ele_max
        FROM reaches r JOIN membership m ON m.HYBAS_ID = r.HYBAS_L12
        ${where} GROUP BY m.node`);
    const byNode = (rows: Row[]) =>
      new Map(rows.map((r) => [String(r.node), r]));
    const all = byNode(await aggregate(""));
    const connected = byNode(await aggregate("WHERE r.network = 'connected'"));
    const geoms = byNode(
      await db.all(`
        SELECT node, ${areaSpheroidKm2("geom")} AS area,
               coalesce(${areaSpheroidKm2("endo_geom")}, 0) AS endo_area,
               sum_sub_area, connected_sub_area, polygons, endo_sinks,
               [round(ST_XMin(geom), 5), round(ST_YMin(geom), 5),
                round(ST_XMax(geom), 5), round(ST_YMax(geom), 5)] AS bbox
        FROM node_geom`),
    );
    const mouths = new Map(
      (
        await db.all(`
          SELECT HYRIV_ID, DIS_AV_CMS, dor_pc_pva, pop_ct_usu, lka_pc_use, inu_pc_umn,
                 inu_pc_umx, ST_X(ST_EndPoint(geom)) AS lon, ST_Y(ST_EndPoint(geom)) AS lat
          FROM reaches
          WHERE HYRIV_ID IN (${riverNodes.map((n) => riverOf(n).mouthReach).join(",")})`)
      ).map((r) => [num(r.HYRIV_ID), r]),
    );

    const docs = [];
    const crossChecks = [];
    const areaChecks = [];
    for (const node of nodes) {
      const a = all.get(node.id) as Row;
      const c = connected.get(node.id) as Row;
      const g = geoms.get(node.id) as Row;
      const set = setOf.get(node.id) as Set<string>;
      const km = num(a.km);
      const river = node.kind === "river" ? riverOf(node) : null;
      const m = river ? (mouths.get(river.mouthReach) as Row) : null;
      const mouthUpArea = upAreaOf.get(mouthPolygon.get(node.id) ?? "");
      areaChecks.push({
        node: node.id,
        polygons: g.polygons,
        endorheicSinks: g.endo_sinks,
        areaKm2: r1(num(g.area)),
        sumSubArea: r1(num(g.sum_sub_area)),
        connectedSubArea: r1(num(g.connected_sub_area)),
        mouthPolygonUpArea: mouthUpArea ?? null,
        diffPct: {
          areaVsSumSubArea: pctDiff(num(g.area), num(g.sum_sub_area)),
          connectedVsUpArea:
            mouthUpArea === undefined
              ? null
              : pctDiff(num(g.connected_sub_area), mouthUpArea),
        },
      });
      if (m)
        crossChecks.push({
          node: node.id,
          population: {
            catchments: Math.round(num(c.population)),
            mouthUpstream: Math.round(num(m.pop_ct_usu) * 1000),
            diffPct: pctDiff(num(c.population), num(m.pop_ct_usu) * 1000),
          },
          lakesPct: {
            catchments: num(c.lakes_pct),
            mouthUpstream: num(m.lka_pc_use) / 10,
          },
          floodedMinPct: {
            catchments: num(c.flooded_min_pct),
            mouthUpstream: num(m.inu_pc_umn),
          },
          floodedMaxPct: {
            catchments: num(c.flooded_max_pct),
            mouthUpstream: num(m.inu_pc_umx),
          },
        });
      docs.push({
        _id: node.id,
        kind: node.kind,
        // Endorheic land has no proper name; the app labels it per locale.
        name: river?.name ?? null,
        level: node.level,
        parentId: node.parentId,
        childIds: nodes.filter((n) => n.parentId === node.id).map((n) => n.id),
        river: river?._id ?? null,
        areaKm2: Math.round(num(g.area)),
        endorheicAreaKm2: Math.round(num(g.endo_area)),
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
        outlet:
          river && m
            ? {
                hyrivId: river.mouthReach,
                lat: num(m.lat),
                lon: num(m.lon),
                dischargeM3s: r1(num(m.DIS_AV_CMS)),
                regulationPct: r1(num(m.dor_pc_pva) / 10),
              }
            : null,
        rivers: rivers
          .filter((r) => {
            const reach = reachById.get(r.mouthReach);
            return reach !== undefined && set.has(String(reach.HYBAS_L12));
          })
          .sort((x, y) => y.mouth.uplandKm2 - x.mouth.uplandKm2)
          .map((r) => r._id),
        bbox: g.bbox,
        modeled: river ? [...MODELED_OUTLET, ...MODELED_LAND] : MODELED_LAND,
        provenance: river ? PROVENANCE : ENDORHEIC_PROVENANCE,
      });
    }

    // Outputs.
    const ndjson = `${OUT_DIR}/subbasins.ndjson`;
    await writeFile(
      ndjson,
      docs.map((d) => JSON.stringify(d)).join("\n") + "\n",
    );
    const geojson = `${tilesDir}/subbasins.geojson`;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const features = await db.all(
      `SELECT node, ST_AsGeoJSON(geom) AS g FROM own_geom ORDER BY node`,
    );
    await writeFile(
      geojson,
      JSON.stringify({
        type: "FeatureCollection",
        features: features.map((f) => {
          const node = byId.get(String(f.node));
          return {
            type: "Feature",
            properties: { id: f.node, kind: node?.kind, level: node?.level },
            geometry: JSON.parse(String(f.g)),
          };
        }),
      }),
    );

    const basinArea = num(areas?.basin);
    const ownSum = num(areas?.own_sum);
    const checks = {
      rootIsWholeBasin:
        rootMissing.length === 0 && rootSet.size === allPolygons.size,
      cleanPartition: problems.length === 0,
      ownAreasSumToBasin:
        Math.abs(pctDiff(ownSum, basinArea)) <= PARTITION_AREA_PCT,
      noOverlaps: overlaps.every((o) => num(o.km2) < SLIVER_KM2),
      noGaps: num(areas?.gap) < SLIVER_KM2,
      areaMatchesSumSubArea: areaChecks.every(
        (a) => Math.abs(a.diffPct.areaVsSumSubArea) <= AREA_AGREEMENT_PCT,
      ),
      connectedAreaMatchesUpArea: areaChecks.every(
        (a) =>
          a.diffPct.connectedVsUpArea === null ||
          Math.abs(a.diffPct.connectedVsUpArea) <= AREA_AGREEMENT_PCT,
      ),
      everyReachAssignedOnce:
        assigned?.n === assigned?.total &&
        assigned?.with_owner === assigned?.total,
      reachTopologyMatchesPolygons: topology.every(
        (t) => t.onlyUpstream.length === 0 && t.onlyPolygons.length === 0,
      ),
      reachNetworkMatchesEndo:
        network?.endorheic_outside === 0 && network.connected_inside === 0,
      catchmentUnitsMatchUpstream: crossChecks.every(
        (x) =>
          Math.abs(x.population.diffPct) <= POPULATION_PCT &&
          [x.lakesPct, x.floodedMinPct, x.floodedMaxPct].every(
            (v) => Math.abs(v.catchments - v.mouthUpstream) <= PERCENT_POINTS,
          ),
      ),
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("subbasins", {
      ok,
      checks,
      partitionProblems: problems.slice(0, 20),
      areaKm2: {
        basin: basinArea,
        ownSum,
        diffPct: pctDiff(ownSum, basinArea),
        gap: num(areas?.gap),
        overlaps,
        own: ownAreas,
        polygonsMadeValid: areas?.made_valid,
      },
      nodes: areaChecks,
      reaches: {
        ...assigned,
        topology,
        network,
        // A reach's middle vertex outside its owner's polygon: HydroRIVERS lines can
        // cross level-12 borders near confluences. Informational.
        midpointOutsideOwner: pip,
      },
      catchmentVsUpstream: crossChecks,
      outputs: [rel(ndjson), rel(geojson)],
    });
    if (!ok)
      throw new Error(`subbasins checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
