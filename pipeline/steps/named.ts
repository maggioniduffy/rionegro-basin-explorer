/**
 * pipeline:named — trace the named rivers of regions/<id>/names.json and aggregate
 * their metrics. Runs after the step that writes the region's line names (namesFrom in
 * ign.config.json, lib/name-source.ts): pipeline:ign-match, or pipeline:line-names for cba.
 *
 * A river runs where its IGN name runs (owner rule, 2026-10-09; IGN is the authority).
 * From its mouth reach upstream it follows the reaches whose IGN line carries the river's
 * name (pipeline:ign-match cover.parquet; traceAlongName in pipeline/lib/name-trace.ts):
 *   - a reach is on the line when the name covers at least line.minCoverage of it
 *     (regions/nqn/ign.config.json); the part of a reach inside a HydroLAKES lake is left out
 *     of that share, since IGN draws no line in lakes;
 *   - reaches with less coverage, or none (at most line.maxGap in a row), are kept only
 *     between two reaches on the line; reaches within bufferM of a lake are not counted
 *     (a river crosses its reservoirs and lakes);
 *   - at a fork it follows the IGN line, not the larger area; it never enters another
 *     approved river's mouth;
 *   - the mouth end is never trimmed: leading reaches without the name (a reservoir, no
 *     IGN line) are kept up to the first reach on the line.
 * It ends on the last reach on the line. A `sourceReach` in names.json (with
 * `sourceEvidence`) replaces the trace by the path from that reach down to the mouth; it is
 * for cases the rule cannot see, and the report flags it. The report compares each river
 * with the area trace (largest branch upstream, traceNamedRiver: the candidate stem that
 * pipeline:ign-match votes on) and with the owner's source list (`sourceCheck`).
 *
 * Metrics, all traceable to source fields (per-field provenance in each document):
 *   lengthKm            sum of HydroRIVERS LENGTH_KM along the path
 *   mouth.elevationM    RiverATLAS ele_mt_cmn of the mouth reach (minimum elevation of
 *                       its local catchment, which contains the pour point)
 *   source.elevationM   headwater reach's ele_mt_cmn + that reach's own drop
 *                       (sgr_dk_rav / 10 × LENGTH_KM; the catalog defines sgr_dk_rav as
 *                       the elevation drop along the reach per km, in decimetres per km).
 *                       For a river that ends at a confluence of named rivers, this is
 *                       the confluence elevation (sourceKind = "confluence").
 *   dropM               source.elevationM − mouth.elevationM
 *   (diagnostic)        summed per-reach drops; overstates on flat braided reaches
 *                       (Río Negro: 419 m vs 260 m), so it is only reported
 *   mouth.dischargeM3s  HydroRIVERS DIS_AV_CMS at the mouth reach (modeled 1971–2000)
 *   nonPerennialPct     share of length with GIRES predcat1 = 1 (modeled); with
 *                       regions/<id>/line-flow.config.json (cba) a reach with an IGN
 *                       class (pipeline:line-flow) counts by it instead, as the map draws
 *   watershed.*         RiverATLAS upstream ("u") attributes of the mouth reach, i.e.
 *                       the whole watershed of the river: inu_pc_umn / inu_pc_umx
 *                       (percent), lka_pc_use (percent × 10), pop_ct_usu (thousands)
 *   mouth.regulationPct RiverATLAS dor_pc_pva at the mouth reach (percent × 10, capped
 *                       at 1000 %). Units from RiverATLAS_Catalog_v10.pdf sheets H03,
 *                       H04, H07 and A01.
 *   bbox                [west, south, east, north] of the traced reaches' HydroRIVERS
 *                       geometry (the app fits the map to it)
 *
 * Outputs: data/out/rivers.ndjson (committed; seed input), data/work/named/
 * river_reaches.parquet (reach → river), data/work/named/report.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb, type Row } from "../lib/duckdb";
import { traceNamedRiver, upstreamIndex } from "../lib/graph";
import { hydroLakesBbox } from "../lib/hydrolakes";
import { ALBERS } from "../lib/ign";
import type { MatchConfig } from "../lib/ign-match";
import { requireInput } from "../lib/inputs";
import { type LineFlow, isLineFlow, reachFlows } from "../lib/line-flow";
import { type ReachKind, traceAlongName } from "../lib/name-trace";
import { loadNameSource, nameFile } from "../lib/name-source";
import {
  type NetworkReach,
  mouthKinds,
  overridePaths,
  seaDistance,
  terminalFlowsInto,
} from "../lib/mouth-kind";
import { nameKey, riverSlug } from "../lib/names";
import { regionFile, OUT_DIR, rel, workPath } from "../lib/paths";
import { isReferenceRegion } from "../lib/region-mode";
import { MOUTH_KINDS } from "../../lib/data/mouth";
import { writeReport } from "../lib/report";

/** Summed drop vs source − mouth differences above this are listed for review. */
const ELEVATION_CHECK_M = 100;
/** A reach at least this share inside lakes has no meaningful IGN coverage (all lake). */
const ALL_LAKE = 0.999;
/** Lakes reported near a river's source, up to this distance (metres). */
const SOURCE_LAKE_REPORT_M = 1500;

/** The owner's expectation for where a river starts (owner, 2026-10-09), checked in the report. */
type SourceCheck = { evidence: string } & (
  { lakeOutlet: number[] } | { notCutAtLake: true } | { confluence: string[] }
);

interface NameEntry {
  name: string;
  shortName: string;
  type: string;
  /** Fixed river id; defaults to the slug of shortName. */
  slug?: string;
  /** Former names that search still finds. */
  aliases?: string[];
  mouthReach: number;
  confidence: "strong" | "weak";
  evidence: string;
  /** Override: the river starts at this reach (path down to the mouth), with evidence. */
  sourceReach?: number;
  sourceEvidence?: string;
  sourceCheck?: SourceCheck;
}

const round = (x: number, digits = 1) => Number(x.toFixed(digits));

const PROVENANCE = {
  lengthKm:
    "HydroRIVERS v1.0 LENGTH_KM, summed along the traced path (the reaches along the river's IGN line, pipeline:named)",
  "mouth.elevationM":
    "RiverATLAS v1.0 ele_mt_cmn of the mouth reach (EarthEnv-DEM90)",
  "source.elevationM":
    "RiverATLAS v1.0 ele_mt_cmn of the source reach + its drop (sgr_dk_rav / 10 × LENGTH_KM) (EarthEnv-DEM90)",
  dropM: "source.elevationM − mouth.elevationM",
  gradientMPerKm: "dropM / lengthKm",
  "mouth.dischargeM3s":
    "HydroRIVERS v1.0 DIS_AV_CMS at the mouth reach; modeled natural long-term average 1971–2000 (WaterGAP), does not reflect dam regulation",
  "mouth.uplandKm2": "HydroRIVERS v1.0 UPLAND_SKM at the mouth reach",
  "mouth.distanceToSeaKm": "HydroRIVERS v1.0 DIST_DN_KM at the mouth reach",
  "mouth.strahler": "HydroRIVERS v1.0 ORD_STRA at the mouth reach",
  nonPerennialPct:
    "GIRES v1.0 predcat1 = 1 (modeled, ≥ 1 no-flow day per year), share of lengthKm; reaches without a prediction are counted in unknownPct",
  "watershed.floodedMinPct":
    "RiverATLAS v1.0 inu_pc_umn at the mouth reach: mean annual minimum inundation extent of the upstream watershed, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  "watershed.floodedMaxPct":
    "RiverATLAS v1.0 inu_pc_umx at the mouth reach: mean annual maximum inundation extent of the upstream watershed, GIEMS-D15 (satellite, 1993–2004, downscaled)",
  "watershed.lakesPct":
    "RiverATLAS v1.0 lka_pc_use / 10 at the mouth reach: percent lake area of the upstream watershed (HydroLAKES)",
  "watershed.population":
    "RiverATLAS v1.0 pop_ct_usu × 1000 at the mouth reach: population of the upstream watershed, GPWv4 estimate for 2010",
  "mouth.regulationPct":
    "RiverATLAS v1.0 dor_pc_pva / 10 at the mouth reach: degree of regulation, reservoir storage of GRanD v1.1 dams upstream as a percent of the modeled natural annual flow (capped at 1000 %)",
  bbox: "HydroRIVERS v1.0 geometry extent of the traced reaches",
  // `name` is added per region in main() (lib/name-source.ts).
};

/** Provenance that differs in a reference region (R3.7): sinks have no distance to the sea. */
const REFERENCE_PROVENANCE = {
  "mouth.distanceToSeaKm":
    "HydroRIVERS v1.0 DIST_DN_KM at the mouth reach; null when the flow path ends in an endorheic sink (it would measure the distance to the sink, not to the sea) or crosses a link of regions/<id>/network-overrides.json (it would measure to the end HydroRIVERS had, and the link is not a channel)",
  mouthKind:
    "End of the flow path from the mouth reach along NEXT_DOWN (pipeline:rivers, edited at the region's edge and by network-overrides.json): region-edge = next_down_edit 'outside' (the reach flows on outside the mapped region); sink = HydroRIVERS ENDORHEIC = 1 or the endorheic network; sea otherwise",
};

async function main() {
  const names = (
    JSON.parse(await readFile(regionFile("names.json"), "utf8")) as {
      rivers: NameEntry[];
    }
  ).rivers;
  const cfg = JSON.parse(
    await readFile(regionFile("ign.config.json"), "utf8"),
  ) as MatchConfig & { expectedSeaOutlets?: number };
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const atlasFile = requireInput(workPath("rivers/riveratlas_basin.parquet"));
  // Name coverage per reach, from the step the region's ign.config.json names (namesFrom:
  // pipeline:ign-match or pipeline:line-names); run it before this step.
  const nameSource = await loadNameSource();
  const coverFile = requireInput(nameFile(nameSource, "cover.parquet"));
  const ignFile = requireInput(nameFile(nameSource, "reach_ign.parquet"));
  const reference = await isReferenceRegion();
  const provenance = {
    ...PROVENANCE,
    ...(reference ? REFERENCE_PROVENANCE : {}),
    ...(existsSync(regionFile("line-flow.config.json"))
      ? {
          nonPerennialPct:
            "Share of lengthKm (HydroRIVERS LENGTH_KM) of reaches drawn non-perennial: IGN's mapped class (intermittent) where IGN lines run along the reach's display lines (pipeline:line-flow; FUENTE: Instituto Geográfico Nacional de la República Argentina), else GIRES v1.0 predcat1 = 1 (modeled, ≥ 1 no-flow day per year); reaches with neither are counted in unknownPct",
        }
      : {}),
    name: nameSource.riverNameProvenance,
  };
  const outDir = workPath("named");
  await mkdir(outDir, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  const db = await openDb();

  try {
    const rows = await db.all(`
      SELECT r.HYRIV_ID, r.NEXT_DOWN, r.UPLAND_SKM, r.LENGTH_KM, r.DIST_DN_KM, r.DIS_AV_CMS,
             r.ORD_STRA, r.predcat1, a.ele_mt_cmn, a.sgr_dk_rav,
             a.inu_pc_umn, a.inu_pc_umx, a.lka_pc_use, a.pop_ct_usu, a.dor_pc_pva,
             ST_X(ST_StartPoint(r.geom)) AS start_lon, ST_Y(ST_StartPoint(r.geom)) AS start_lat,
             ST_X(ST_EndPoint(r.geom)) AS end_lon, ST_Y(ST_EndPoint(r.geom)) AS end_lat,
             ST_XMin(r.geom) AS xmin, ST_YMin(r.geom) AS ymin,
             ST_XMax(r.geom) AS xmax, ST_YMax(r.geom) AS ymax
      FROM ${lit(reachesFile)} r JOIN ${lit(atlasFile)} a USING (HYRIV_ID)
      WHERE r.network = 'connected'`);
    const byId = new Map<number, Row>(rows.map((r) => [Number(r.HYRIV_ID), r]));
    // IGN's mapped class per reach (cba, pipeline:line-flow): the panel's non-perennial share
    // then matches the lines the map draws (owner, 2026-10-12).
    const ignFlow = new Map<number, LineFlow>();
    if (existsSync(regionFile("line-flow.config.json"))) {
      const flowRows = await db.all(`
        SELECT l.reach, f.flow, sum(l.length_m) AS length_m
        FROM read_parquet(${lit(requireInput(workPath("lines/lines.parquet")))}) l
        JOIN read_parquet(${lit(requireInput(workPath("line-flow/flow.parquet")))}) f USING (pieceId)
        WHERE l.reach IS NOT NULL GROUP BY ALL`);
      for (const [reach, flow] of reachFlows(
        flowRows.flatMap((r) =>
          isLineFlow(r.flow)
            ? [
                {
                  reach: Number(r.reach),
                  flow: r.flow,
                  lengthM: Number(r.length_m),
                },
              ]
            : [],
        ),
      ))
        ignFlow.set(reach, flow);
    }
    const num = (id: number, field: string) => Number(byId.get(id)?.[field]);
    const index = upstreamIndex(
      rows.map((r) => ({
        id: Number(r.HYRIV_ID),
        nextDown: Number(r.NEXT_DOWN),
      })),
    );

    // Reference regions (cba): where the water of each reach ends, from the edited flow
    // network of pipeline:rivers. Absent for nqn, whose output stays as it was.
    const network = reference
      ? (
          await db.all(`
            SELECT HYRIV_ID, NEXT_DOWN, next_down_edit, ENDORHEIC, network
            FROM ${lit(reachesFile)}`)
        ).map((r): NetworkReach => ({
          id: Number(r.HYRIV_ID),
          nextDown: Number(r.NEXT_DOWN),
          nextDownEdit:
            r.next_down_edit == null ? null : String(r.next_down_edit),
          endorheic: Number(r.ENDORHEIC) === 1,
          network: String(r.network),
        }))
      : null;
    const kinds = network ? mouthKinds(network) : null;
    // Paths across a network-overrides link have no sourced distance to the sea.
    const overridden = network ? overridePaths(network) : new Set<number>();

    const missingMouths = names
      .filter((n) => !byId.has(n.mouthReach))
      .map((n) => n.name);
    if (missingMouths.length > 0) {
      throw new Error(
        `mouth reach not in the connected network: ${missingMouths.join(", ")}`,
      );
    }
    const slugs = names.map(riverSlug);
    const claimed = new Set(names.map((n) => n.mouthReach));
    const area = (id: number) => num(id, "UPLAND_SKM");

    // Lakes: share of each reach inside HydroLAKES polygons, for reaches within bufferM.
    const lakesFile = await hydroLakesBbox(db);
    const toAlbers = (g: string) =>
      `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
    await db.conn.run(`
      CREATE TABLE lk AS
      SELECT Hylak_id AS hylak_id, ${toAlbers("ST_MakeValid(geom)")} AS g
      FROM read_parquet(${lit(lakesFile)})`);
    await db.conn.run(
      `CREATE TABLE lk_all AS SELECT ST_Union_Agg(g) AS g FROM lk`,
    );
    await db.conn.run(`
      CREATE TABLE ra AS
      SELECT HYRIV_ID, ${toAlbers("geom")} AS g,
             ${toAlbers("ST_StartPoint(geom)")} AS start_a
      FROM ${lit(reachesFile)} WHERE network = 'connected'`);
    const lakeRows = await db.all(`
      SELECT r.HYRIV_ID AS id,
             ST_Length(ST_Intersection(r.g, l.g)) / nullif(ST_Length(r.g), 0) AS share
      FROM ra r, lk_all l WHERE ST_DWithin(r.g, l.g, ${cfg.bufferM})`);
    const lakeShare = new Map(
      lakeRows.map((r) => [Number(r.id), Number(r.share ?? 0)]),
    );

    // Coverage of each river's own IGN name.
    const keyOf = new Map(names.map((n, i) => [slugs[i]!, nameKey(n.name)]));
    const coverRows = await db.all(`
      SELECT HYRIV_ID AS id, name_key, coverage FROM read_parquet(${lit(coverFile)})
      WHERE name_key IN (${[...new Set(keyOf.values())].map(lit).join(",")})`);
    const coverage = new Map(
      coverRows.map((r) => [`${r.id}|${r.name_key}`, Number(r.coverage)]),
    );
    const shownRows = await db.all(`
      SELECT HYRIV_ID AS id, name_key FROM read_parquet(${lit(ignFile)}) WHERE display`);
    const shownKey = new Map(
      shownRows.map((r) => [Number(r.id), String(r.name_key)]),
    );

    // The share of a reach the IGN line can cover: its part outside lakes.
    const lineCoverage = (id: number, key: string) => {
      const c = coverage.get(`${id}|${key}`) ?? 0;
      const share = lakeShare.get(id) ?? 0;
      return share >= ALL_LAKE ? c : Math.min(1, c / (1 - share));
    };
    const kindFor =
      (mouth: number, key: string) =>
      (id: number): ReachKind => {
        if (id !== mouth && claimed.has(id)) return "blocked";
        const c = lineCoverage(id, key);
        if (c >= cfg.line.minCoverage) return "strong";
        if (c >= cfg.low.minCoverage) return "weak";
        return lakeShare.has(id) ? "lake" : "gap";
      };
    /** Path from `source` down to `mouth` along NEXT_DOWN, mouth first. */
    const pathDown = (source: number, mouth: number, slug: string) => {
      const path = [source];
      for (let id = source; id !== mouth;) {
        id = num(id, "NEXT_DOWN");
        if (!byId.has(id) || path.length > byId.size)
          throw new Error(
            `${slug}: sourceReach ${source} does not drain to the mouth`,
          );
        if (id !== mouth && claimed.has(id))
          throw new Error(
            `${slug}: sourceReach ${source} crosses another river's mouth ${id}`,
          );
        path.push(id);
      }
      return path.reverse();
    };

    const riverOf = new Map<number, string>();
    const overlaps: { reach: number; rivers: string[] }[] = [];
    const traced = names.map((n, i) => {
      const slug = slugs[i]!;
      const key = keyOf.get(slug)!;
      const areaPath = traceNamedRiver(index, area, n.mouthReach, claimed);
      if (n.sourceReach !== undefined && !n.sourceEvidence?.trim())
        throw new Error(`${slug}: sourceReach needs sourceEvidence`);
      const path =
        n.sourceReach !== undefined
          ? pathDown(n.sourceReach, n.mouthReach, slug)
          : traceAlongName(
              n.mouthReach,
              {
                upstream: (id) => index.get(id) ?? [],
                kind: kindFor(n.mouthReach, key),
                evidence: (id) =>
                  num(id, "LENGTH_KM") * (coverage.get(`${id}|${key}`) ?? 0),
                area,
              },
              { maxGap: cfg.line.maxGap, unlimitedLeadingGap: true },
            ).path;
      for (const id of path) {
        const other = riverOf.get(id);
        if (other) overlaps.push({ reach: id, rivers: [other, slug] });
        else riverOf.set(id, slug);
      }
      return { n, slug, key, path, areaPath };
    });

    // Lakes near each source reach's upstream end (for the source kind and the report).
    const sourceIds = traced.map((t) => t.path[t.path.length - 1]!);
    const nearRows = await db.all(`
      SELECT r.HYRIV_ID AS id, l.hylak_id, ST_Distance(r.start_a, l.g) AS d
      FROM ra r JOIN lk l ON ST_DWithin(r.start_a, l.g, ${SOURCE_LAKE_REPORT_M})
      WHERE r.HYRIV_ID IN (${sourceIds.join(",")})
      ORDER BY d, l.hylak_id`);
    const lakesNear = new Map<
      number,
      { hylakId: number; distanceM: number }[]
    >();
    for (const r of nearRows) {
      const list = lakesNear.get(Number(r.id)) ?? [];
      list.push({
        hylakId: Number(r.hylak_id),
        distanceM: Math.round(Number(r.d)),
      });
      lakesNear.set(Number(r.id), list);
    }
    const atLake = (id: number) =>
      (lakesNear.get(id) ?? []).filter((l) => l.distanceM <= cfg.bufferM);

    // Receiving water: the first approved-river reach downstream of the mouth. Since rivers
    // are trimmed to their IGN line, a mouth can drain into reaches on no river (a lake the
    // trimmed river no longer crosses, or IGN's own name running on below an approved
    // mouth); those are walked through and reported.
    // A river that joins no other approved river ends in the sea ("sea", the only case in
    // nqn) or, in a reference region (R3.7), in a sink or at the region's edge: the kind of
    // the terminal reach of the walk (lib/mouth-kind.ts).
    const receiving = (mouth: number) => {
      const between: number[] = [];
      let last = mouth;
      for (let id = num(mouth, "NEXT_DOWN"); ; id = num(id, "NEXT_DOWN")) {
        if (id === 0)
          return { flowsInto: terminalFlowsInto(kinds?.get(last)), between };
        const river = riverOf.get(id);
        if (river) return { flowsInto: river, between };
        if (!byId.has(id) || between.length > byId.size)
          return { flowsInto: "unnamed", between };
        between.push(id);
        last = id;
      }
    };
    const throughUnnamed = traced.flatMap(({ n, slug, key }) => {
      const { flowsInto, between } = receiving(n.mouthReach);
      if (between.length === 0) return [];
      const names = [...new Set(between.map((id) => shownKey.get(id) ?? null))];
      return [
        {
          river: slug,
          flowsInto,
          reaches: between.length,
          km: round(between.reduce((s, id) => s + num(id, "LENGTH_KM"), 0)),
          inOrNearLakes: between.filter((id) => lakeShare.has(id)).length,
          ignNames: names,
          // IGN's own name runs on below the approved mouth: the mouth may be too high.
          ownNameBelowMouth: names.includes(key),
        },
      ];
    });

    const elevationWarnings: Record<string, unknown>[] = [];
    const docs = traced.map(({ n, slug, path }) => {
      const mouth = path[0]!;
      const head = path[path.length - 1]!;
      const lengthKm = path.reduce((s, id) => s + num(id, "LENGTH_KM"), 0);
      const dropOf = (id: number) =>
        (num(id, "sgr_dk_rav") / 10) * num(id, "LENGTH_KM");
      const mouthElevation = num(mouth, "ele_mt_cmn");
      const sourceElevation = num(head, "ele_mt_cmn") + dropOf(head);
      const dropM = sourceElevation - mouthElevation;
      const summedDropM = path.reduce((s, id) => s + dropOf(id), 0);
      if (Math.abs(summedDropM - dropM) > ELEVATION_CHECK_M) {
        elevationWarnings.push({
          river: slug,
          dropM: Math.round(dropM),
          summedDropM: Math.round(summedDropM),
        });
      }
      // A trace ends at a headwater, at a lake outlet (its upstream end within bufferM of a
      // lake), or at a HydroRIVERS confluence (where the IGN name ends, or every branch is
      // another named river).
      const sourceKind =
        (index.get(head) ?? []).length === 0
          ? "headwater"
          : atLake(head).length > 0
            ? "lake"
            : "confluence";
      const lengthWhere = (pred: (r: Row) => boolean) =>
        path
          .filter((id) => pred(byId.get(id)!))
          .reduce((s, id) => s + num(id, "LENGTH_KM"), 0);
      const ign = (r: Row) => ignFlow.get(Number(r.HYRIV_ID));
      const nonPerennialKm = lengthWhere((r) =>
        ign(r)
          ? ign(r) === "intermittent"
          : Number(r.predcat1) === 1 && r.predcat1 !== null,
      );
      const unknownKm = lengthWhere((r) => !ign(r) && r.predcat1 === null);
      // Modeled unless every reach has IGN's mapped class.
      const giresKm = lengthWhere((r) => !ign(r));
      const { flowsInto } = receiving(mouth);
      const mouthKind = kinds?.get(mouth);
      const m = byId.get(mouth)!;
      const extent = (field: string, pick: (...v: number[]) => number) =>
        round(pick(...path.map((id) => num(id, field))), 5);
      const h = byId.get(head)!;
      return {
        _id: slug,
        name: n.name,
        shortName: n.shortName,
        type: n.type,
        aliases: n.aliases ?? [],
        nameConfidence: n.confidence,
        flowsInto,
        ...(mouthKind ? { mouthKind } : {}),
        mouthReach: mouth,
        sourceReach: head,
        reachCount: path.length,
        lengthKm: round(lengthKm),
        dropM: Math.round(dropM),
        gradientMPerKm: round(dropM / lengthKm, 2),
        mouth: {
          lat: round(Number(m.end_lat), 5),
          lon: round(Number(m.end_lon), 5),
          elevationM: mouthElevation,
          dischargeM3s: round(Number(m.DIS_AV_CMS), 1),
          uplandKm2: round(Number(m.UPLAND_SKM)),
          // DIST_DN_KM measures to the end of the HydroRIVERS path: for a sink that is the
          // sink, and across an override link the end HydroRIVERS had (lib/mouth-kind.ts).
          distanceToSeaKm: reference
            ? (() => {
                const d = seaDistance(
                  mouthKind,
                  overridden.has(mouth),
                  Number(m.DIST_DN_KM),
                );
                return d === null ? null : round(d);
              })()
            : round(Number(m.DIST_DN_KM)),
          strahler: Number(m.ORD_STRA),
          regulationPct: round(Number(m.dor_pc_pva) / 10),
        },
        watershed: {
          floodedMinPct: Number(m.inu_pc_umn),
          floodedMaxPct: Number(m.inu_pc_umx),
          lakesPct: round(Number(m.lka_pc_use) / 10),
          population: Math.round(Number(m.pop_ct_usu) * 1000),
        },
        source: {
          kind: sourceKind,
          lat: round(Number(h.start_lat), 5),
          lon: round(Number(h.start_lon), 5),
          elevationM: Math.round(sourceElevation),
        },
        bbox: [
          extent("xmin", Math.min),
          extent("ymin", Math.min),
          extent("xmax", Math.max),
          extent("ymax", Math.max),
        ],
        nonPerennialPct: round((nonPerennialKm / lengthKm) * 100),
        unknownPct: round((unknownKm / lengthKm) * 100),
        modeled: [
          "mouth.dischargeM3s",
          "mouth.regulationPct",
          ...(giresKm > 0 ? ["nonPerennialPct"] : []),
          "watershed.floodedMinPct",
          "watershed.floodedMaxPct",
          "watershed.population",
        ],
        provenance,
      };
    });

    // Reach → river mapping for tiles and the rivers panel.
    const mappingRows = traced.flatMap(({ slug, path }) =>
      path.map((id, order) => `(${id}, '${slug}', ${order})`),
    );
    const mappingFile = `${outDir}/river_reaches.parquet`;
    await db.conn.run(`
      COPY (SELECT * FROM (VALUES ${mappingRows.join(",")}) AS t(HYRIV_ID, river, path_order))
      TO ${lit(mappingFile)} (FORMAT parquet)`);
    const ndjsonFile = `${OUT_DIR}/rivers.ndjson`;
    await writeFile(
      ndjsonFile,
      docs.map((d) => JSON.stringify(d)).join("\n") + "\n",
    );

    // Trace against the area trace, and the owner's source list.
    const kmOf = (ids: number[]) =>
      round(ids.reduce((s, id) => s + num(id, "LENGTH_KM"), 0));
    const trace = traced.map(({ n, slug, key, path, areaPath }) => {
      const head = path[path.length - 1]!;
      const kind = kindFor(n.mouthReach, key);
      const firstOnLine = path.findIndex((id) => kind(id) === "strong");
      return {
        id: slug,
        areaTrace: {
          lengthKm: kmOf(areaPath),
          reaches: areaPath.length,
          sourceReach: areaPath[areaPath.length - 1],
        },
        lengthKm: kmOf(path),
        reaches: path.length,
        sourceReach: head,
        sourceOnTheLine: kind(head) === "strong",
        // Reaches kept at the mouth before the first reach on the line (never trimmed).
        leadingWithoutLine: firstOnLine === -1 ? path.length : firstOnLine,
        trimmedKm: round(kmOf(areaPath) - kmOf(path)),
        lakesAtSource: lakesNear.get(head) ?? [],
        override:
          n.sourceReach !== undefined
            ? { sourceReach: n.sourceReach, evidence: n.sourceEvidence }
            : null,
      };
    });
    // An approved river's reaches count with its name in a confluence check, even where the
    // reach shows no name (an ambiguous reach right above a confluence).
    const riverKeyOf = new Map<number, string>();
    for (const { n, path } of traced)
      for (const id of path) riverKeyOf.set(id, nameKey(n.name));
    const sourceList = traced
      .filter(({ n }) => n.sourceCheck)
      .map(({ n, slug, path }) => {
        const c = n.sourceCheck!;
        const head = path[path.length - 1]!;
        const lakes = atLake(head);
        let expected: string;
        let agrees: boolean;
        if ("lakeOutlet" in c) {
          expected = `outlet of HydroLAKES ${c.lakeOutlet.join(" or ")}`;
          agrees = lakes.some((l) => c.lakeOutlet.includes(l.hylakId));
        } else if ("notCutAtLake" in c) {
          expected = "not cut at a lake";
          agrees = lakes.length === 0;
        } else {
          expected = `confluence of ${c.confluence.join(" and ")}`;
          const upKeys = new Set(
            (index.get(head) ?? []).flatMap((id) => [
              shownKey.get(id),
              riverKeyOf.get(id),
            ]),
          );
          agrees = c.confluence.every((name) => upKeys.has(nameKey(name)));
        }
        return {
          river: slug,
          expected,
          sourceReach: head,
          lakesWithinBufferM: lakes,
          agrees,
          byOverride: n.sourceReach !== undefined,
          evidence: c.evidence,
        };
      });

    const checks = {
      uniqueSlugs: new Set(slugs).size === slugs.length,
      noOverlappingReaches: overlaps.length === 0,
      everyRiverFlowsIntoNamedOrSea: docs.every(
        (d) => d.flowsInto !== "unnamed",
      ),
      // nqn has one outlet (the Río Negro). A region with several drainage systems says how
      // many rivers end in none of the others in ign.config.json "expectedSeaOutlets".
      // (In a reference region a river that joins no other ends in a sink or at the region's
      // edge as well as at the sea; all of them count.)
      oneRiverReachesTheSea:
        docs.filter((d) =>
          (MOUTH_KINDS as readonly string[]).includes(d.flowsInto),
        ).length === (cfg.expectedSeaOutlets ?? 1),
      // The IGN line rule: every river (without an override) ends on a reach on its line.
      everySourceOnTheLine: trace.every(
        (t) => t.override !== null || t.sourceOnTheLine,
      ),
      mouthsKept: traced.every(({ n, path }) => path[0] === n.mouthReach),
      ownerSourceListAgrees: sourceList.every((x) => x.agrees),
    };
    await writeReport("named", {
      ok: Object.values(checks).every(Boolean),
      checks,
      rivers: docs.map((d) => ({
        id: d._id,
        flowsInto: d.flowsInto,
        lengthKm: d.lengthKm,
        reaches: d.reachCount,
        mouthElevationM: d.mouth.elevationM,
        sourceElevationM: d.source.elevationM,
        dischargeM3s: d.mouth.dischargeM3s,
        nonPerennialPct: d.nonPerennialPct,
        regulationPct: d.mouth.regulationPct,
        population: d.watershed.population,
      })),
      namedKm: round(docs.reduce((s, d) => s + d.lengthKm, 0)),
      // Reference regions only: where each river's water ends (R3.7).
      ...(kinds
        ? {
            mouthKinds: Object.fromEntries(
              docs.map((d) => [
                d._id,
                { flowsInto: d.flowsInto, mouthKind: d.mouthKind },
              ]),
            ),
          }
        : {}),
      line: cfg.line,
      trace,
      ownerSourceList: sourceList,
      throughUnnamedToReceivingRiver: throughUnnamed,
      // Rivers that need a sourceReach override, or disagree with the owner's list.
      flagged: [
        ...trace
          .filter((t) => t.override !== null)
          .map((t) => ({
            river: t.id,
            reason: "sourceReach override",
            ...t.override,
          })),
        ...sourceList
          .filter((x) => !x.agrees)
          .map((x) => ({ river: x.river, reason: `disagrees: ${x.expected}` })),
        ...throughUnnamed
          .filter((x) => x.ownNameBelowMouth)
          .map((x) => ({
            river: x.river,
            reason: `its IGN name continues ${x.km} km below the approved mouth reach, on no river`,
          })),
      ],
      overlaps: overlaps.slice(0, 20),
      elevationWarnings,
      outputs: [rel(ndjsonFile), rel(mappingFile)],
    });
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
