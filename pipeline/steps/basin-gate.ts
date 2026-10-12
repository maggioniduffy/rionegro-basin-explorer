/**
 * pipeline:basin-gate — which basins should a region include? (R2 gate, regions/<id>/README.md).
 * Read-only measurement; nothing here feeds the app except lev12_groups.parquet, the
 * HydroBASINS level-12 → reference basin assignment that the region's basin step will reuse.
 *
 * Inputs: regions/<id>/gate.config.json; the province polygon (IGN), the reference basins and
 * subbasins (APRHI, Shapefiles in zips), HydroBASINS level 12 and HydroRIVERS (South America).
 *
 * Method, per reference basin (all areas in South America Albers, ESRI:102033):
 *  - each level-12 polygon joins the reference basin holding the largest share of its area, if
 *    that share is at least assignMinShare (ties: lowest code); the rest stay unassigned;
 *  - agreement: IoU of the reference polygon with the union of its level-12 polygons, the part
 *    of the reference not covered, and the part of the level-12 union outside it. Level-12
 *    polygons tile the plane, so the intersection is the sum of the per-polygon overlaps;
 *  - roots: the terminal polygons of the group (NEXT_DOWN = 0 or pointing outside), with where
 *    each drains (sea, endorheic sink, virtual-sink link, or into another group). The SUB_AREA
 *    upstream of the roots but outside the group shows where the reference outline cuts a
 *    HydroBASINS drainage;
 *  - HydroRIVERS: reaches whose HYBAS_L12 is in the group, and its largest exit reaches;
 *  - the province: how much of it the assigned polygons cover;
 *  - the reference subbasins: the same assignment among level-12 polygons inside the province,
 *    and the IoU of each subbasin with its level-12 union.
 * HydroATLAS/HydroRIVERS discharge (DIS_AV_CMS) is a modeled 1971–2000 natural average.
 *
 * Outputs in data/work/<region>/basin-gate/: report.json, lev12_groups.parquet,
 * groups.geojson (dissolved level-12 union per basin, for viewing).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type Row, lit, openDb } from "../lib/duckdb";
import {
  type Assignment,
  type Box,
  type Overlap,
  assignLargestShare,
  boxInside,
  findRoots,
  iou,
  median,
  splitRootsByUpArea,
  sumByGroup,
  upstreamOutside,
} from "../lib/basin-gate";
import { areaAlbersKm2, envelope, pctDiff } from "../lib/geo";
import { upstreamIndex } from "../lib/graph";
import { INPUTS, requireInput } from "../lib/inputs";
import { rawPath, regionFile, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface LayerConfig {
  path: string;
  srs: string;
  encoding?: string;
  codeField: string;
  nameField: string;
  source: string;
}

interface GateConfig {
  province: {
    path: string;
    srs: string;
    encoding?: string;
    nameField: string;
    name: string;
  };
  referenceBasins: LayerConfig;
  referenceSubbasins: LayerConfig;
  searchBbox: Box;
  assignMinShare: number;
}

/** Roots with at least this UP_AREA (km²) are listed one by one. */
const ROOT_MIN_UP_AREA_KM2 = 100;
const TOP_EXITS = 3;
const TOP_OUTSIDE_GROUPS = 3;
/** Checks. */
const NO_OVERLAP_TOLERANCE_PCT = 0.1;
const SUB_AREA_TOLERANCE_PCT = 2;
const MIN_PROVINCE_COVERED_PCT = 98;
const LOW_IOU = 0.6;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const r1 = (v: number) => round(v, 1);
const r3 = (v: number) => round(v, 3);
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);
const sum = (xs: Iterable<number>) => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

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
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;

async function main() {
  const configFile = regionFile("gate.config.json");
  if (!existsSync(configFile))
    throw new Error(
      `${rel(configFile)} missing; the R2 gate needs it (see the region's README)`,
    );
  const config = JSON.parse(await readFile(configFile, "utf8")) as GateConfig;
  const { searchBbox, assignMinShare } = config;
  const levFile = requireInput(INPUTS.hydroBasins(12));
  const riversFile = requireInput(INPUTS.hydroRivers);
  const provinceSrc = source(config.province.path);
  const basinsSrc = source(config.referenceBasins.path);
  const subbasinsSrc = source(config.referenceSubbasins.path);

  const outDir = workPath("basin-gate");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='8GB'; SET threads=4; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  const bbox = envelope(searchBbox);

  try {
    // 1. Province, reference basins, reference subbasins.
    const pc = config.province;
    await db.conn.run(`
      CREATE TABLE prov AS
      SELECT ${wgs84("geom", pc.srs)} AS geom
      FROM ST_Read(${provinceSrc}${readOptions(pc.encoding)})
      WHERE ${ident(pc.nameField)} = ${lit(pc.name)}`);
    const [provCount] = await db.all(`SELECT count(*) AS n FROM prov`);
    if (num(provCount?.n) !== 1)
      throw new Error(
        `expected exactly one province feature with ${pc.nameField} = '${pc.name}', found ${num(provCount?.n)}`,
      );

    const rb = config.referenceBasins;
    await db.conn.run(`
      CREATE TABLE refb AS
      SELECT ${ident(rb.codeField)}::VARCHAR AS code, ${ident(rb.nameField)}::VARCHAR AS name,
             ${wgs84("geom", rb.srs)} AS geom
      FROM ST_Read(${basinsSrc}${readOptions(rb.encoding)})`);
    const rs = config.referenceSubbasins;
    await db.conn.run(`
      CREATE TABLE refs AS
      SELECT lpad(row_number() OVER (ORDER BY ${ident(rs.codeField)}, ${ident(rs.nameField)})::VARCHAR, 2, '0') AS id,
             ${ident(rs.codeField)}::VARCHAR AS code, ${ident(rs.nameField)}::VARCHAR AS name,
             ${wgs84("geom", rs.srs)} AS geom
      FROM ST_Read(${subbasinsSrc}${readOptions(rs.encoding)})`);
    await db.conn.run(
      `CREATE TABLE refu AS SELECT ST_Union_Agg(geom) AS geom FROM refb`,
    );

    const refRows = await db.all(`
      SELECT b.code, b.name, ${areaAlbersKm2("b.geom")} AS area_km2,
             ${areaAlbersKm2("ST_CollectionExtract(ST_Intersection(b.geom, p.geom), 3)")} AS in_prov_km2,
             ST_XMin(b.geom) AS xmin, ST_YMin(b.geom) AS ymin,
             ST_XMax(b.geom) AS xmax, ST_YMax(b.geom) AS ymax
      FROM refb b, prov p ORDER BY b.code`);
    const [refTotals] = await db.all(`
      SELECT (SELECT sum(${areaAlbersKm2("geom")}) FROM refb) AS summed_km2,
             ${areaAlbersKm2("u.geom")} AS union_km2,
             ${areaAlbersKm2("ST_CollectionExtract(ST_Intersection(u.geom, p.geom), 3)")} AS union_in_prov_km2,
             ${areaAlbersKm2("p.geom")} AS province_km2
      FROM refu u, prov p`);
    const provinceKm2 = num(refTotals?.province_km2);
    const codes = refRows.map((r) => str(r.code));
    log(`${codes.length} reference basins, province ${r1(provinceKm2)} km²`);

    // 2. HydroBASINS level 12 in the search box, and those near the reference or province.
    log("reading HydroBASINS level 12…");
    await db.conn.run(`
      CREATE TABLE lev AS
      SELECT HYBAS_ID, NEXT_DOWN, NEXT_SINK, MAIN_BAS, SUB_AREA, UP_AREA, ENDO, COAST, geom,
             ST_X(ST_Centroid(geom)) AS lon, ST_Y(ST_Centroid(geom)) AS lat
      FROM ST_Read(${lit(levFile)}) WHERE ST_Intersects(geom, ${bbox})`);
    await db.conn.run(`
      CREATE TABLE lev_keep AS
      SELECT l.HYBAS_ID, l.SUB_AREA, l.ENDO, l.geom, ${areaAlbersKm2("l.geom")} AS area_km2,
             CASE WHEN ST_Intersects(l.geom, p.geom)
                  THEN ${areaAlbersKm2("ST_CollectionExtract(ST_Intersection(l.geom, p.geom), 3)")}
                  ELSE 0 END AS in_prov_km2
      FROM lev l, prov p, refu u
      WHERE ST_Intersects(l.geom, p.geom) OR ST_Intersects(l.geom, u.geom)`);
    log("overlaps with reference basins…");
    await db.conn.run(`
      CREATE TABLE ov AS
      SELECT * FROM (
        SELECT l.HYBAS_ID, r.code,
               ${areaAlbersKm2("ST_CollectionExtract(ST_Intersection(l.geom, r.geom), 3)")} AS km2
        FROM lev_keep l JOIN refb r ON ST_Intersects(l.geom, r.geom)) WHERE km2 > 0`);
    log("overlaps with reference subbasins…");
    await db.conn.run(`
      CREATE TABLE ov_sub AS
      SELECT * FROM (
        SELECT l.HYBAS_ID, s.id AS code,
               ${areaAlbersKm2("ST_CollectionExtract(ST_Intersection(l.geom, s.geom), 3)")} AS km2
        FROM lev_keep l JOIN refs s ON ST_Intersects(l.geom, s.geom)
        WHERE l.in_prov_km2 > 0) WHERE km2 > 0`);

    const levCount = num((await db.all(`SELECT count(*) AS n FROM lev`))[0]?.n);
    const keep = (
      await db.all(`
      SELECT HYBAS_ID, SUB_AREA, ENDO, area_km2, in_prov_km2 FROM lev_keep ORDER BY HYBAS_ID`)
    ).map((r) => ({
      id: str(r.HYBAS_ID),
      subArea: num(r.SUB_AREA),
      endo: num(r.ENDO),
      areaKm2: num(r.area_km2),
      inProvKm2: num(r.in_prov_km2),
    }));
    const overlapsOf = (rows: Row[]) => {
      const m = new Map<string, Overlap[]>();
      for (const r of rows) {
        const id = str(r.HYBAS_ID);
        const list = m.get(id);
        const o = { key: str(r.code), km2: num(r.km2) };
        if (list) list.push(o);
        else m.set(id, [o]);
      }
      return m;
    };
    const ovBasins = overlapsOf(
      await db.all(`SELECT HYBAS_ID, code, km2 FROM ov`),
    );
    const ovSubs = overlapsOf(
      await db.all(`SELECT HYBAS_ID, code, km2 FROM ov_sub`),
    );

    // 3. Assignment (pure function in lib/basin-gate.ts).
    const assigned = new Map<string, Assignment>();
    for (const p of keep)
      assigned.set(
        p.id,
        assignLargestShare(ovBasins.get(p.id) ?? [], p.areaKm2, assignMinShare),
      );
    const codeOf = (id: string) => assigned.get(id)?.key ?? null;
    const members = new Map<string, string[]>(codes.map((c) => [c, []]));
    for (const p of keep) {
      const c = codeOf(p.id);
      if (c !== null) members.get(c)?.push(p.id);
    }
    const keepById = new Map(keep.map((p) => [p.id, p]));

    await db.conn.run(`
      CREATE TABLE grp (HYBAS_ID BIGINT, code VARCHAR, share DOUBLE,
                        areaKm2 DOUBLE, inProvinceKm2 DOUBLE)`);
    for (let i = 0; i < keep.length; i += 1000) {
      const values = keep
        .slice(i, i + 1000)
        .map((p) => {
          const a = assigned.get(p.id) as Assignment;
          return `(${BigInt(p.id)}, ${a.key === null ? "NULL" : lit(a.key)}, ${a.share}, ${p.areaKm2}, ${p.inProvKm2})`;
        })
        .join(", ");
      await db.conn.run(`INSERT INTO grp VALUES ${values}`);
    }
    const groupsFile = `${outDir}/lev12_groups.parquet`;
    await db.conn.run(
      `COPY (SELECT * FROM grp ORDER BY HYBAS_ID) TO ${lit(groupsFile)} (FORMAT parquet)`,
    );

    // 4. The level-12 graph over every polygon in the box (not only the kept ones).
    const links = (
      await db.all(
        `SELECT HYBAS_ID, NEXT_DOWN, ENDO, UP_AREA, SUB_AREA, lon, lat FROM lev`,
      )
    ).map((r) => ({
      id: str(r.HYBAS_ID),
      nextDown: str(r.NEXT_DOWN),
      endo: num(r.ENDO),
      upArea: num(r.UP_AREA),
      subArea: num(r.SUB_AREA),
      lon: num(r.lon),
      lat: num(r.lat),
    }));
    const linkById = new Map(links.map((l) => [l.id, l]));
    const index = upstreamIndex(
      links.map((l) => ({ id: l.id, nextDown: l.nextDown })),
    );

    // 5. HydroRIVERS reaches in the box, joined to the assignment.
    log("reading HydroRIVERS…");
    await db.conn.run(`
      CREATE TABLE riv AS
      SELECT r.HYRIV_ID, r.NEXT_DOWN, r.LENGTH_KM, r.UPLAND_SKM, r.DIS_AV_CMS, r.ORD_STRA,
             r.ENDORHEIC, g.code, ST_X(ST_EndPoint(r.geom)) AS lon, ST_Y(ST_EndPoint(r.geom)) AS lat
      FROM (SELECT * FROM ST_Read(${lit(riversFile)}) WHERE ST_Intersects(geom, ${bbox})) r
      JOIN grp g ON g.HYBAS_ID = r.HYBAS_L12
      WHERE g.code IS NOT NULL`);
    const rivTotals = await db.all(`
      SELECT code, count(*) AS reaches, sum(LENGTH_KM) AS km,
             coalesce(sum(LENGTH_KM) FILTER (ENDORHEIC = 1), 0) AS endorheic_km
      FROM riv GROUP BY code`);
    const rivExits = await db.all(`
      SELECT * FROM (
        SELECT r.code, r.HYRIV_ID, r.UPLAND_SKM, r.DIS_AV_CMS, r.ORD_STRA, r.lon, r.lat,
               CASE WHEN r.NEXT_DOWN = 0 THEN 'terminal' ELSE 'leaves-group' END AS kind,
               row_number() OVER (PARTITION BY r.code ORDER BY r.UPLAND_SKM DESC, r.HYRIV_ID) AS rn
        FROM riv r LEFT JOIN riv n ON n.HYRIV_ID = r.NEXT_DOWN
        WHERE r.NEXT_DOWN = 0 OR n.code IS DISTINCT FROM r.code)
      WHERE rn <= ${TOP_EXITS} ORDER BY code, rn`);

    // 6. Per reference basin.
    const rootEndoAll = { "0": 0, "1": 0, "2": 0 } as Record<string, number>;
    const basins = refRows.map((ref) => {
      const code = str(ref.code);
      const ids = members.get(code) ?? [];
      const idSet = new Set(ids);
      const pieces = ids.map((id) => keepById.get(id) as (typeof keep)[number]);
      const aprhiKm2 = num(ref.area_km2);
      const aprhiInProv = num(ref.in_prov_km2);
      const hbKm2 = sum(pieces.map((p) => p.areaKm2));
      const inter = sum(
        ids.map(
          (id) => ovBasins.get(id)?.find((o) => o.key === code)?.km2 ?? 0,
        ),
      );
      const endo = Object.fromEntries(
        [0, 1, 2].map((e) => {
          const ps = pieces.filter((p) => p.endo === e);
          return [
            e,
            { count: ps.length, areaKm2: r1(sum(ps.map((p) => p.areaKm2))) },
          ];
        }),
      );

      const roots = findRoots(
        links.map((l) => ({ id: l.id, nextDown: l.nextDown, endo: l.endo })),
        idSet,
        codeOf,
      ).map((r) => {
        const l = linkById.get(r.id) as (typeof links)[number];
        return {
          ...r,
          endo: l.endo,
          upArea: l.upArea,
          subArea: l.subArea,
          lon: l.lon,
          lat: l.lat,
        };
      });
      const { large, small } = splitRootsByUpArea(roots, ROOT_MIN_UP_AREA_KM2);
      const rootEndo = { "0": 0, "1": 0, "2": 0 } as Record<string, number>;
      const rootKinds: Record<string, number> = {};
      for (const r of roots) {
        rootEndo[String(r.endo)] = (rootEndo[String(r.endo)] ?? 0) + 1;
        rootEndoAll[String(r.endo)] = (rootEndoAll[String(r.endo)] ?? 0) + 1;
        rootKinds[r.kind] = (rootKinds[r.kind] ?? 0) + 1;
      }

      const outside = upstreamOutside(
        index,
        roots.map((r) => r.id),
        idSet,
      );
      const subAreaOf = (id: string) => linkById.get(id)?.subArea ?? 0;
      const rv = rivTotals.find((r) => str(r.code) === code);

      return {
        code,
        name: str(ref.name),
        aprhi: {
          areaKm2: r1(aprhiKm2),
          inProvinceKm2: r1(aprhiInProv),
          inProvincePct: pct(aprhiInProv, aprhiKm2),
        },
        hydrobasins: {
          lev12Count: ids.length,
          areaKm2: r1(hbKm2),
          subAreaSumKm2: r1(sum(pieces.map((p) => p.subArea))),
          inProvinceKm2: r1(sum(pieces.map((p) => p.inProvKm2))),
          iou: r3(iou(inter, aprhiKm2, hbKm2)),
          aprhiNotCoveredKm2: r1(aprhiKm2 - inter),
          hydrobasinsOutsideAprhiKm2: r1(hbKm2 - inter),
          endo,
        },
        roots: {
          count: roots.length,
          byKind: rootKinds,
          byEndo: rootEndo,
          large: large.map((r) => ({
            hybasId: Number(r.id),
            kind: r.kind,
            intoCode: r.intoCode,
            endo: r.endo,
            upAreaKm2: r1(r.upArea),
            subAreaKm2: r1(r.subArea),
            lon: round(r.lon, 3),
            lat: round(r.lat, 3),
          })),
          smallerThanKm2: ROOT_MIN_UP_AREA_KM2,
          small: { count: small.count, subAreaKm2: r1(small.subAreaKm2) },
        },
        upstreamOutsideKm2: r1(sum([...outside].map(subAreaOf))),
        upstreamOutsideTop: sumByGroup(
          outside,
          codeOf,
          subAreaOf,
          TOP_OUTSIDE_GROUPS,
        ).map((o) => ({ code: o.code ?? "unassigned", km2: r1(o.km2) })),
        hydroRivers: {
          reaches: num(rv?.reaches),
          km: r1(num(rv?.km)),
          endorheicKm: r1(num(rv?.endorheic_km)),
          exits: rivExits
            .filter((x) => str(x.code) === code)
            .map((x) => ({
              hyrivId: num(x.HYRIV_ID),
              kind: str(x.kind),
              uplandSkm: r1(num(x.UPLAND_SKM)),
              disAvCmsModeled: round(num(x.DIS_AV_CMS), 3),
              ordStra: num(x.ORD_STRA),
              lon: round(num(x.lon), 3),
              lat: round(num(x.lat), 3),
            })),
        },
      };
    });

    // 7. Province coverage.
    const assignedPieces = keep.filter((p) => codeOf(p.id) !== null);
    const unassignedInProv = keep.filter(
      (p) => codeOf(p.id) === null && p.inProvKm2 > 0,
    );
    const coveredKm2 = sum(assignedPieces.map((p) => p.inProvKm2));
    const provinceCoverage = {
      provinceKm2: r1(provinceKm2),
      coveredByAssignedKm2: r1(coveredKm2),
      coveredPct: pct(coveredKm2, provinceKm2),
      unassignedIntersectingProvince: {
        count: unassignedInProv.length,
        inProvinceKm2: r1(sum(unassignedInProv.map((p) => p.inProvKm2))),
      },
      aprhiInterprovincialUnionInProvinceKm2: r1(
        num(refTotals?.union_in_prov_km2),
      ),
    };

    // 8. Subbasins.
    const subRows = await db.all(`
      SELECT id, code, name, ${areaAlbersKm2("geom")} AS area_km2 FROM refs ORDER BY id`);
    const subCandidates = keep.filter((p) => p.inProvKm2 > 0);
    const subAssigned = new Map<string, string[]>(
      subRows.map((s) => [str(s.id), []]),
    );
    let subUnassigned = 0;
    for (const p of subCandidates) {
      const a = assignLargestShare(
        ovSubs.get(p.id) ?? [],
        p.areaKm2,
        assignMinShare,
      );
      if (a.key === null) subUnassigned += 1;
      else subAssigned.get(a.key)?.push(p.id);
    }
    const subResults = subRows.map((s) => {
      const id = str(s.id);
      const ids = subAssigned.get(id) ?? [];
      const unionKm2 = sum(ids.map((x) => keepById.get(x)?.areaKm2 ?? 0));
      const inter = sum(
        ids.map((x) => ovSubs.get(x)?.find((o) => o.key === id)?.km2 ?? 0),
      );
      return {
        code: str(s.code),
        name: str(s.name),
        areaKm2: r1(num(s.area_km2)),
        lev12Count: ids.length,
        iou: r3(iou(inter, num(s.area_km2), unionKm2)),
      };
    });
    const subbasins = {
      count: subResults.length,
      lev12Considered: subCandidates.length,
      lev12Unassigned: subUnassigned,
      medianIou: median(subResults.map((s) => s.iou)),
      iouBelow: LOW_IOU,
      lowIou: subResults
        .filter((s) => s.iou < LOW_IOU)
        .sort((a, b) => a.iou - b.iou),
    };

    // 9. Dissolved groups for viewing.
    const gj = await db.all(`
      SELECT g.code, any_value(b.name) AS name, count(*) AS n,
             ST_AsGeoJSON(ST_Union_Agg(k.geom)) AS geometry
      FROM grp g JOIN lev_keep k USING (HYBAS_ID) JOIN refb b ON b.code = g.code
      WHERE g.code IS NOT NULL GROUP BY g.code ORDER BY g.code`);
    const geojsonFile = `${outDir}/groups.geojson`;
    await writeFile(
      geojsonFile,
      JSON.stringify({
        type: "FeatureCollection",
        features: gj.map((r) => ({
          type: "Feature",
          properties: {
            code: str(r.code),
            name: str(r.name),
            lev12Count: num(r.n),
            source: "HydroBASINS v1c level 12, dissolved per reference basin",
          },
          geometry: JSON.parse(str(r.geometry)),
        })),
      }),
    );

    // 10. Checks.
    const maxShareSum = Math.max(
      0,
      ...keep.map(
        (p) => sum((ovBasins.get(p.id) ?? []).map((o) => o.km2)) / p.areaKm2,
      ),
    );
    const checks = {
      provinceFound: num(provCount?.n) === 1,
      referenceBasinsInsideSearchBbox: refRows.every((r) =>
        boxInside(
          {
            xmin: num(r.xmin),
            ymin: num(r.ymin),
            xmax: num(r.xmax),
            ymax: num(r.ymax),
          },
          searchBbox,
        ),
      ),
      referenceBasinsNoOverlap:
        Math.abs(
          pctDiff(num(refTotals?.summed_km2), num(refTotals?.union_km2)),
        ) <= NO_OVERLAP_TOLERANCE_PCT,
      everyLev12AssignedAtMostOnce:
        assigned.size === keep.length && maxShareSum <= 1.001,
      subAreaAgreesWithPolygonArea: basins.every(
        (b) =>
          b.hydrobasins.areaKm2 === 0 ||
          Math.abs(
            pctDiff(b.hydrobasins.subAreaSumKm2, b.hydrobasins.areaKm2),
          ) <= SUB_AREA_TOLERANCE_PCT,
      ),
      provinceMostlyCovered:
        coveredKm2 / provinceKm2 >= MIN_PROVINCE_COVERED_PCT / 100,
    };
    const ok = Object.values(checks).every(Boolean);

    await writeReport("basin-gate", {
      ok,
      checks,
      config: {
        province: config.province.path,
        referenceBasins: config.referenceBasins.path,
        referenceSubbasins: config.referenceSubbasins.path,
        searchBbox,
        assignMinShare,
      },
      province: {
        name: config.province.name,
        areaKm2: r1(provinceKm2),
        source: "IGN",
      },
      lev12: {
        inSearchBbox: levCount,
        nearReferenceOrProvince: keep.length,
        assigned: assignedPieces.length,
        unassigned: keep.length - assignedPieces.length,
        rootEndoCounts: rootEndoAll,
      },
      aprhiTotals: {
        summedKm2: r1(num(refTotals?.summed_km2)),
        unionKm2: r1(num(refTotals?.union_km2)),
        overlapPct: r3(
          pctDiff(num(refTotals?.summed_km2), num(refTotals?.union_km2)),
        ),
      },
      basins,
      provinceCoverage,
      subbasins,
      notes: [
        "hydrobasins.areaKm2 is the Albers area of the whole level-12 polygons assigned to the basin; aprhi areas are Albers areas of the APRHI polygons.",
        "disAvCmsModeled is the HydroRIVERS modeled natural average discharge for 1971-2000.",
        "A root's intoCode is null when the polygon it drains into is unassigned or outside the search box.",
      ],
      outputs: [groupsFile, geojsonFile].map(rel),
    });
    if (!ok)
      throw new Error(`basin-gate checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
