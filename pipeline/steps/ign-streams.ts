/**
 * pipeline:ign-streams — split each shown IGN name into real streams (detection only;
 * nothing under data/out changes).
 *
 * Inputs, read as pipeline:export reads them:
 *   data/work/rivers/reaches.parquet       HYRIV_ID, NEXT_DOWN, LENGTH_KM, geom (bbox)
 *   data/work/named/river_reaches.parquet  HYRIV_ID → river (approved rivers, pipeline:named)
 *   data/work/ign-match/reach_ign.parquet  HYRIV_ID → name, name_key, display
 *   data/work/ign-match/cover.parquet      HYRIV_ID, name_key → coverage
 *   pipeline/names.json                    approved river names and aliases (left out)
 *   pipeline/ign.config.json               line.minCoverage, line.maxGap
 * A reach carries an IGN name when `display` is true (export's `ign IS NOT NULL`).
 *
 * 1. Same-name reaches joined along NEXT_DOWN through at most maxGap unnamed reaches form
 *    one group (detectStreams); the unnamed reaches in between are absorbed.
 * 2. Each group keeps only the reaches the IGN line runs along (followIgnLines, owner
 *    2026-10-09): ends with coverage below line.minCoverage are pruned until every end is
 *    on the line, so reaches below it stay only between two reaches on the line, and at a
 *    fork only branches the line runs along stay. The rest of the group is dropped (export
 *    hides their IGN name).
 *
 * Outputs in data/work/ign-streams/: streams.json, dropped.json and report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { nameKey } from "../lib/names";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import type { MatchConfig } from "../lib/ign-match";
import {
  type DetectResult,
  type LineReach,
  type StreamReach,
  detectStreams,
  followIgnLines,
} from "../lib/streams";

/** Gap tolerances compared in the report, so the choice of line.maxGap is documented. */
const COMPARED_GAPS = [0, 1, 2];
/** Coverage thresholds compared in the report, so the choice of line.minCoverage is documented. */
const COMPARED_COVERAGE = [0.3, 0.4, 0.5, 0.6];
/** Single-reach streams shorter than this are listed for review. */
const SHORT_KM = 1;
/** Entries kept per list in the report. */
const LIST_CAP = 50;

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

interface Reach {
  id: number;
  nextDown: number;
  km: number;
  bbox: [number, number, number, number];
  river: string | null;
  name: string | null;
  key: string | null;
  /** Coverage of the shown name on this reach (0 when none, or for a "name" override). */
  coverage: number;
}

async function main() {
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const ignFile = requireInput(workPath("ign-match/reach_ign.parquet"));
  const coverFile = requireInput(workPath("ign-match/cover.parquet"));
  const { line } = JSON.parse(
    await readFile(`${ROOT}/pipeline/ign.config.json`, "utf8"),
  ) as MatchConfig;
  const MAX_GAP = line.maxGap;
  const approvedKeys = new Set(
    (
      JSON.parse(await readFile(`${ROOT}/pipeline/names.json`, "utf8")) as {
        rivers: { name: string; aliases?: string[] }[];
      }
    ).rivers.flatMap((r) => [r.name, ...(r.aliases ?? [])].map(nameKey)),
  );
  const outDir = workPath("ign-streams");
  await mkdir(outDir, { recursive: true });

  const db = await openDb();
  let rows;
  try {
    rows = await db.all(`
      SELECT r.HYRIV_ID AS id, r.NEXT_DOWN AS next_down, r.LENGTH_KM::DOUBLE AS km,
             ST_XMin(r.geom) AS xmin, ST_YMin(r.geom) AS ymin,
             ST_XMax(r.geom) AS xmax, ST_YMax(r.geom) AS ymax,
             m.river,
             CASE WHEN i.display THEN i.name END AS name,
             CASE WHEN i.display THEN i.name_key END AS name_key,
             c.coverage
      FROM ${lit(reachesFile)} r
      LEFT JOIN read_parquet(${lit(mappingFile)}) m USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(ignFile)}) i USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(coverFile)}) c
        ON c.HYRIV_ID = r.HYRIV_ID AND c.name_key = i.name_key AND i.display
      ORDER BY r.HYRIV_ID`);
  } finally {
    db.close();
  }
  const reaches: Reach[] = rows.map((r) => ({
    id: Number(r.id),
    nextDown: Number(r.next_down),
    km: Number(r.km),
    bbox: [Number(r.xmin), Number(r.ymin), Number(r.xmax), Number(r.ymax)],
    river: r.river == null ? null : String(r.river),
    name: r.name == null ? null : String(r.name),
    key: r.name_key == null ? null : String(r.name_key),
    coverage: r.coverage == null ? 0 : Number(r.coverage),
  }));
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const input: StreamReach[] = reaches.map((r) => ({
    id: r.id,
    nextDown: r.nextDown,
    key: r.key,
    river: r.river !== null,
  }));
  const detect = (maxGap: number) =>
    detectStreams(input, { maxGap, excludedKeys: approvedKeys });
  const kmOf = (ids: number[]) =>
    ids.reduce((s, id) => s + (byId.get(id)?.km ?? 0), 0);

  const summarize = (maxGap: number, res: DetectResult) => {
    const perKey = new Map<string, number>();
    for (const s of res.streams)
      perKey.set(s.key, (perKey.get(s.key) ?? 0) + 1);
    const absorbed = res.streams.flatMap((s) => s.absorbedReachIds);
    return {
      maxGap,
      streams: res.streams.length,
      namesSplit: [...perKey.values()].filter((n) => n > 1).length,
      absorbedReaches: absorbed.length,
      absorbedKm: round(kmOf(absorbed)),
      ambiguousGaps: res.ambiguousGaps.length,
    };
  };
  const byGap = COMPARED_GAPS.map((n) => summarize(n, detect(n)));
  const result = detect(MAX_GAP);

  // Keep only the reaches the IGN line runs along.
  const lineReaches = new Map<number, LineReach>(
    reaches.map((r) => [
      r.id,
      { id: r.id, nextDown: r.nextDown, coverage: r.coverage },
    ]),
  );
  const follow = (minCoverage: number) =>
    followIgnLines(result.streams, lineReaches, { minCoverage });
  const lines = follow(line.minCoverage);
  // Groups with no reach on the line at all (every named reach below the threshold).
  const groupsWithoutLine = (res: typeof lines) => {
    const covered = new Set(res.streams.flatMap((s) => s.reachIds));
    return result.streams.filter(
      (g) => !g.reachIds.some((id) => covered.has(id)),
    );
  };
  const byCoverage = COMPARED_COVERAGE.map((c) => {
    const res = c === line.minCoverage ? lines : follow(c);
    return {
      minCoverage: c,
      streams: res.streams.length,
      groupsLost: groupsWithoutLine(res).length,
      droppedReaches: res.droppedReachIds.length,
      droppedKm: round(kmOf(res.droppedReachIds)),
    };
  });
  // Group → its streams, for the report (groups split by the line, groups lost).
  const groupOfReach = new Map<number, string>();
  for (const g of result.streams)
    for (const id of g.reachIds) groupOfReach.set(id, g.id);
  const streamsPerGroup = new Map<string, number>();
  for (const s of lines.streams) {
    const g = groupOfReach.get(s.mouth)!;
    streamsPerGroup.set(g, (streamsPerGroup.get(g) ?? 0) + 1);
  }

  // Stream documents.
  const streams = lines.streams.map((s) => {
    const members = s.reachIds.map((id) => byId.get(id)!);
    const names = new Map<string, number>();
    for (const id of s.namedReachIds) {
      const n = byId.get(id)!.name!;
      names.set(n, (names.get(n) ?? 0) + 1);
    }
    // Most frequent spelling under the key; ties by name for stable output.
    const name = [...names.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]![0];
    return {
      id: s.id,
      name,
      nameKey: s.key,
      mouthReach: s.mouth,
      reachIds: s.reachIds,
      absorbedReachIds: s.absorbedReachIds,
      lengthKm: round(kmOf(s.reachIds)),
      bbox: [
        round(Math.min(...members.map((m) => m.bbox[0])), 5),
        round(Math.min(...members.map((m) => m.bbox[1])), 5),
        round(Math.max(...members.map((m) => m.bbox[2])), 5),
        round(Math.max(...members.map((m) => m.bbox[3])), 5),
      ],
    };
  });
  const streamsFile = `${outDir}/streams.json`;
  await writeFile(streamsFile, JSON.stringify(streams, null, 1) + "\n");
  // Named reaches left off every IGN line: export hides their IGN name.
  const droppedFile = `${outDir}/dropped.json`;
  await writeFile(
    droppedFile,
    JSON.stringify(
      lines.droppedReachIds
        .filter((id) => byId.get(id)!.key !== null)
        .map((id) => ({ HYRIV_ID: id, nameKey: byId.get(id)!.key })),
    ) + "\n",
  );

  // Review lists.
  // Receiving water: walk down from the mouth to the first reach on an approved river or
  // with a shown IGN name; count the unnamed reaches passed on the way.
  const receivingOf = (mouth: number) => {
    let id = byId.get(mouth)!.nextDown;
    let unnamed = 0;
    for (let steps = 0; steps <= reaches.length; steps++) {
      const r = byId.get(id);
      if (!r) return { receiving: "outlet", unnamedBetween: unnamed };
      if (r.river)
        return { receiving: `river:${r.river}`, unnamedBetween: unnamed };
      if (r.key) return { receiving: `ign:${r.key}`, unnamedBetween: unnamed };
      unnamed++;
      id = r.nextDown;
    }
    return { receiving: "cycle", unnamedBetween: unnamed };
  };
  const sameReceiving = new Map<string, typeof streams>();
  for (const s of streams) {
    const { receiving } = receivingOf(s.mouthReach);
    if (receiving === "outlet") continue;
    const k = `${s.nameKey}\u0000${receiving}`;
    sameReceiving.set(k, [...(sameReceiving.get(k) ?? []), s]);
  }
  const sharedReceiving = [...sameReceiving.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([k, list]) => ({
      nameKey: k.split("\u0000")[0],
      receiving: k.split("\u0000")[1],
      streams: list.map((s) => ({
        id: s.id,
        lengthKm: s.lengthKm,
        unnamedBetween: receivingOf(s.mouthReach).unnamedBetween,
      })),
    }))
    .sort((a, b) => b.streams.length - a.streams.length);
  const shortSingles = streams
    .filter((s) => s.reachIds.length === 1 && s.lengthKm < SHORT_KM)
    .map((s) => ({ id: s.id, lengthKm: round(kmOf(s.reachIds), 2) }));

  // Checks.
  const namedIds = reaches
    .filter((r) => r.key !== null && !approvedKeys.has(r.key))
    .map((r) => r.id);
  const seen = new Map<number, number>();
  for (const s of streams)
    for (const id of s.reachIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  const absorbedIds = streams.flatMap((s) => s.absorbedReachIds);
  const droppedSet = new Set(lines.droppedReachIds);
  const onLine = (id: number) =>
    (byId.get(id)?.coverage ?? 0) >= line.minCoverage;
  // A stream's ends (its mouth, and members with no member upstream) must be on the line.
  const endsOnLine = streams.every((s) => {
    const members = new Set(s.reachIds);
    const hasUp = new Set(
      s.reachIds
        .map((id) => byId.get(id)!.nextDown)
        .filter((d) => members.has(d)),
    );
    return (
      onLine(s.mouthReach) &&
      s.reachIds.every((id) => hasUp.has(id) || onLine(id))
    );
  });
  const checks = {
    everyNamedReachInOneStreamOrDropped: namedIds.every(
      (id) => (seen.get(id) ?? 0) + (droppedSet.has(id) ? 1 : 0) === 1,
    ),
    everyReachOnTheLineInAStream: namedIds
      .filter(onLine)
      .every((id) => seen.get(id) === 1),
    streamEndsOnTheLine: endsOnLine,
    noReachInTwoStreams: [...seen.values()].every((n) => n === 1),
    noApprovedRiverReachAbsorbed: absorbedIds.every(
      (id) => byId.get(id)?.river === null,
    ),
    idsUnique: new Set(streams.map((s) => s.id)).size === streams.length,
  };

  const perKey = new Map<string, number>();
  for (const s of streams)
    perKey.set(s.nameKey, (perKey.get(s.nameKey) ?? 0) + 1);
  const namedKm = kmOf(namedIds);
  await writeReport("ign-streams", {
    ok: Object.values(checks).every(Boolean),
    checks,
    maxGap: MAX_GAP,
    names: {
      considered: perKey.size,
      splitIntoSeveralStreams: [...perKey.values()].filter((n) => n > 1).length,
      excludedApprovedRiverKeys: new Set(
        reaches
          .filter((r) => r.key !== null && approvedKeys.has(r.key))
          .map((r) => r.key),
      ).size,
      mostSplit: [...perKey.entries()]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, LIST_CAP)
        .map(([key, n]) => ({ nameKey: key, streams: n })),
    },
    streams: streams.length,
    reaches: {
      named: namedIds.length,
      absorbed: absorbedIds.length,
      // Named reaches that also lie on an approved river (kept, as export groups them).
      namedOnApprovedRivers: namedIds.filter(
        (id) => byId.get(id)?.river !== null,
      ).length,
    },
    lengthKm: {
      named: round(namedKm),
      absorbed: round(kmOf(absorbedIds)),
    },
    byGap,
    line: {
      minCoverage: line.minCoverage,
      groups: result.streams.length,
      groupsSplitByTheLine: [...streamsPerGroup.values()].filter((n) => n > 1)
        .length,
      groupsLost: (() => {
        const lost = groupsWithoutLine(lines);
        return {
          count: lost.length,
          list: lost.slice(0, LIST_CAP).map((g) => ({
            id: g.id,
            reaches: g.reachIds.length,
            km: round(kmOf(g.reachIds), 2),
            maxCoverage: round(
              Math.max(...g.namedReachIds.map((id) => byId.get(id)!.coverage)),
              3,
            ),
          })),
        };
      })(),
      dropped: {
        reaches: lines.droppedReachIds.length,
        km: round(kmOf(lines.droppedReachIds)),
        named: lines.droppedReachIds.filter((id) => byId.get(id)!.key !== null)
          .length,
      },
      byCoverage,
    },
    ambiguous: {
      gapClaimedByTwoStreams: {
        count: result.ambiguousGaps.length,
        list: result.ambiguousGaps.slice(0, LIST_CAP),
      },
      sameNameSameReceiving: {
        count: sharedReceiving.length,
        list: sharedReceiving.slice(0, LIST_CAP),
      },
      singleReachUnder1Km: {
        count: shortSingles.length,
        list: shortSingles.slice(0, LIST_CAP),
      },
    },
    outputs: [rel(streamsFile), rel(droppedFile)],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
