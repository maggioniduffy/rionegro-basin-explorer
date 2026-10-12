/**
 * pipeline:rivers in reference mode (cba, R3.2 stage A). The roots come from pipeline:basin
 * (APRHI decides which root an area belongs to); HydroRIVERS is a hidden network that
 * supplies topology and the RiverATLAS / GIRES values.
 *
 * - Selection: every reach whose HYBAS_L12 is in hybas_l12.parquet; `root` from lev12_roots.
 * - Edges: HR_NEXT_DOWN keeps HydroRIVERS' value. NEXT_DOWN is the effective downstream reach:
 *   an edge into another root is cut (next_down_edit = 'cut'), one into a reach outside the
 *   selection is cut too ('outside': the reach leaves the region), then
 *   regions/cba/network-overrides.json is applied ('override').
 * - network: 'connected' when the effective path reaches the root's exit (roots.json), else
 *   'endorheic'.
 * - Report sections for choosing overrides (stage B): cuts, endorheicSystems, totalsByRoot.
 *
 * Outputs in data/work/cba/rivers/: reaches.parquet, riveratlas_basin.parquet,
 * gires_basin.parquet, report.json.
 */
import { mkdir, readFile } from "node:fs/promises";
import { lit, openDb, type Db } from "./duckdb";
import { lengthSpheroidKm, pctDiff } from "./geo";
import { INPUTS, requireInput } from "./inputs";
import { regionFile, rel, workPath } from "./paths";
import { writeReport } from "./report";
import {
  applyCuts,
  applyOverrides,
  applyRootOverrides,
  connectedSet,
  terminals,
  type Override,
  type RootOverride,
  type RefReach,
} from "./rivers-reference-pure";
import { cachedSubset, idsHash } from "./subset";

const LENGTH_AGREEMENT_PCT = 2;
/** Terminals draining less than this many km are not listed as endorheic systems. */
const MIN_SYSTEM_KM = 50;
/** An APRHI line this close to a reach counts as the same river (m, approximate). */
const APRHI_NEAR_M = 500;
const ALBERS = "ESRI:102033";
const SHARED_FIELDS = [
  "NEXT_DOWN",
  "MAIN_RIV",
  "LENGTH_KM",
  "UPLAND_SKM",
  "ORD_STRA",
];
const FLOAT_FIELDS = new Set(["LENGTH_KM", "UPLAND_SKM"]);
const FLOAT_REL_TOLERANCE = 1e-6;

interface RootInfo {
  code: string;
  exit: { HYRIV_ID: number; kind: string };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const num = (v: unknown) => Number(v);

async function insertChunks(
  db: Db,
  table: string,
  rows: string[],
  size = 5000,
) {
  for (let i = 0; i < rows.length; i += size)
    await db.conn.run(
      `INSERT INTO ${table} VALUES ${rows.slice(i, i + size).join(",")}`,
    );
}

export async function runReference(): Promise<void> {
  const rivers = lit(requireInput(INPUTS.hydroRivers));
  const basinDir = workPath("basin");
  const members = requireInput(`${basinDir}/hybas_l12.parquet`);
  const lev12Roots = requireInput(`${basinDir}/lev12_roots.parquet`);
  const basinsGeojson = requireInput(`${basinDir}/basins.geojson`);
  const linesFile = requireInput(workPath("lines-gate/lines_province.parquet"));
  const roots = JSON.parse(
    await readFile(requireInput(`${basinDir}/roots.json`), "utf8"),
  ) as RootInfo[];
  const exits = new Map(roots.map((r) => [r.code, num(r.exit.HYRIV_ID)]));
  const overrideFile = regionFile("network-overrides.json");
  const overrideJson = JSON.parse(await readFile(overrideFile, "utf8")) as {
    overrides: Override[];
    rootOverrides?: RootOverride[];
  };
  const overrides = overrideJson.overrides;
  const rootOverrides = overrideJson.rootOverrides ?? [];
  const outDir = workPath("rivers");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();

  try {
    // 1. Selection and root.
    await db.conn.run(`
      CREATE TABLE sel AS
      SELECT r.* EXCLUDE (OGC_FID), lr.root
      FROM ST_Read(${rivers}) r
      JOIN ${lit(members)} m ON r.HYBAS_L12 = m.HYBAS_ID
      JOIN ${lit(lev12Roots)} lr ON lr.HYBAS_ID = r.HYBAS_L12`);
    const [selCount] = await db.all(
      `SELECT count(*)::INT AS n, (SELECT count(*) FROM ${lit(members)})::INT AS members FROM sel`,
    );
    const lev12Reaches: RefReach[] = (
      await db.all(
        `SELECT HYRIV_ID, NEXT_DOWN, root, LENGTH_KM FROM sel ORDER BY HYRIV_ID`,
      )
    ).map((r) => ({
      id: num(r.HYRIV_ID),
      hrNextDown: num(r.NEXT_DOWN),
      root: String(r.root),
      km: num(r.LENGTH_KM),
    }));
    // Root overrides apply before the cuts, so the edges they join are not cut.
    const reaches = applyRootOverrides(
      lev12Reaches,
      rootOverrides,
      new Set(exits.keys()),
    );
    const rootOverrideReport = rootOverrides.map((o) => {
      const from = lev12Reaches.find((r) => r.id === o.reach);
      return {
        ...o,
        rootFromLev12: from?.root,
        km: round(from?.km ?? 0, 2),
      };
    });
    await db.conn.run(`CREATE TABLE root_fix (HYRIV_ID BIGINT, root VARCHAR)`);
    if (rootOverrides.length > 0)
      await insertChunks(
        db,
        "root_fix",
        rootOverrides.map((o) => `(${o.reach},${lit(o.root)})`),
      );
    await db.conn.run(`
      CREATE OR REPLACE TABLE sel AS
      SELECT s.* EXCLUDE (root), coalesce(f.root, s.root) AS root
      FROM sel s LEFT JOIN root_fix f USING (HYRIV_ID)`);
    console.log(`reaches: ${reaches.length}`);

    // 2. Edges: cuts, overrides, network flag.
    const edges = applyCuts(reaches);
    applyOverrides(reaches, edges, overrides);
    const connected = new Set<number>();
    const exitProblems: string[] = [];
    const ids = new Set(reaches.map((r) => r.id));
    const rootOf = new Map(reaches.map((r) => [r.id, r.root]));
    for (const [code, exit] of exits) {
      if (!ids.has(exit) || rootOf.get(exit) !== code)
        exitProblems.push(`${code}: exit ${exit} is not a reach of the root`);
      else if (edges.nextDown.get(exit) !== 0)
        exitProblems.push(`${code}: exit ${exit} is not a terminal`);
      else
        for (const id of connectedSet(edges.nextDown, exit)) connected.add(id);
    }
    await db.conn.run(
      `CREATE TABLE edges (HYRIV_ID BIGINT, nd BIGINT, edit VARCHAR, network VARCHAR)`,
    );
    await insertChunks(
      db,
      "edges",
      reaches.map((r) => {
        const e = edges.edit.get(r.id);
        return `(${r.id},${edges.nextDown.get(r.id)},${e ? lit(e) : "NULL"},${connected.has(r.id) ? "'connected'" : "'endorheic'"})`;
      }),
    );
    await db.conn.run(`
      CREATE TABLE reaches AS
      SELECT s.* EXCLUDE (root) REPLACE (e.nd AS NEXT_DOWN),
             e.network, s.root, s.NEXT_DOWN AS HR_NEXT_DOWN, e.edit AS next_down_edit
      FROM sel s JOIN edges e USING (HYRIV_ID)`);

    // 3. Counts and topology.
    const [counts] = await db.all(`
      SELECT count(*) AS n, sum(LENGTH_KM) AS km,
             ${lengthSpheroidKm("ST_Collect(list(geom))")} AS geodesic_km,
             sum(DIS_AV_CMS = 0)::INT AS zero_flow_n
      FROM reaches`);
    const totalsByRoot = await db.all(`
      SELECT root, count(*)::INT AS reaches, round(sum(LENGTH_KM), 1) AS km,
             round(sum(CASE WHEN network = 'connected' THEN LENGTH_KM ELSE 0 END), 1) AS connected_km,
             round(sum(CASE WHEN network = 'endorheic' THEN LENGTH_KM ELSE 0 END), 1) AS endorheic_km,
             sum((network = 'connected')::INT)::INT AS connected_reaches,
             sum((network = 'endorheic')::INT)::INT AS endorheic_reaches
      FROM reaches GROUP BY root ORDER BY root`);
    const [topology] = await db.all(`
      SELECT
        (SELECT count(*) FROM reaches r WHERE r.NEXT_DOWN <> 0
           AND r.NEXT_DOWN NOT IN (SELECT HYRIV_ID FROM reaches))::INT AS orphans,
        (SELECT count(*) FROM reaches r JOIN reaches d ON r.NEXT_DOWN = d.HYRIV_ID
           WHERE r.network = 'connected' AND d.network = 'endorheic')::INT AS connected_into_endorheic,
        (SELECT count(*) FROM reaches r JOIN reaches d ON r.NEXT_DOWN = d.HYRIV_ID
           WHERE r.root <> d.root)::INT AS cross_root_edges,
        (SELECT count(*) FROM reaches WHERE next_down_edit = 'outside')::INT AS leaves_selection`);
    const exitStatus = await db.all(`
      SELECT root, HYRIV_ID, network, NEXT_DOWN, HR_NEXT_DOWN, next_down_edit
      FROM reaches WHERE HYRIV_ID IN (${[...exits.values()].join(",")}) ORDER BY root`);

    // 4. Geometry in a metric CRS (Albers, approximate distances) for the report sections.
    await db.conn.run(`
      CREATE TABLE rm AS
      SELECT HYRIV_ID, root, network,
             ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS g,
             ST_EndPoint(geom) AS endpoint, LENGTH_KM, UPLAND_SKM
      FROM reaches`);

    const leavesByRoot: Record<string, number[]> = {};
    for (const r of await db.all(
      `SELECT root, HYRIV_ID FROM reaches WHERE next_down_edit = 'outside' ORDER BY root, HYRIV_ID`,
    ))
      (leavesByRoot[String(r.root)] ??= []).push(num(r.HYRIV_ID));

    // 5a. Cuts.
    const cuts = (
      await db.all(`
      SELECT r.HYRIV_ID AS "from", r.HR_NEXT_DOWN AS "to", r.root AS root_from, d.root AS root_to,
             r.UPLAND_SKM AS upland_skm,
             round(ST_X(m.endpoint), 4) AS lon, round(ST_Y(m.endpoint), 4) AS lat
      FROM reaches r JOIN rm m USING (HYRIV_ID)
      JOIN reaches d ON d.HYRIV_ID = r.HR_NEXT_DOWN
      WHERE r.next_down_edit = 'cut'
      ORDER BY r.UPLAND_SKM DESC`)
    ).map((r) => ({
      from: num(r.from),
      to: num(r.to),
      root_from: r.root_from,
      root_to: r.root_to,
      upland_skm: num(r.upland_skm),
      lon: num(r.lon),
      lat: num(r.lat),
    }));

    // 5b. Endorheic systems.
    const terms = terminals(reaches, edges, exits);
    const big = terms.filter((t) => t.upstreamKm >= MIN_SYSTEM_KM);
    await db.conn.run(
      `CREATE TABLE term (id BIGINT, root VARCHAR, why VARCHAR, up_km DOUBLE, up_n INT)`,
    );
    if (big.length > 0)
      await insertChunks(
        db,
        "term",
        big.map(
          (t) =>
            `(${t.id},${lit(t.root)},${lit(t.why)},${t.upstreamKm},${t.upstreamReaches})`,
        ),
      );
    const termInfo = await db.all(`
      SELECT t.*, round(ST_X(m.endpoint), 4) AS lon, round(ST_Y(m.endpoint), 4) AS lat,
             m.UPLAND_SKM AS upland_skm
      FROM term t JOIN rm m ON m.HYRIV_ID = t.id`);
    const nearest = new Map(
      (
        await db.all(`
      SELECT t.id, arg_min(c.HYRIV_ID, ST_Distance(ST_Transform(m.endpoint, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true), c.g)) AS reach,
             min(ST_Distance(ST_Transform(m.endpoint, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true), c.g)) AS d
      FROM term t JOIN rm m ON m.HYRIV_ID = t.id
      JOIN rm c ON c.root = t.root AND c.network = 'connected'
      GROUP BY t.id`)
      ).map((r) => [num(r.id), r]),
    );
    await db.conn.run(`
      CREATE TABLE aprhi AS
      SELECT name, ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS g
      FROM read_parquet(${lit(linesFile)}) WHERE source = 'aprhi' AND name IS NOT NULL`);
    const nameHits = await db.all(`
      SELECT t.id, l.name, min(ST_Distance(m.g, l.g)) AS d
      FROM term t JOIN rm m ON m.HYRIV_ID = t.id
      JOIN aprhi l ON ST_DWithin(m.g, l.g, ${APRHI_NEAR_M})
      GROUP BY t.id, l.name ORDER BY t.id, d`);
    const pairs = [
      ...new Set(nameHits.map((r) => `${rootOfTerm(r.id)}|${r.name}`)),
    ];
    function rootOfTerm(id: unknown) {
      return big.find((t) => t.id === num(id))?.root ?? "";
    }
    const sameName = new Map<string, { reach: number; d: number }>();
    for (const p of pairs) {
      const [root, name] = p.split("|") as [string, string];
      const [row] = await db.all(`
        SELECT arg_min(c.HYRIV_ID, ST_Distance(c.g, l.g)) AS reach, min(ST_Distance(c.g, l.g)) AS d
        FROM rm c, aprhi l
        WHERE c.root = ${lit(root)} AND c.network = 'connected' AND l.name = ${lit(name)}`);
      if (row?.reach != null)
        sameName.set(p, { reach: num(row.reach), d: num(row.d) });
    }
    const endorheicSystems: Record<string, unknown[]> = {};
    for (const t of big) {
      const info = termInfo.find((i) => num(i.id) === t.id);
      const near = nearest.get(t.id);
      const names = nameHits
        .filter((h) => num(h.id) === t.id)
        .map((h) => {
          const s = sameName.get(`${t.root}|${h.name}`);
          return {
            name: h.name,
            distM: Math.round(num(h.d)),
            connectedSameName: s
              ? {
                  within500m: s.d <= APRHI_NEAR_M,
                  nearestConnectedReach: s.reach,
                  distM: Math.round(s.d),
                }
              : null,
          };
        });
      (endorheicSystems[t.root] ??= []).push({
        terminal: t.id,
        why: t.why,
        upland_skm: num(info?.upland_skm),
        upstreamKm: round(t.upstreamKm, 1),
        upstreamReaches: t.upstreamReaches,
        lon: num(info?.lon),
        lat: num(info?.lat),
        nearestConnectedReach: near
          ? { reach: num(near.reach), distKm: round(num(near.d) / 1000, 2) }
          : null,
        aprhiNames500m: names,
      });
    }
    const smallTerminals = terms.length - big.length;

    // 6. Spatial cross-check against the root polygons (report only).
    await db.conn.run(
      `CREATE TABLE polys AS SELECT code, geom FROM ST_Read(${lit(basinsGeojson)})`,
    );
    const spatial = await db.all(`
      WITH mid AS (
        SELECT HYRIV_ID, root, LENGTH_KM, ST_LineInterpolatePoint(geom, 0.5) AS p FROM reaches)
      SELECT mid.root AS root, coalesce(p.code, '(none)') AS polygon_root,
             count(*)::INT AS n, round(sum(LENGTH_KM), 1) AS km
      FROM mid LEFT JOIN polys p ON ST_Within(mid.p, p.geom)
      GROUP BY ALL ORDER BY ALL`);
    const spTotal = spatial.reduce((a, r) => a + num(r.km), 0);
    const spDiff = spatial
      .filter((r) => r.root !== r.polygon_root)
      .reduce((a, r) => a + num(r.km), 0);

    // 7. RiverATLAS and GIRES joins (cached subsets keyed by the reach-id hash).
    const hash = idsHash(reaches.map((r) => r.id));
    const atlasFile = `${outDir}/riveratlas_basin.parquet`;
    const { cached } = await cachedSubset(db, {
      label: "RiverATLAS",
      source: INPUTS.riverAtlas,
      layer: "RiverATLAS_v10",
      geometryColumn: "Shape",
      idsTable: "reaches",
      hash,
      file: atlasFile,
    });
    // HydroRIVERS' own NEXT_DOWN is HR_NEXT_DOWN here; the effective one is a derived field.
    const col = (f: string) => (f === "NEXT_DOWN" ? "HR_NEXT_DOWN" : f);
    const mismatchCases = SHARED_FIELDS.map((f) =>
      FLOAT_FIELDS.has(f)
        ? `sum((abs(r.${f} - a.${f}) > ${FLOAT_REL_TOLERANCE} * greatest(abs(r.${f}), 1)
                 OR (r.${f} IS NULL) <> (a.${f} IS NULL))::INT) AS ${f}`
        : `sum((r.${col(f)} IS DISTINCT FROM a.${f})::INT) AS ${f}`,
    ).join(", ");
    const [join] = await db.all(`
      SELECT count(*)::INT AS matched, count(DISTINCT a.HYRIV_ID)::INT AS distinct_matched,
             ${mismatchCases}
      FROM reaches r JOIN ${lit(atlasFile)} a USING (HYRIV_ID)`);
    const [atlasRows] = await db.all(
      `SELECT count(*)::INT AS n FROM ${lit(atlasFile)}`,
    );
    const giresFile = `${outDir}/gires_basin.parquet`;
    const gires = await cachedSubset(db, {
      label: "GIRES",
      source: INPUTS.gires,
      layer: "GIRES_v10_rivers",
      geometryColumn: "Shape",
      idsTable: "reaches",
      hash,
      file: giresFile,
    });
    const [giresJoin] = await db.all(`
      SELECT count(*)::INT AS rows, count(DISTINCT HYRIV_ID)::INT AS distinct_ids,
             (SELECT count(*) FROM reaches r JOIN ${lit(giresFile)} g USING (HYRIV_ID)
               WHERE r.HR_NEXT_DOWN IS DISTINCT FROM g.NEXT_DOWN)::INT AS next_down_mismatches
      FROM ${lit(giresFile)}`);
    await db.conn.run(`
      CREATE OR REPLACE TABLE reaches AS
      SELECT r.*, g.predprob1, g.predcat1, g.predprob30, g.predcat30
      FROM reaches r LEFT JOIN ${lit(giresFile)} g USING (HYRIV_ID)`);
    const [coverage] = await db.all(`
      SELECT sum((predcat1 IS NULL)::INT)::INT AS unpredicted,
             sum((predcat1 IS NULL AND DIS_AV_CMS > 0)::INT)::INT AS unpredicted_with_flow,
             sum((predcat1 IS NOT NULL AND DIS_AV_CMS = 0)::INT)::INT AS predicted_without_flow
      FROM reaches`);

    const reachesFile = `${outDir}/reaches.parquet`;
    await db.conn.run(`COPY reaches TO ${lit(reachesFile)} (FORMAT parquet)`);

    const n = num(counts?.n);
    const km = num(counts?.km);
    const geodesicKm = num(counts?.geodesic_km);
    const mismatches = Object.fromEntries(
      SHARED_FIELDS.map((f) => [f, num(join?.[f])]),
    );
    const checks = {
      selectionMatchesMembers: n === reaches.length && n > 0,
      zeroOrphans: topology?.orphans === 0,
      rootExitsSelectedAndConnected:
        exitProblems.length === 0 &&
        exitStatus.length === exits.size &&
        exitStatus.every((r) => r.network === "connected"),
      noConnectedIntoEndorheic: topology?.connected_into_endorheic === 0,
      noEdgeCrossesRoots: topology?.cross_root_edges === 0,
      lengthKmMatchesGeodesic:
        Math.abs(pctDiff(km, geodesicKm)) <= LENGTH_AGREEMENT_PCT,
      riverAtlasJoinOneToOne:
        join?.matched === n &&
        join?.distinct_matched === n &&
        atlasRows?.n === n,
      riverAtlasSharedFieldsMatch: Object.values(mismatches).every(
        (v) => v === 0,
      ),
      giresOneRowPerReach: giresJoin?.rows === giresJoin?.distinct_ids,
      giresNextDownMatches: giresJoin?.next_down_mismatches === 0,
      giresCoversAllFlowingReaches: coverage?.unpredicted_with_flow === 0,
    };

    await writeReport("rivers", {
      ok: Object.values(checks).every(Boolean),
      mode: "reference",
      checks,
      exitProblems,
      counts: {
        reaches: n,
        level12Members: selCount?.members,
        overridesApplied: overrides.length,
        rootOverridesApplied: rootOverrides.length,
        cuts: cuts.length,
        leavesSelection: topology?.leaves_selection,
        zeroModeledFlow: counts?.zero_flow_n,
      },
      lengthKm: {
        total: km,
        geodesicTotal: geodesicKm,
        diffPct: pctDiff(km, geodesicKm),
      },
      totalsByRoot,
      roots: exitStatus,
      topology,
      rootOverrides: {
        totalKm: round(
          rootOverrideReport.reduce((a, o) => a + o.km, 0),
          2,
        ),
        entries: rootOverrideReport,
      },
      cuts,
      leavesSelectionByRoot: leavesByRoot,
      endorheicSystems: {
        minUpstreamKm: MIN_SYSTEM_KM,
        aprhiNearM: APRHI_NEAR_M,
        terminalsBelowMin: smallTerminals,
        note: "Distances are approximate (ESRI:102033). nearestConnectedReach is the closest connected reach of the same root to the terminal's downstream end.",
        byRoot: endorheicSystems,
      },
      spatialCrossCheck: {
        note: "Report only. Midpoint of each reach tested against the root polygons (basins.geojson); boundary reaches may land either side.",
        kmInOtherRootPolygon: round(spDiff, 1),
        sharePct: round((spDiff / spTotal) * 100, 2),
        byRootAndPolygon: spatial,
      },
      riverAtlasJoin: { ...join, subsetRows: atlasRows?.n, cached, mismatches },
      gires: {
        ...giresJoin,
        cached: gires.cached,
        coverage,
      },
      notes: [
        "NEXT_DOWN is the effective downstream reach (after cuts and overrides); HR_NEXT_DOWN is HydroRIVERS' original value.",
        "next_down_edit: 'cut' = edge into another root, 'outside' = edge into a reach outside the selection (the reach leaves the region), 'override' = regions/cba/network-overrides.json.",
        "DIS_AV_CMS is modeled long-term natural discharge (1971–2000); zero means no modeled flow, not observed dryness.",
      ],
      outputs: [rel(reachesFile), rel(atlasFile), rel(giresFile)],
    });
  } finally {
    db.close();
  }
}
