/**
 * pipeline:ign-streams — split each shown IGN name into real streams (detection only;
 * nothing under data/out changes).
 *
 * Inputs, read as pipeline:export reads them:
 *   data/work/rivers/reaches.parquet       HYRIV_ID, NEXT_DOWN, LENGTH_KM, geom (bbox)
 *   data/work/named/river_reaches.parquet  HYRIV_ID → river (approved rivers, pipeline:named)
 *   data/work/ign-match/reach_ign.parquet  HYRIV_ID → name, name_key, display
 *   pipeline/names.json                    approved river names and aliases (left out)
 * A reach carries an IGN name when `display` is true (export's `ign IS NOT NULL`).
 *
 * Same-name reaches joined along NEXT_DOWN through at most MAX_GAP unnamed reaches form
 * one stream (pipeline/lib/streams.ts); the unnamed reaches in between are absorbed.
 *
 * Outputs in data/work/ign-streams/: streams.json and report.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lit, openDb } from "../lib/duckdb";
import { requireInput } from "../lib/inputs";
import { nameKey } from "../lib/names";
import { ROOT, rel, workPath } from "../lib/paths";
import { writeReport } from "../lib/report";
import {
  type DetectResult,
  type StreamReach,
  detectStreams,
} from "../lib/streams";

/** Most unnamed reaches allowed between two parts of the same stream (project decision). */
export const MAX_GAP = 2;
/** Gap tolerances compared in the report, so the choice of MAX_GAP is documented. */
const COMPARED_GAPS = [0, 1, 2];
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
}

async function main() {
  const reachesFile = requireInput(workPath("rivers/reaches.parquet"));
  const mappingFile = requireInput(workPath("named/river_reaches.parquet"));
  const ignFile = requireInput(workPath("ign-match/reach_ign.parquet"));
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
             CASE WHEN i.display THEN i.name_key END AS name_key
      FROM ${lit(reachesFile)} r
      LEFT JOIN read_parquet(${lit(mappingFile)}) m USING (HYRIV_ID)
      LEFT JOIN read_parquet(${lit(ignFile)}) i USING (HYRIV_ID)
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

  // Stream documents.
  const streams = result.streams.map((s) => {
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
  const checks = {
    everyNamedReachInOneStream: namedIds.every((id) => seen.get(id) === 1),
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
    outputs: [rel(streamsFile)],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
