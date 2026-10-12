/**
 * pipeline:line-names — the names of the displayed lines (R3.4 step 1; DECISSIONS.md
 * "Córdoba R3.4 step 1"). Needs regions/<id>/names.config.json (and lines.config.json,
 * ign.config.json); a region without them stops with a message.
 *
 * Precedence APRHI > IGN > HydroRIVERS (owner). Inputs: data/work/<id>/lines/lines.parquet
 * (pipeline:lines), the reaches (pipeline:rivers), and the IGN lines that lie inside the
 * province (lines.parquet keeps IGN only outside it; inside they are read here, for aliases
 * only).
 *
 * 1. APRHI names (lib/line-names.ts): abbreviations expanded ("A. Bola" -> "Arroyo Bola"),
 *    parentheses moved to the aliases, a name with "*" blank (the source marks it unknown),
 *    an unknown prefix stops the step. The raw value stays as an alias.
 * 2. IGN aliases and corrections: for each APRHI name, the IGN names that run within
 *    names.config.json bufferM of at least aliasMinShare of its km (South America Albers, as
 *    pipeline:lines-gate) become search aliases. Where such an IGN name has the same number of
 *    words and a nameKey within maxEditDistance edits, it corrects the APRHI spelling
 *    (characters were damaged in the source); damaged names left unresolved are listed.
 * 3. Names of reaches, in the shape of pipeline:ign-match: for each reach and each name key,
 *    `coverage` is the fraction of the reach within the buffer of the lines (of the reach's
 *    own root) carrying that name; the buffer is lines.config.json bufferM, or bufferLargeM
 *    for reaches of Strahler order largeMinStrahler and up. Candidates go through classify()
 *    with ign.config.json. A reach touched by APRHI lines takes the APRHI name when one
 *    qualifies (confidence not "none"), otherwise the IGN name. High and medium are displayed.
 *
 * Outputs in data/work/<id>/line-names/: cover.parquet and reach_ign.parquet (the columns
 * and types of pipeline:ign-match), aliases.json (per name key: display, sources, raw
 * values, aliases), review.json (starred names, damaged names, open items), report.json.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { layerTable, type LayerConfig } from "../lib/basin-reference";
import { lit, limitResources, openDb } from "../lib/duckdb";
import { envelope } from "../lib/geo";
import {
  ALBERS,
  IGN_LINE_LAYERS,
  IGN_ST_READ_OPTIONS,
  buildPairs,
  createNameMap,
} from "../lib/ign";
import {
  type Candidate,
  type Confidence,
  type MatchConfig,
  applyOverride,
  classify,
} from "../lib/ign-match";
import { requireInput } from "../lib/inputs";
import {
  type Correction,
  type NamesConfig,
  type ParsedName,
  UnknownPrefixError,
  editDistance,
  findCorrection,
  ignMainName,
  ignParenthesized,
  looksDamaged,
  parseAprhiName,
} from "../lib/line-names";
import { round } from "../lib/lines-gate";
import { nameKey } from "../lib/names";
import { regionFile, rel, REGION_ID, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";

interface LinesConfig {
  bufferM: number;
  bufferLargeM: number;
  largeMinStrahler: number;
}

const num = (v: unknown) => Number(v ?? 0);
const readJson = async <T>(file: string) =>
  JSON.parse(await readFile(file, "utf8")) as T;
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const albers = (g: string) =>
  `ST_Transform(${g}, 'EPSG:4326', ${lit(ALBERS)}, always_xy := true)`;
/** Rows of a report list kept in full only up to this many. */
const TOP = 25;
const COVERAGE_DIGITS = 6;

interface Entry {
  key: string;
  display: string;
  sources: Set<"aprhi" | "ign">;
  raw: Set<string>;
  parenthesized: Set<string>;
  ignAliases: { name: string; share: number }[];
  /** The APRHI spelling replaced by an owner-approved fix (names.config.json nameFixes). */
  correctedFrom: { display: string; note: string } | null;
}

async function main() {
  const namesFile = regionFile("names.config.json");
  if (!existsSync(namesFile)) {
    console.error(
      `pipeline:line-names has no settings for region "${REGION_ID}" (${rel(namesFile)} missing); nothing to do.`,
    );
    process.exit(1);
  }
  const cfg = await readJson<NamesConfig>(namesFile);
  const linesCfg = await readJson<LinesConfig>(regionFile("lines.config.json"));
  const matchCfg = await readJson<MatchConfig>(regionFile("ign.config.json"));
  const basinConfig = await readJson<{
    clippedLayer: LayerConfig;
    searchBbox: Parameters<typeof envelope>[0];
  }>(regionFile("basin.config.json"));
  const linesFile = requireInput(workPath("lines/lines.parquet"));
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const ignLayers = IGN_LINE_LAYERS.map((l) => ({
    ...l,
    shp: requireInput(l.shp),
  }));

  const outDir = workPath("line-names");
  await mkdir(outDir, { recursive: true });
  const files = {
    cover: `${outDir}/cover.parquet`,
    reach: `${outDir}/reach_ign.parquet`,
    aliases: `${outDir}/aliases.json`,
    review: `${outDir}/review.json`,
  };
  const shaOf = async () => {
    const h = createHash("sha256");
    for (const f of Object.values(files)) h.update(await sha256(f));
    return h.digest("hex");
  };
  const previousSha = Object.values(files).every(existsSync)
    ? await shaOf()
    : null;

  const db = await openDb();
  await limitResources(db, `${outDir}/tmp`);
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);

  try {
    await db.conn.run(
      `CREATE VIEW lp AS
       SELECT * REPLACE (ST_SetCRS(geom, 'EPSG:4326') AS geom) FROM read_parquet(${lit(linesFile)})`,
    );

    // 1. APRHI names.
    const rawRows = await db.all(`
      SELECT name AS raw, count(*) AS pieces, sum(length_m) / 1000 AS km
      FROM lp WHERE source = 'aprhi' AND name IS NOT NULL GROUP BY name ORDER BY name`);
    const parsed = new Map<string, ParsedName>();
    const unknownPrefixes = new Map<string, string[]>();
    for (const r of rawRows) {
      const raw = String(r.raw);
      try {
        parsed.set(raw, parseAprhiName(raw, cfg));
      } catch (e) {
        if (!(e instanceof UnknownPrefixError)) throw e;
        unknownPrefixes.set(e.prefix, [
          ...(unknownPrefixes.get(e.prefix) ?? []),
          raw,
        ]);
      }
    }
    if (unknownPrefixes.size > 0) {
      const list = [...unknownPrefixes]
        .map(
          ([p, raws]) => `  "${p}" (${raws.length} names, e.g. "${raws[0]}")`,
        )
        .join("\n");
      throw new Error(
        `APRHI names start with a prefix that is neither an abbreviation nor a known full word:\n${list}\nCheck what each means, then add it to abbreviations or leadingWords in ${rel(namesFile)}.`,
      );
    }
    const rawStats = new Map(
      rawRows.map((r) => [
        String(r.raw),
        { pieces: num(r.pieces), km: num(r.km) },
      ]),
    );
    const [totals] = await db.all(`
      SELECT sum(length_m) FILTER (source = 'aprhi') / 1000 AS aprhi_km,
             sum(length_m) FILTER (source = 'aprhi' AND name IS NULL) / 1000 AS aprhi_unnamed_km,
             count(*) FILTER (source = 'aprhi') AS aprhi_pieces,
             count(*) FILTER (source = 'aprhi' AND name IS NULL) AS aprhi_unnamed_pieces,
             sum(length_m) FILTER (source = 'ign') / 1000 AS ign_km,
             sum(length_m) FILTER (source = 'ign' AND name IS NOT NULL) / 1000 AS ign_named_km,
             count(*) FILTER (source = 'ign') AS ign_pieces,
             count(*) FILTER (source = 'ign' AND name IS NOT NULL) AS ign_named_pieces
      FROM lp`);

    // Pre-correction key of each non-starred raw name.
    const preKey = new Map<string, string>();
    const preDisplay = new Map<string, string>();
    for (const [raw, p] of parsed)
      if (p.display) {
        preKey.set(raw, nameKey(p.display));
        preDisplay.set(raw, p.display);
      }
    await db.conn.run(`CREATE TABLE raw_map (raw VARCHAR, key VARCHAR)`);
    if (preKey.size > 0)
      await db.conn.run(
        `INSERT INTO raw_map VALUES ${[...preKey]
          .map(([r, k]) => `(${lit(r)}, ${lit(k)})`)
          .join(",")}`,
      );

    // 2. IGN lines inside the province (aliases and corrections only).
    await layerTable(db, "clipped", basinConfig.clippedLayer);
    await db.conn.run(
      `CREATE TABLE prov AS SELECT ST_Union_Agg(geom) AS geom FROM clipped`,
    );
    const bbox = envelope(basinConfig.searchBbox);
    await db.conn.run(
      `CREATE TABLE i_raw (cls VARCHAR, gid BIGINT, fna VARCHAR, geom GEOMETRY)`,
    );
    for (const l of ignLayers)
      await db.conn.run(`
        INSERT INTO i_raw
        SELECT ${lit(l.cls)}, CAST(gid AS BIGINT), fna, ST_Force2D(geom)
        FROM ST_Read(${lit(l.shp)}, ${IGN_ST_READ_OPTIONS})
        WHERE ST_Intersects(geom, ${bbox}) AND ST_Intersects(geom, (SELECT geom FROM prov))`);
    await createNameMap(db, "i_raw", "fna");
    log("names parsed, IGN lines of the province read");

    // IGN-inside side of buildPairs (`ign_a`) against the APRHI pieces (`reaches_a`, whose
    // HYRIV_ID column holds a piece number here).
    await db.conn.run(`
      CREATE TABLE ign_a AS
      SELECT row_number() OVER (ORDER BY r.gid, r.cls) AS id, m.name_key, m.name,
             ${albers("r.geom")} AS geom_a
      FROM i_raw r JOIN name_map m ON m.raw = r.fna`);
    await db.conn.run(`
      CREATE TABLE reaches_a AS
      SELECT row_number() OVER (ORDER BY l.pieceId) AS HYRIV_ID, rm.key AS akey,
             ${albers("l.geom")} AS geom_a
      FROM lp l JOIN raw_map rm ON rm.raw = l.name WHERE l.source = 'aprhi'`);
    await db.conn.run(`ALTER TABLE reaches_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE reaches_a SET len_a = ST_Length(geom_a)`);
    await buildPairs(db, cfg.bufferM);
    await db.conn.run(`
      CREATE TABLE ign_buf AS
      SELECT id, ST_Buffer(geom_a, ${cfg.bufferM}) AS buf FROM ign_a
      WHERE id IN (SELECT iid FROM pairs)`);
    await db.conn.run(`
      CREATE TABLE a_within AS
      WITH u AS (
        SELECT p.rid, i.name_key AS ikey, ST_Union_Agg(b.buf) AS buf
        FROM pairs p JOIN ign_a i ON i.id = p.iid JOIN ign_buf b ON b.id = p.iid
        GROUP BY p.rid, i.name_key)
      SELECT a.akey, u.ikey,
             sum(coalesce(ST_Length(ST_Intersection(a.geom_a, u.buf)), 0)) AS within_m
      FROM u JOIN reaches_a a ON a.HYRIV_ID = u.rid GROUP BY a.akey, u.ikey`);
    const aTotals = new Map(
      (
        await db.all(
          `SELECT akey, sum(len_a) AS total_m FROM reaches_a GROUP BY akey`,
        )
      ).map((r) => [String(r.akey), num(r.total_m)]),
    );
    // The spelling of each IGN name key: the most km, then alphabetical.
    const ignNames = new Map(
      (
        await db.all(`
          SELECT name_key, arg_max(name, m) AS name, sum(m) AS km_albers FROM (
            SELECT name_key, name, sum(ST_Length(geom_a)) AS m FROM ign_a GROUP BY name_key, name)
          GROUP BY name_key ORDER BY name_key`)
      ).map((r) => [
        String(r.name_key),
        { name: String(r.name), km: num(r.km_albers) / 1000 },
      ]),
    );
    const shareRows = await db.all(
      `SELECT akey, ikey, within_m FROM a_within ORDER BY akey, ikey`,
    );
    // akey -> IGN candidates with their share of the APRHI name's km.
    const sharesByKey = new Map<string, { ikey: string; share: number }[]>();
    for (const r of shareRows) {
      const total = aTotals.get(String(r.akey)) ?? 0;
      if (total <= 0) continue;
      const share = Math.min(1, num(r.within_m) / total);
      if (share <= 0) continue;
      const list = sharesByKey.get(String(r.akey)) ?? [];
      list.push({ ikey: String(r.ikey), share });
      sharesByKey.set(String(r.akey), list);
    }
    for (const list of sharesByKey.values())
      list.sort((a, b) => b.share - a.share || a.ikey.localeCompare(b.ikey));
    await db.conn.run(
      `DROP TABLE pairs; DROP TABLE ign_a; DROP TABLE reaches_a; DROP TABLE ign_buf; DROP TABLE a_within`,
    );
    log("IGN names measured along the APRHI names");

    // 3. Corrections and aliases, per pre-correction key (sorted: deterministic).
    const keyInfo = new Map<
      string,
      { display: string; raws: string[]; km: number }
    >();
    for (const [raw, key] of preKey) {
      const e = keyInfo.get(key) ?? {
        display: preDisplay.get(raw) ?? "",
        raws: [],
        km: 0,
      };
      const km = rawStats.get(raw)?.km ?? 0;
      // The spelling with the most km names the key.
      if (km > e.km) e.display = preDisplay.get(raw) ?? e.display;
      e.km += km;
      e.raws.push(raw);
      keyInfo.set(key, e);
    }
    const allPreKeys = new Set(keyInfo.keys());
    const entries = new Map<string, Entry>();
    const remap = new Map<string, string>(); // pre-correction key -> final key
    // Applied fixes: only the owner's (nameFixes). IGN spellings a few edits away are listed
    // as candidates for the owner to approve (owner, 2026-10-12), never applied here.
    const approvedFixes = new Map(
      cfg.nameFixes.map((f) => [nameKey(f.from), f]),
    );
    const usedFixes = new Set<string>();
    const corrections: {
      aprhi: string;
      raw: string[];
      to: string;
      note: string;
      km: number;
    }[] = [];
    const fixCandidates: {
      aprhi: string;
      raw: string[];
      ign: string;
      share: number;
      distance: number;
      km: number;
    }[] = [];
    for (const key of [...keyInfo.keys()].sort()) {
      const info = keyInfo.get(key);
      if (!info) continue;
      const cands = (sharesByKey.get(key) ?? []).map((c) => ({
        name: ignNames.get(c.ikey)?.name ?? c.ikey,
        share: c.share,
      }));
      const proposal: Correction | null = findCorrection(
        info.display,
        cands,
        allPreKeys,
        cfg,
      );
      const fix = approvedFixes.get(key);
      if (fix) usedFixes.add(key);
      else if (proposal)
        fixCandidates.push({
          aprhi: info.display,
          raw: info.raws,
          ign: proposal.name,
          share: round(proposal.share, 4),
          distance: proposal.distance,
          km: round(info.km, 3),
        });
      const display = fix ? fix.to : info.display;
      const finalKey = nameKey(display);
      remap.set(key, finalKey);
      const entry = entries.get(finalKey) ?? {
        key: finalKey,
        display,
        sources: new Set<"aprhi" | "ign">(["aprhi"]),
        raw: new Set<string>(),
        parenthesized: new Set<string>(),
        ignAliases: [],
        correctedFrom: null,
      };
      for (const raw of info.raws) {
        entry.raw.add(raw);
        for (const p of parsed.get(raw)?.parenthesized ?? [])
          entry.parenthesized.add(p);
      }
      if (fix) {
        entry.correctedFrom = { display: info.display, note: fix.note };
        corrections.push({
          aprhi: info.display,
          raw: info.raws,
          to: fix.to,
          note: fix.note,
          km: round(info.km, 3),
        });
      }
      entries.set(finalKey, entry);
    }
    // IGN aliases, once every display and parenthesized name is known.
    const agreement = { agreeKm: 0, disagreeKm: 0, noIgnKm: 0 };
    const disagreements: {
      aprhi: string;
      ign: string;
      share: number;
      km: number;
    }[] = [];
    let aliasPairs = 0;
    for (const key of [...keyInfo.keys()].sort()) {
      const info = keyInfo.get(key);
      const entry = entries.get(remap.get(key) ?? "");
      if (!info || !entry) continue;
      const known = new Set([
        entry.key,
        ...[...entry.parenthesized].map(nameKey),
      ]);
      const strong = (sharesByKey.get(key) ?? []).filter(
        (c) => c.share >= cfg.aliasMinShare,
      );
      for (const c of strong) {
        const ign = ignNames.get(c.ikey);
        if (!ign) continue;
        const components = [
          ignMainName(ign.name),
          ...ignParenthesized(ign.name),
        ].map(nameKey);
        if (components.every((k) => known.has(k))) continue;
        entry.ignAliases.push({ name: ign.name, share: round(c.share, 4) });
        aliasPairs++;
      }
      // Agreement of the best IGN name with the APRHI name, on the name's km.
      const best = strong[0];
      if (!best) agreement.noIgnKm += info.km;
      else {
        const ign = ignNames.get(best.ikey);
        const ignKeys = new Set(
          ign
            ? [ignMainName(ign.name), ...ignParenthesized(ign.name)].map(
                nameKey,
              )
            : [],
        );
        if ([...known].some((k) => ignKeys.has(k)))
          agreement.agreeKm += info.km;
        else {
          agreement.disagreeKm += info.km;
          disagreements.push({
            aprhi: entry.display,
            ign: ign?.name ?? best.ikey,
            share: round(best.share, 3),
            km: round(info.km, 3),
          });
        }
      }
    }
    disagreements.sort((a, b) => b.km - a.km || a.aprhi.localeCompare(b.aprhi));

    // Final key of every APRHI raw value; starred values have none.
    const finalKeyOfRaw = new Map<string, string>();
    for (const [raw, key] of preKey)
      finalKeyOfRaw.set(raw, remap.get(key) ?? key);

    // IGN names of the lines outside the province (those of lines.parquet).
    const ignOut = await db.all(`
      SELECT name, count(*) AS pieces, sum(length_m) / 1000 AS km
      FROM lp WHERE source = 'ign' AND name IS NOT NULL GROUP BY name ORDER BY name`);
    const ignOutKeys = new Map<string, { name: string; km: number }>();
    const ignOutKeyOfName = new Map<string, string>();
    for (const r of ignOut) {
      const name = String(r.name);
      const key = nameKey(name);
      ignOutKeyOfName.set(name, key);
      const cur = ignOutKeys.get(key);
      const km = num(r.km);
      if (!cur) ignOutKeys.set(key, { name, km });
      else {
        // Same key: the spelling with more km, then alphabetical.
        if (km > cur.km || (km === cur.km && name < cur.name)) cur.name = name;
        cur.km += km;
      }
    }
    for (const [key, v] of ignOutKeys) {
      const entry = entries.get(key);
      if (entry) entry.sources.add("ign");
      else
        entries.set(key, {
          key,
          display: v.name,
          sources: new Set(["ign"]),
          raw: new Set(),
          parenthesized: new Set(),
          ignAliases: [],
          correctedFrom: null,
        });
    }

    // Names outputs: aliases.json.
    const aliasNames: Record<string, unknown> = {};
    let aliasTotal = 0;
    let namesWithAlias = 0;
    for (const key of [...entries.keys()].sort()) {
      const e = entries.get(key);
      if (!e) continue;
      e.ignAliases.sort(
        (a, b) => b.share - a.share || a.name.localeCompare(b.name),
      );
      const aliases: string[] = [];
      const seen = new Set<string>([e.display]);
      const add = (s: string) => {
        if (!seen.has(s)) {
          seen.add(s);
          aliases.push(s);
        }
      };
      [...e.raw].sort().forEach(add);
      [...e.parenthesized].sort().forEach(add);
      e.ignAliases.forEach((a) => add(a.name));
      aliasTotal += aliases.length;
      if (aliases.length > 0) namesWithAlias++;
      aliasNames[key] = {
        display: e.display,
        sources: [...e.sources].sort(),
        raw: [...e.raw].sort(),
        parenthesized: [...e.parenthesized].sort(),
        ignAliases: e.ignAliases,
        aliases,
        correctedFrom: e.correctedFrom,
      };
    }
    await writeFile(
      files.aliases,
      JSON.stringify(
        {
          $comment:
            "pipeline:line-names. Per name key (nameKey of the display name): display = the name the map shows; sources = which line sources carry it; raw = the APRHI values as the source writes them (kept as aliases); parenthesized = the names that were in parentheses; ignAliases = IGN names running along at least aliasMinShare of the APRHI name's km, with that share; aliases = every alternative the name is searched by, display excluded; correctedFrom = the expanded APRHI spelling replaced by an owner-approved fix (names.config.json nameFixes), with its note. Names ending or containing '*' are not here: they are blank.",
          aliasMinShare: cfg.aliasMinShare,
          bufferM: cfg.bufferM,
          names: aliasNames,
        },
        null,
        2,
      ) + "\n",
    );

    // 4. Names of the reaches.
    await db.conn.run(
      `CREATE TABLE name_keys (source VARCHAR, raw VARCHAR, key VARCHAR)`,
    );
    const nkRows = [
      ...[...finalKeyOfRaw].map(([r, k]) => `('aprhi', ${lit(r)}, ${lit(k)})`),
      ...[...ignOutKeyOfName].map(([r, k]) => `('ign', ${lit(r)}, ${lit(k)})`),
    ];
    if (nkRows.length > 0)
      await db.conn.run(`INSERT INTO name_keys VALUES ${nkRows.join(",")}`);
    // `ign_a` here is the named lines (APRHI non-starred and IGN outside), `reaches_a` the reaches.
    await db.conn.run(`
      CREATE TABLE ign_a AS
      SELECT row_number() OVER (ORDER BY l.pieceId) AS id, l.source, l.root, k.key AS name_key,
             ${albers("l.geom")} AS geom_a
      FROM lp l JOIN name_keys k ON k.source = l.source AND k.raw = l.name`);
    await db.conn.run(`
      CREATE TABLE reaches_a AS
      SELECT HYRIV_ID, root, ORD_STRA AS strahler, LENGTH_KM AS km,
             CASE WHEN ORD_STRA >= ${linesCfg.largeMinStrahler} THEN ${linesCfg.bufferLargeM}
                  ELSE ${linesCfg.bufferM} END AS buf_m,
             ${albers("geom")} AS geom_a
      FROM read_parquet(${lit(reachesFile)})`);
    await db.conn.run(`ALTER TABLE reaches_a ADD COLUMN len_a DOUBLE`);
    await db.conn.run(`UPDATE reaches_a SET len_a = ST_Length(geom_a)`);
    log("candidate pairs…");
    await buildPairs(db, Math.max(linesCfg.bufferM, linesCfg.bufferLargeM));
    await db.conn.run(`
      CREATE TABLE near AS
      SELECT p.iid, p.rid, r.buf_m
      FROM pairs p JOIN ign_a l ON l.id = p.iid JOIN reaches_a r ON r.HYRIV_ID = p.rid
      WHERE l.root = r.root AND p.dist <= r.buf_m`);
    await db.conn.run(`
      CREATE TABLE line_buf AS
      SELECT n.iid, n.buf_m, ST_Buffer(l.geom_a, n.buf_m) AS buf
      FROM (SELECT DISTINCT iid, buf_m FROM near) n JOIN ign_a l ON l.id = n.iid`);
    log("name coverage…");
    await db.conn.run(`
      CREATE TABLE cover AS
      WITH u AS (
        SELECT n.rid, l.name_key, bool_or(l.source = 'aprhi') AS has_aprhi,
               ST_Union_Agg(b.buf) AS buf
        FROM near n
        JOIN ign_a l ON l.id = n.iid
        JOIN line_buf b ON b.iid = n.iid AND b.buf_m = n.buf_m
        GROUP BY n.rid, l.name_key)
      SELECT u.rid, u.name_key, u.has_aprhi,
             round(least(1.0, ST_Length(ST_Intersection(r.geom_a, u.buf)) / r.len_a),
                   ${COVERAGE_DIGITS}) AS coverage
      FROM u JOIN reaches_a r ON r.HYRIV_ID = u.rid
      WHERE r.len_a > 0`);
    await db.conn.run(`
      COPY (SELECT rid AS HYRIV_ID, name_key, coverage FROM cover ORDER BY rid, name_key)
      TO ${lit(files.cover)} (FORMAT parquet)`);

    const reachRows = await db.all(`
      SELECT HYRIV_ID AS id, strahler, km, root FROM reaches_a ORDER BY HYRIV_ID`);
    const candRows = await db.all(`
      SELECT rid, name_key AS key, has_aprhi, coverage FROM cover
      ORDER BY rid, coverage DESC, name_key`);
    interface Cand extends Candidate {
      aprhi: boolean;
    }
    const candsByReach = new Map<number, Cand[]>();
    for (const c of candRows) {
      const list = candsByReach.get(num(c.rid)) ?? [];
      list.push({
        key: String(c.key),
        coverage: num(c.coverage),
        aprhi: Boolean(c.has_aprhi),
      });
      candsByReach.set(num(c.rid), list);
    }
    const displayOf = (key: string) => entries.get(key)?.display ?? null;
    const out = reachRows.map((r) => {
      const cands = candsByReach.get(num(r.id)) ?? [];
      const fromAprhi = cands.filter((c) => c.aprhi);
      let pool: Cand[] = fromAprhi;
      let source: "aprhi" | "ign" = "aprhi";
      let result = classify(fromAprhi, matchCfg);
      if (result.best === null) {
        pool = cands.filter((c) => !c.aprhi);
        source = "ign";
        result = classify(pool, matchCfg);
      }
      const bestName = result.best ? displayOf(result.best.key) : null;
      const m = applyOverride(
        { name: bestName, confidence: result.confidence },
        undefined,
      );
      const runner = pool[1];
      return {
        row: {
          HYRIV_ID: num(r.id),
          name: m.name,
          name_key: m.name ? nameKey(m.name) : null,
          coverage: result.best ? round(result.best.coverage, 4) : null,
          margin: result.best ? round(result.margin, 4) : null,
          confidence: m.confidence as Confidence,
          ambiguous: result.ambiguous,
          runner_up: result.best && runner ? displayOf(runner.key) : null,
          runner_up_coverage:
            result.best && runner ? round(runner.coverage, 4) : null,
          reviewed: m.reviewed,
          display: m.display,
        },
        source: result.best ? source : null,
        km: num(r.km),
        strahler: num(r.strahler),
        root: String(r.root),
      };
    });
    const ndjson = `${outDir}/reach_ign.ndjson`;
    await writeFile(
      ndjson,
      out.map((o) => JSON.stringify(o.row)).join("\n") + "\n",
    );
    await db.conn.run(`
      COPY (SELECT * FROM read_json(${lit(ndjson)}, format = 'newline_delimited',
        columns = {HYRIV_ID: 'INTEGER', name: 'VARCHAR', name_key: 'VARCHAR',
                   coverage: 'DOUBLE', margin: 'DOUBLE', confidence: 'VARCHAR',
                   ambiguous: 'BOOLEAN', runner_up: 'VARCHAR',
                   runner_up_coverage: 'DOUBLE', reviewed: 'BOOLEAN', display: 'BOOLEAN'})
            ORDER BY HYRIV_ID)
      TO ${lit(files.reach)} (FORMAT parquet)`);
    await rm(ndjson);
    log("reach names written");

    // 5. Review lists: starred values, damaged names, open items.
    const starredRows = [...parsed]
      .filter(([, p]) => p.starred)
      .map(([raw]) => ({
        raw,
        pieces: rawStats.get(raw)?.pieces ?? 0,
        km: round(rawStats.get(raw)?.km ?? 0, 3),
      }))
      .sort((a, b) => b.km - a.km || a.raw.localeCompare(b.raw));
    const starredKm = starredRows.reduce((s, r) => s + r.km, 0);
    const starredPieces = starredRows.reduce((s, r) => s + r.pieces, 0);
    const starEnding = starredRows.filter((r) => r.raw.endsWith("*")).length;
    const starMid = starredRows
      .filter((r) => !r.raw.endsWith("*"))
      .map((r) => r.raw);

    const correctedKeys = new Set(corrections.map((c) => nameKey(c.aprhi)));
    const correctedRaws = new Set(corrections.flatMap((c) => c.raw));
    const unresolved = [...parsed]
      .filter(
        ([raw, p]) =>
          p.display !== null &&
          !correctedRaws.has(raw) &&
          (p.unbalanced ||
            looksDamaged(p.display) ||
            p.parenthesized.some(looksDamaged)),
      )
      .map(([raw, p]) => ({
        raw,
        display: p.display,
        km: round(rawStats.get(raw)?.km ?? 0, 3),
      }))
      .sort((a, b) => b.km - a.km || a.raw.localeCompare(b.raw));
    // Names a few edits away from an IGN name of the province that does not run along them.
    const ignKeyList = [...ignNames.keys()].sort();
    const nearMisses: {
      aprhi: string;
      ign: string;
      distance: number;
      km: number;
    }[] = [];
    for (const key of [...keyInfo.keys()].sort()) {
      const info = keyInfo.get(key);
      const finalKey = remap.get(key) ?? key;
      if (!info || correctedKeys.has(key) || ignNames.has(finalKey)) continue;
      const words = finalKey.split(" ").length;
      for (const ik of ignKeyList) {
        if (allPreKeys.has(ik) || ik.split(" ").length !== words) continue;
        const d = editDistance(finalKey, ik);
        if (d >= 1 && d <= cfg.maxEditDistance)
          nearMisses.push({
            aprhi: info.display,
            ign: ignNames.get(ik)?.name ?? ik,
            distance: d,
            km: round(info.km, 3),
          });
      }
    }
    nearMisses.sort((a, b) => b.km - a.km || a.aprhi.localeCompare(b.aprhi));
    const unexpanded = new Map<string, string[]>();
    const excluded = new Map<string, number>();
    const ruleStats = new Map<
      string,
      { names: number; occurrences: number; km: number }
    >();
    let withParentheses = 0;
    let parenAliases = 0;
    for (const [raw, p] of parsed) {
      for (const u of p.unexpanded)
        unexpanded.set(u, [...(unexpanded.get(u) ?? []), raw]);
      for (const x of p.excluded) excluded.set(x, (excluded.get(x) ?? 0) + 1);
      if (p.parenthesized.length + p.excluded.length > 0) withParentheses++;
      parenAliases += p.parenthesized.length;
      for (const rule of new Set(p.rules)) {
        const s = ruleStats.get(rule) ?? { names: 0, occurrences: 0, km: 0 };
        s.names++;
        s.occurrences += p.rules.filter((x) => x === rule).length;
        s.km += rawStats.get(raw)?.km ?? 0;
        ruleStats.set(rule, s);
      }
    }
    await writeFile(
      files.review,
      JSON.stringify(
        {
          $comment:
            "pipeline:line-names review lists. starred: APRHI values with '*' (the source marks the name as unknown), shown blank, longest first. corrected: APRHI names replaced by an owner-approved fix (names.config.json nameFixes). fixCandidates: IGN spellings a few edits from an APRHI name that run along it; not applied, for the owner to approve or reject (owner, 2026-10-12: no automatic fix; the IGN spelling stays a search alias either way). unresolvedDamaged: names that look damaged (unbalanced parentheses, a capital inside a word, a replacement character) and were not corrected: a heuristic, characters lost without a trace cannot be found. nearMisses: names a few edits from an IGN name of the province that does not run along them (candidates only; nothing was changed). unexpandedAbbreviations: dotted words not in the abbreviation table.",
          starred: starredRows,
          corrected: corrections.sort(
            (a, b) => b.km - a.km || a.aprhi.localeCompare(b.aprhi),
          ),
          fixCandidates: fixCandidates.sort(
            (a, b) => b.km - a.km || a.aprhi.localeCompare(b.aprhi),
          ),
          unresolvedDamaged: unresolved,
          nearMisses,
          unexpandedAbbreviations: [...unexpanded].map(([word, raws]) => ({
            word,
            names: raws,
          })),
        },
        null,
        2,
      ) + "\n",
    );

    // 6. Checks, on the written files.
    const sha = await shaOf();
    const [fileCheck] = await db.all(`
      SELECT (SELECT count(*) FROM read_parquet(${lit(files.reach)})) AS reach_rows,
             (SELECT count(DISTINCT HYRIV_ID) FROM read_parquet(${lit(files.reach)})) AS reach_ids,
             (SELECT count(*) FROM read_parquet(${lit(files.reach)})
                WHERE HYRIV_ID NOT IN (SELECT HYRIV_ID FROM read_parquet(${lit(reachesFile)}))) AS reach_unknown,
             (SELECT count(*) FROM read_parquet(${lit(files.cover)})
                WHERE HYRIV_ID NOT IN (SELECT HYRIV_ID FROM read_parquet(${lit(reachesFile)}))) AS cover_unknown,
             (SELECT count(*) FROM read_parquet(${lit(reachesFile)})) AS reaches`);
    const coverKeys = await db.all(
      `SELECT DISTINCT name_key FROM read_parquet(${lit(files.cover)})`,
    );
    const outRows = await db.all(
      `SELECT name, name_key FROM read_parquet(${lit(files.reach)}) WHERE name IS NOT NULL`,
    );
    const everyAprhiNameAccounted = [...parsed.values()].every(
      (p) => p.starred || p.display !== null,
    );
    const aprhiKm = num(totals?.aprhi_km);
    const namedKm = [...preKey.keys()].reduce(
      (s, r) => s + (rawStats.get(r)?.km ?? 0),
      0,
    );
    const accounted = namedKm + starredKm + num(totals?.aprhi_unnamed_km);
    const checks = {
      oneRowPerReach:
        num(fileCheck?.reach_rows) === num(fileCheck?.reaches) &&
        num(fileCheck?.reach_ids) === num(fileCheck?.reaches),
      everyOutputReachExists:
        num(fileCheck?.reach_unknown) === 0 &&
        num(fileCheck?.cover_unknown) === 0,
      nameKeyMatchesName: outRows.every(
        (r) => r.name_key === nameKey(String(r.name)),
      ),
      everyCoverKeyHasAName: coverKeys.every((r) =>
        entries.has(String(r.name_key)),
      ),
      noStarredNameInOutputs:
        outRows.every((r) => !String(r.name).includes("*")) &&
        [...entries.values()].every(
          (e) =>
            !e.display.includes("*") &&
            [...e.parenthesized].every((a) => !a.includes("*")) &&
            e.ignAliases.every((a) => !a.name.includes("*")),
        ) &&
        starredRows.every((s) => !finalKeyOfRaw.has(s.raw)),
      everyAprhiNameParsed:
        everyAprhiNameAccounted && parsed.size === rawRows.length,
      aprhiKmAccounted: Math.abs(accounted - aprhiKm) <= 0.001 * aprhiKm,
      // An approved fix that matches no APRHI name is stale (the source or the parser changed).
      everyNameFixUsed: [...approvedFixes.keys()].every((k) =>
        usedFixes.has(k),
      ),
    };
    const identicalToPreviousRun =
      previousSha === null ? null : previousSha === sha;
    const ok =
      Object.values(checks).every(Boolean) && identicalToPreviousRun !== false;

    // 7. Statistics.
    const bySource = (s: "aprhi" | "ign") =>
      out.filter((o) => o.row.display && o.source === s);
    const confidence = (rows: typeof out) => {
      const c: Record<string, number> = { high: 0, medium: 0, low: 0, none: 0 };
      for (const o of rows)
        c[o.row.confidence] = (c[o.row.confidence] ?? 0) + 1;
      return c;
    };
    const kmOf = (rows: typeof out) =>
      round(
        rows.reduce((s, o) => s + o.km, 0),
        1,
      );
    const withCandidate = (s: "aprhi" | "ign") =>
      out.filter((o) => o.source === s);
    const distinctDisplay = new Set(
      out.filter((o) => o.row.display).map((o) => o.row.name_key),
    );
    const aprhiDisplayKeys = new Set(finalKeyOfRaw.values());
    const agreementTotal = agreement.agreeKm + agreement.disagreeKm;

    await writeReport("line-names", {
      ok,
      checks,
      pendingChecks: {
        identicalToPreviousRun,
        note: "null on a first run (no earlier outputs); run the step twice. false fails the step.",
      },
      config: { ...cfg, $comment: undefined },
      coverageBuffer: {
        bufferM: linesCfg.bufferM,
        bufferLargeM: linesCfg.bufferLargeM,
        largeMinStrahler: linesCfg.largeMinStrahler,
        source: "lines.config.json",
      },
      thresholds: {
        source: "ign.config.json (copied from nqn, provisional)",
        high: matchCfg.high,
        medium: matchCfg.medium,
        low: matchCfg.low,
      },
      distanceNote:
        "distances and shares are in South America Albers (a few percent off); km in this report are spheroid km of lines.parquet unless marked albers",
      sha256: sha,
      previousSha256: previousSha,
      aprhi: {
        pieces: num(totals?.aprhi_pieces),
        km: round(aprhiKm, 1),
        namedKm: round(namedKm, 1),
        starredBlankKm: round(starredKm, 1),
        unnamedInSourceKm: round(num(totals?.aprhi_unnamed_km), 1),
        rawDistinctNames: rawRows.length,
        starredNames: starredRows.length,
        starredPieces,
        starredEndingInStar: starEnding,
        starredWithStarElsewhere: starMid,
        namesAfterParsing: aprhiDisplayKeys.size,
        namesAfterIgnCorrection: [...entries.values()].filter((e) =>
          e.sources.has("aprhi"),
        ).length,
      },
      ign: {
        outsideProvince: {
          pieces: num(totals?.ign_pieces),
          km: round(num(totals?.ign_km), 1),
          namedKm: round(num(totals?.ign_named_km), 1),
          distinctNames: ignOutKeys.size,
        },
        insideProvinceForAliases: { namedDistinctNames: ignNames.size },
      },
      abbreviations: {
        note: "per rule: distinct raw names that use it, occurrences, and the km of those names (a name counts once per rule)",
        rules: Object.fromEntries(
          [...ruleStats]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, { ...v, km: round(v.km, 1) }]),
        ),
        unexpanded: [...unexpanded].map(([word, raws]) => ({
          word,
          names: raws,
        })),
      },
      parentheses: {
        namesWithParentheses: withParentheses,
        namesAddedAsAliases: parenAliases,
        qualifiersNotOffered: Object.fromEntries(excluded),
      },
      starred: {
        names: starredRows.length,
        pieces: starredPieces,
        km: round(starredKm, 1),
        note: "blank on the map; raw values in review.json (ask APRHI what '*' means)",
      },
      damagedNames: {
        correctedByOwner: corrections.length,
        corrections: corrections.slice(0, TOP),
        fixCandidates: fixCandidates.length,
        fixCandidateTop: fixCandidates.slice(0, TOP),
        unresolvedLookDamaged: unresolved.length,
        unresolved: unresolved.slice(0, TOP),
        nearMissesNotAlong: nearMisses.length,
        nearMissTop: nearMisses.slice(0, TOP),
        note: "fixes come only from names.config.json nameFixes (owner); fixCandidates are IGN spellings proposed for review; unresolved = heuristic (see review.json)",
      },
      aliases: {
        namesWithAliases: namesWithAlias,
        aliasesTotal: aliasTotal,
        ignAliasesAdded: aliasPairs,
        minShare: cfg.aliasMinShare,
      },
      ignAprhiAgreement: {
        note: "per APRHI name, its best IGN name with a share >= aliasMinShare; agree = the main name or a parenthesized name is the same in both (nameKey); km = the APRHI name's km",
        agreeKm: round(agreement.agreeKm, 1),
        disagreeKm: round(agreement.disagreeKm, 1),
        noIgnNameAlongKm: round(agreement.noIgnKm, 1),
        agreePctOfComparable:
          agreementTotal > 0
            ? round((agreement.agreeKm / agreementTotal) * 100, 1)
            : null,
        topDisagreements: disagreements.slice(0, TOP),
      },
      reaches: {
        total: out.length,
        namedDisplayed: out.filter((o) => o.row.display).length,
        distinctNamesDisplayed: distinctDisplay.size,
        namedDisplayedBySource: {
          aprhi: bySource("aprhi").length,
          ign: bySource("ign").length,
        },
        namedDisplayedKmBySource: {
          aprhi: kmOf(bySource("aprhi")),
          ign: kmOf(bySource("ign")),
        },
        withCandidateBySource: {
          aprhi: withCandidate("aprhi").length,
          ign: withCandidate("ign").length,
        },
        confidence: confidence(out),
        confidenceBySource: {
          aprhi: confidence(withCandidate("aprhi")),
          ign: confidence(withCandidate("ign")),
        },
        ambiguous: out.filter((o) => o.row.ambiguous).length,
        displayedByStrahler: Object.fromEntries(
          [...new Set(out.map((o) => o.strahler))]
            .sort((a, b) => a - b)
            .map((s) => [
              s,
              {
                reaches: out.filter((o) => o.strahler === s).length,
                displayed: out.filter((o) => o.strahler === s && o.row.display)
                  .length,
              },
            ]),
        ),
        displayedByRoot: Object.fromEntries(
          [...new Set(out.map((o) => o.root))].sort().map((root) => [
            root,
            {
              reaches: out.filter((o) => o.root === root).length,
              displayed: out.filter((o) => o.root === root && o.row.display)
                .length,
            },
          ]),
        ),
      },
      outputs: [
        ...Object.values(files).map(rel),
        rel(workPath("line-names/report.json")),
      ],
    });
    if (!ok)
      throw new Error(`line-names checks failed: ${JSON.stringify(checks)}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
