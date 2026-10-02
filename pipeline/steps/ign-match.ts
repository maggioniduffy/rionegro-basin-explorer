/**
 * pipeline:ign-match — match IGN names to HydroRIVERS reaches, and keep the IGN lines that
 * HydroRIVERS does not draw (Phase 5).
 *
 * Inputs: data/work/ign/lines.parquet (pipeline:ign), the reaches (pipeline:rivers), the
 * named-river mapping (pipeline:named), pipeline/names.json, pipeline/ign.config.json and
 * the hand decisions in pipeline/ign-overrides.json.
 *
 * Matching, in South America Albers (distances approximate to a few percent):
 *  - for each reach and each IGN name, `coverage` is the fraction of the reach within
 *    bufferM of the lines carrying that name (names are compared by nameKey);
 *  - the best name, its lead over the runner-up and the thresholds in ign.config.json give
 *    a confidence tier (pipeline/lib/ign-match.ts); high and medium matches are shown,
 *    low ones go to review.json; overrides are applied last.
 * Approved rivers (names.json): the IGN name is the one covering most of the main stem
 * (stem vote). The report proposes it; names.json holds the approved result (edited by hand).
 * Detail layer: the part of each IGN line farther than bufferM from every reach, in
 * pieces of at least minDetailPieceM. Nothing is invented: pieces carry IGN's name and
 * the length, no hydrology.
 *
 * Outputs in data/work/ign-match/: reach_ign.parquet (one row per reach), detail.parquet,
 * review.json (low-confidence and ambiguous reaches, longest first), report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { lengthSpheroidKm } from "../lib/geo";
import { ALBERS, buildPairs } from "../lib/ign";
import {
  type Candidate,
  type Classified,
  type Confidence,
  type MatchConfig,
  type ReachOverride,
  applyOverride,
  classify,
} from "../lib/ign-match";
import { requireInput } from "../lib/inputs";
import { nameKey, riverSlug } from "../lib/names";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

const num = (v: unknown) => Number(v ?? 0);
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100) : null);
const readJson = async <T>(file: string) =>
  JSON.parse(await readFile(file, "utf8")) as T;

/** Km accounting (near + far vs total length) may differ by this share, from float noise. */
const KM_TOLERANCE = 0.005;
/** Candidates kept per reach in the output and in the review file. */
const TOP_N = 3;

interface Overrides {
  reaches: ReachOverride[];
  riverNames: { river: string; name: string; note: string }[];
}
interface ApprovedRiver {
  name: string;
  shortName: string;
  slug?: string;
}

interface ReachRow {
  id: number;
  /** HYRIV_ID of the reach downstream, 0 at a mouth. */
  nextDown: number;
  river: string | null;
  network: string;
  strahler: number;
  km: number;
  lat: number;
  lon: number;
  cands: (Candidate & { name: string })[];
  result: Classified;
}

async function main() {
  const cfg = await readJson<MatchConfig>(`${ROOT}/pipeline/ign.config.json`);
  const overrides = await readJson<Overrides>(
    `${ROOT}/pipeline/ign-overrides.json`,
  );
  const approved = (
    await readJson<{ rivers: ApprovedRiver[] }>(`${ROOT}/pipeline/names.json`)
  ).rivers.map((r) => ({ ...r, slug: riverSlug(r) }));
  const linesFile = requireInput(workPath("ign/lines.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));

  const outDir = workPath("ign-match");
  await mkdir(outDir, { recursive: true });
  const db = await openDb();
  await db.conn.run(
    `SET memory_limit='8GB'; SET threads=4; SET temp_directory=${lit(`${outDir}/tmp`)}`,
  );
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  try {
    // 1. Inputs in Albers.
    await db.conn.run(`
      CREATE TABLE ign_a AS
      SELECT id, name, name_key, km,
             ST_Transform(geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom_a
      FROM read_parquet(${lit(linesFile)})`);
    await db.conn.run(`ALTER TABLE ign_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE ign_a SET len_a = ST_Length(geom_a)`);
    await db.conn.run(`
      CREATE TABLE reaches_a AS
      SELECT r.HYRIV_ID, r.NEXT_DOWN AS next_down, r.ORD_STRA, r.LENGTH_KM AS km, r.network, m.river,
             ST_Y(ST_LineInterpolatePoint(r.geom, 0.5)) AS lat,
             ST_X(ST_LineInterpolatePoint(r.geom, 0.5)) AS lon,
             ST_Transform(r.geom, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true) AS geom_a
      FROM read_parquet(${lit(reachesFile)}) r
      LEFT JOIN read_parquet(${lit(mappingFile)}) m USING (HYRIV_ID)`);
    await db.conn.run(`ALTER TABLE reaches_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE reaches_a SET len_a = ST_Length(geom_a)`);

    log("candidate pairs…");
    await buildPairs(db, cfg.bufferM);

    // 2. Coverage per (reach, IGN name).
    log("name coverage…");
    await db.conn.run(`
      CREATE TABLE ign_buf AS
      SELECT id, ST_Buffer(geom_a, ${cfg.bufferM}) AS buf FROM ign_a
      WHERE id IN (SELECT iid FROM pairs WHERE dist <= ${cfg.bufferM})`);
    await db.conn.run(`
      CREATE TABLE reach_buf AS
      SELECT HYRIV_ID, ST_Buffer(geom_a, ${cfg.bufferM}) AS buf FROM reaches_a
      WHERE HYRIV_ID IN (SELECT rid FROM pairs WHERE dist <= ${cfg.bufferM})`);
    await db.conn.run(`
      CREATE TABLE name_info AS
      SELECT name_key, arg_max(name, km) AS name, sum(km) AS km
      FROM (SELECT name_key, name, sum(km) AS km FROM ign_a
            WHERE name IS NOT NULL GROUP BY name_key, name)
      GROUP BY name_key`);
    await db.conn.run(`
      CREATE TABLE cover AS
      WITH u AS (
        SELECT p.rid, i.name_key, ST_Union_Agg(b.buf) AS buf
        FROM pairs p
        JOIN ign_a i ON i.id = p.iid AND i.name_key IS NOT NULL
        JOIN ign_buf b ON b.id = p.iid
        GROUP BY p.rid, i.name_key)
      SELECT u.rid, u.name_key,
             least(1.0, ST_Length(ST_Intersection(r.geom_a, u.buf)) / r.len_a) AS coverage
      FROM u JOIN reaches_a r ON r.HYRIV_ID = u.rid
      WHERE r.len_a > 0`);

    const reachRows = await db.all(`
      SELECT HYRIV_ID AS id, next_down, river, network, ORD_STRA AS strahler, km, lat, lon
      FROM reaches_a ORDER BY HYRIV_ID`);
    const candRows = await db.all(`
      SELECT c.rid, c.name_key AS key, n.name, c.coverage FROM cover c
      JOIN name_info n USING (name_key)
      ORDER BY c.rid, c.coverage DESC, n.km DESC, c.name_key`);
    const candsByReach = new Map<number, ReachRow["cands"]>();
    for (const c of candRows) {
      const list = candsByReach.get(num(c.rid)) ?? [];
      list.push({
        key: String(c.key),
        name: String(c.name),
        coverage: num(c.coverage),
      });
      candsByReach.set(num(c.rid), list);
    }

    // 3. Classify; then the overrides.
    const reaches: ReachRow[] = reachRows.map((r) => {
      const cands = candsByReach.get(num(r.id)) ?? [];
      return {
        id: num(r.id),
        nextDown: num(r.next_down),
        river: r.river == null ? null : String(r.river),
        network: String(r.network),
        strahler: num(r.strahler),
        km: num(r.km),
        lat: num(r.lat),
        lon: num(r.lon),
        cands,
        result: classify(cands, cfg),
      };
    });
    const byId = new Map(reaches.map((r) => [r.id, r]));
    const overrideOf = new Map<number, ReachOverride>();
    const badOverrides: string[] = [];
    for (const o of overrides.reaches) {
      if (!byId.has(o.id)) badOverrides.push(`unknown reach ${o.id}`);
      else if (overrideOf.has(o.id)) badOverrides.push(`duplicate ${o.id}`);
      else if (!o.note?.trim()) badOverrides.push(`no note for ${o.id}`);
      else if (o.action === "name" && !o.name?.trim())
        badOverrides.push(`no name for ${o.id}`);
      else overrideOf.set(o.id, o);
    }

    const out = reaches.map((r) => {
      const bestName = r.result.best
        ? (r.cands.find((c) => c.key === r.result.best?.key)?.name ?? null)
        : null;
      const m = applyOverride(
        { name: bestName, confidence: r.result.confidence },
        overrideOf.get(r.id),
      );
      const runner = r.cands[1];
      return {
        HYRIV_ID: r.id,
        name: m.name,
        name_key: m.name ? nameKey(m.name) : null,
        coverage: r.result.best ? round(r.result.best.coverage, 4) : null,
        margin: r.result.best ? round(r.result.margin, 4) : null,
        confidence: m.confidence as Confidence,
        ambiguous: r.result.ambiguous,
        runner_up: r.result.best && runner ? runner.name : null,
        runner_up_coverage:
          r.result.best && runner ? round(runner.coverage, 4) : null,
        reviewed: m.reviewed,
        display: m.display,
      };
    });
    const ndjson = `${outDir}/reach_ign.ndjson`;
    await writeFile(
      ndjson,
      out.map((o) => JSON.stringify(o)).join("\n") + "\n",
    );
    await db.conn.run(`
      COPY (SELECT * FROM read_json(${lit(ndjson)}, format = 'newline_delimited',
        columns = {HYRIV_ID: 'INTEGER', name: 'VARCHAR', name_key: 'VARCHAR',
                   coverage: 'DOUBLE', margin: 'DOUBLE', confidence: 'VARCHAR',
                   ambiguous: 'BOOLEAN', runner_up: 'VARCHAR',
                   runner_up_coverage: 'DOUBLE', reviewed: 'BOOLEAN', display: 'BOOLEAN'})
            ORDER BY HYRIV_ID)
      TO ${lit(`${outDir}/reach_ign.parquet`)} (FORMAT parquet)`);

    // 4. Review file: what is not shown automatically, longest first.
    const reviewable = reaches
      .filter(
        (r) =>
          (r.result.confidence === "low" || r.result.ambiguous) &&
          !overrideOf.has(r.id),
      )
      .sort((a, b) => b.km - a.km || a.id - b.id);
    // Proposal: show a low-confidence name when a neighbouring reach (upstream or
    // downstream) already shows the same name, i.e. the river continues through it.
    // Anything else stays hidden, which is the default and needs no override.
    const shownKey = new Map(
      out.filter((o) => o.display).map((o) => [o.HYRIV_ID, o.name_key]),
    );
    const upstreamOf = new Map<number, number[]>();
    for (const r of reaches)
      upstreamOf.set(r.nextDown, [...(upstreamOf.get(r.nextDown) ?? []), r.id]);
    const continuity = (r: ReachRow) => {
      const key = r.result.best?.key;
      if (!key) return null;
      const neighbours: [number, "downstream" | "upstream"][] = [
        [r.nextDown, "downstream"],
        ...(upstreamOf.get(r.id) ?? []).map((u): [number, "upstream"] => [
          u,
          "upstream",
        ]),
      ];
      const hit = neighbours.find(([id]) => shownKey.get(id) === key);
      return hit ? { reach: hit[0], relation: hit[1] } : null;
    };
    const review = reviewable.map((r) => {
      const via = continuity(r);
      return {
        id: r.id,
        km: round(r.km, 2),
        river: r.river,
        strahler: r.strahler,
        network: r.network,
        lat: round(r.lat, 5),
        lon: round(r.lon, 5),
        confidence: r.result.confidence,
        ambiguous: r.result.ambiguous,
        candidates: r.cands.slice(0, TOP_N).map((c) => ({
          name: c.name,
          coverage: round(c.coverage, 3),
        })),
        proposal: via ? ("accept" as const) : null,
        via,
      };
    });
    const proposed = review.filter((r) => r.proposal === "accept");
    await writeFile(
      `${outDir}/proposed-overrides.json`,
      JSON.stringify(
        {
          $comment:
            "Proposal only. Copy the entries you accept into pipeline/ign-overrides.json.",
          reaches: proposed.map((r) => ({
            id: r.id,
            action: "accept",
            note: `same name on the ${r.via?.relation} reach ${r.via?.reach} (${r.candidates[0]?.name}, coverage ${r.candidates[0]?.coverage})`,
          })),
        },
        null,
        1,
      ) + "\n",
    );
    await writeFile(
      `${outDir}/review.json`,
      JSON.stringify({ count: review.length, reaches: review }, null, 1) + "\n",
    );

    // 5. Approved rivers: vote of the IGN names along the main stem.
    const stems = new Map<string, ReachRow[]>();
    for (const r of reaches) {
      if (!r.river) continue;
      stems.set(r.river, [...(stems.get(r.river) ?? []), r]);
    }
    const nameOverride = new Map(overrides.riverNames.map((o) => [o.river, o]));
    const riverNames = approved.map((a) => {
      const stem = stems.get(a.slug) ?? [];
      const stemKm = stem.reduce((s, r) => s + r.km, 0);
      // IGN draws no line through reservoirs, so those reaches have no candidate; the vote
      // is taken over the stem km that does (and the report says how much that is).
      const candKm = stem.reduce((s, r) => s + (r.result.best ? r.km : 0), 0);
      const votes = new Map<string, { name: string; km: number }>();
      for (const r of stem) {
        const best = r.result.best;
        if (!best || r.result.confidence === "none") continue;
        const name = r.cands.find((c) => c.key === best.key)?.name ?? best.key;
        const v = votes.get(best.key) ?? { name, km: 0 };
        v.km += r.km;
        votes.set(best.key, v);
      }
      const ranked = [...votes.entries()]
        .map(([key, v]) => ({
          key,
          name: v.name,
          km: round(v.km),
          share: candKm > 0 ? round(v.km / candKm, 3) : 0,
        }))
        .sort((x, y) => y.km - x.km || x.key.localeCompare(y.key));
      const top = ranked[0];
      const forced = nameOverride.get(a.slug);
      const proposed = forced
        ? forced.name
        : top &&
            top.share >= cfg.riverNameMinShare &&
            candKm >= cfg.riverNameMinEvidenceKm
          ? top.name
          : null;
      return {
        slug: a.slug,
        currentName: a.name,
        stemReaches: stem.length,
        stemKm: round(stemKm),
        stemKmWithCandidatePct: pct(candKm, stemKm),
        votes: ranked.slice(0, TOP_N),
        proposedName: proposed,
        source: forced ? "override" : proposed ? "stem vote" : "none",
        change:
          proposed === null
            ? "keep (no IGN name reaches the share, or too little stem length has a candidate)"
            : nameKey(proposed) === nameKey(a.name)
              ? proposed === a.name
                ? "same"
                : "spelling only"
              : "differs",
      };
    });

    // 6. Detail layer: IGN lines beyond the buffer of every reach.
    log("detail layer…");
    await db.conn.run(`
      CREATE TABLE ign_near AS
      SELECT p.iid AS id, ST_Union_Agg(rb.buf) AS buf
      FROM pairs p JOIN reach_buf rb ON rb.HYRIV_ID = p.rid
      GROUP BY p.iid`);
    await db.conn.run(`
      CREATE TABLE ign_split AS
      SELECT i.id, i.name, i.len_a,
             CASE WHEN n.buf IS NULL THEN 0
                  ELSE ST_Length(ST_CollectionExtract(ST_Intersection(i.geom_a, n.buf), 2)) END AS near_m,
             CASE WHEN n.buf IS NULL THEN i.geom_a
                  ELSE ST_CollectionExtract(ST_Difference(i.geom_a, n.buf), 2) END AS far_a
      FROM ign_a i LEFT JOIN ign_near n USING (id)`);
    await db.conn.run(`ALTER TABLE ign_split ADD COLUMN far_m DOUBLE`);
    await db.conn.run(
      `UPDATE ign_split SET far_m = CASE WHEN far_a IS NULL OR ST_IsEmpty(far_a) THEN 0 ELSE ST_Length(far_a) END`,
    );
    await db.conn.run(`
      CREATE TABLE pieces AS
      SELECT line_id, name, d.geom AS geom_a FROM (
        SELECT s.id AS line_id, s.name, unnest(ST_Dump(ST_LineMerge(s.far_a))) AS d
        FROM ign_split s WHERE s.far_m > 0)`);
    log("detail pieces…");
    await db.conn.run(`
      CREATE TABLE detail AS
      SELECT CAST(row_number() OVER (ORDER BY line_id, ST_AsHEXWKB(geom)) AS INTEGER) AS id,
             line_id, name, km, geom
      FROM (
        SELECT line_id, name, geom, ${lengthSpheroidKm("geom")} AS km
        FROM (SELECT line_id, name,
                     ST_Transform(geom_a, ${lit(ALBERS)}, 'EPSG:4326', always_xy := true) AS geom
              FROM pieces))
      WHERE km * 1000 >= ${cfg.minDetailPieceM}`);
    await db.conn.run(
      `COPY (SELECT * FROM detail ORDER BY id) TO ${lit(`${outDir}/detail.parquet`)} (FORMAT parquet)`,
    );

    // 7. Report.
    const [acc] = await db.all(`
      SELECT sum(len_a) / 1e3 AS total_km, sum(near_m) / 1e3 AS near_km,
             sum(far_m) / 1e3 AS far_km FROM ign_split`);
    const [kept] = await db.all(
      `SELECT count(*) AS pieces, sum(km) AS km,
              count(*) FILTER (name IS NOT NULL) AS named_pieces,
              sum(km) FILTER (name IS NOT NULL) AS named_km FROM detail`,
    );
    const [lines] = await db.all(
      `SELECT count(*) AS n, sum(km) AS km FROM ign_a`,
    );
    const [gain] = await db.all(`
      SELECT sum(km) FILTER (river IS NULL) AS unnamed_km,
             count(*) FILTER (river IS NULL) AS unnamed_reaches
      FROM reaches_a`);

    const km = (rows: ReachRow[]) => rows.reduce((s, r) => s + r.km, 0);
    const allKm = km(reaches);
    const tiers = (["high", "medium", "low", "none"] as const).map((t) => {
      const rows = reaches.filter((r) => r.result.confidence === t);
      return {
        confidence: t,
        reaches: rows.length,
        km: round(km(rows)),
        pctOfKm: pct(km(rows), allKm),
      };
    });
    const unnamedRows = reaches.filter((r) => r.river === null);
    const shown = out.filter((o) => o.display);
    const shownIds = new Set(shown.map((o) => o.HYRIV_ID));
    const unnamedShown = unnamedRows.filter((r) => shownIds.has(r.id));
    const buckets = [0, 0.2, 0.4, 0.6, 0.8, 1.0000001];
    const coverageHistogram = buckets.slice(0, -1).map((lo, i) => {
      const hi = buckets[i + 1] ?? 1;
      const rows = reaches.filter((r) => {
        const c = r.result.best?.coverage ?? r.cands[0]?.coverage ?? 0;
        return c >= lo && c < hi;
      });
      return {
        range: `${lo}-${Math.min(hi, 1)}`,
        reaches: rows.length,
        km: round(km(rows)),
      };
    });
    const lowKm = km(reviewable);
    let cum = 0;
    let n80 = 0;
    for (const r of reviewable) {
      if (lowKm > 0 && cum / lowKm >= 0.8) break;
      cum += r.km;
      n80++;
    }

    const accKm = num(acc?.near_km) + num(acc?.far_km);
    const checks = {
      overridesValid: badOverrides.length === 0,
      everyReachOnce:
        out.length === reachRows.length && byId.size === out.length,
      coverageInRange: out.every(
        (o) => o.coverage === null || (o.coverage >= 0 && o.coverage <= 1),
      ),
      kmAccounting:
        Math.abs(accKm - num(acc?.total_km)) / num(acc?.total_km) <
        KM_TOLERANCE,
      detailPiecesAtLeastMin:
        num(
          (
            await db.all(
              `SELECT count(*) AS n FROM detail WHERE km * 1000 < ${cfg.minDetailPieceM}`,
            )
          )[0]?.n,
        ) === 0,
      detailWithinFarKm: num(kept?.km) <= num(acc?.far_km) * 1.005,
    };
    const ok = Object.values(checks).every(Boolean);
    await writeReport("ign-match", {
      ok,
      checks,
      config: cfg,
      overrides: {
        reaches: overrides.reaches.length,
        riverNames: overrides.riverNames.length,
        problems: badOverrides,
      },
      reaches: {
        total: reaches.length,
        km: round(allKm),
        byConfidence: tiers,
        ambiguous: reaches.filter((r) => r.result.ambiguous).length,
        shown: shown.length,
        coverageHistogram,
      },
      names: {
        unnamedReaches: num(gain?.unnamed_reaches),
        unnamedKm: round(num(gain?.unnamed_km)),
        unnamedReachesWithShownIgnName: unnamedShown.length,
        unnamedKmWithShownIgnName: round(km(unnamedShown)),
        pctOfUnnamedKm: pct(km(unnamedShown), num(gain?.unnamed_km)),
        namedKeysShown: new Set(shown.map((o) => o.name_key)).size,
      },
      approvedRivers: riverNames,
      ignLines: {
        features: num(lines?.n),
        km: round(num(lines?.km)),
        nearReachesKm: round(num(acc?.near_km)),
        farFromReachesKm: round(num(acc?.far_km)),
        farPctOfKm: pct(num(acc?.far_km), num(acc?.total_km)),
      },
      detailLayer: {
        minPieceM: cfg.minDetailPieceM,
        pieces: num(kept?.pieces),
        km: round(num(kept?.km)),
        namedPieces: num(kept?.named_pieces),
        namedKmPct: pct(num(kept?.named_km), num(kept?.km)),
        droppedShortPiecesKm: round(num(acc?.far_km) - num(kept?.km)),
      },
      review: {
        reaches: review.length,
        km: round(lowKm),
        reachesCoveringHalfTheKm: (() => {
          let c = 0;
          let n = 0;
          for (const r of reviewable) {
            if (c >= lowKm / 2) break;
            c += r.km;
            n++;
          }
          return n;
        })(),
        reachesCovering80PctOfKm: n80,
        proposedAccept: {
          reaches: proposed.length,
          km: round(proposed.reduce((a, r) => a + r.km, 0)),
        },
      },
      outputs: [
        "reach_ign.parquet",
        "detail.parquet",
        "review.json",
        "proposed-overrides.json",
      ].map((f) => rel(`${outDir}/${f}`)),
    });
    if (!ok)
      throw new Error(`ign-match checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
