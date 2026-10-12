/**
 * Pure helpers for pipeline:basin in reference mode (DuckDB-free, so they are unit-tested):
 * the main-stem walk that finds where a river enters the region, and the choice and
 * classification of a root's exit reach. Ids are strings throughout (HYRIV_ID is an INTEGER
 * that the DuckDB wrapper may return as a number or string).
 */
import { upstreamIndex } from "./graph";

export interface Reach {
  id: string;
  /** NEXT_DOWN: "0" at a terminal reach. */
  nextDown: string;
  /** UPLAND_SKM, km². */
  upland: number;
}

const byId = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true });

/** Larger upland first; ties go to the lowest id so the result is deterministic. */
const biggerUpland = (a: Reach, b: Reach) =>
  b.upland - a.upland || byId(a.id, b.id);

export interface MainStemWalk {
  /** First reach (walking upstream from the mouth) for which `isOutside` is true. */
  entry: string;
  /** Reaches walked, mouth first, ending with `entry`. */
  path: string[];
}

/**
 * Walk the main stem upstream from `mouthId`: at each step take the upstream reach
 * (NEXT_DOWN = current) with the largest UPLAND_SKM. Stop at the first reach, the mouth
 * included, for which `isOutside` is true. Returns null when the stem reaches a headwater
 * without ever leaving, and throws if the mouth is not among the reaches.
 */
export function walkMainStem(
  reaches: Iterable<Reach>,
  mouthId: string,
  isOutside: (id: string) => boolean,
): MainStemWalk | null {
  const all = new Map<string, Reach>();
  for (const r of reaches) all.set(r.id, r);
  if (!all.has(mouthId))
    throw new Error(`mouth reach ${mouthId} is not among the reaches`);
  const index = upstreamIndex(
    [...all.values()].map((r) => ({ id: r.id, nextDown: r.nextDown })),
  );
  const path: string[] = [];
  const seen = new Set<string>();
  let current = mouthId;
  for (;;) {
    if (seen.has(current))
      throw new Error(`cycle in the reach graph at ${current}`);
    seen.add(current);
    path.push(current);
    if (isOutside(current)) return { entry: current, path };
    const ups = (index.get(current) ?? [])
      .map((id) => all.get(id) as Reach)
      .sort(biggerUpland);
    const next = ups[0];
    if (!next) return null;
    current = next.id;
  }
}

export type ExitKind = "sink" | "sea" | "leaves-region" | "into-root";

/**
 * How a reach ends. `nextRoot` is the root code holding the reach NEXT_DOWN points to (null
 * when that reach belongs to no root or is unknown).
 *  - sink:          NEXT_DOWN = 0 and ENDORHEIC = 1
 *  - sea:           NEXT_DOWN = 0 and ENDORHEIC != 1
 *  - into-root:     NEXT_DOWN is a reach of another root (`intoCode` = that root)
 *  - leaves-region: NEXT_DOWN is a reach outside every root
 */
export function classifyExit(
  reach: { nextDown: string; endorheic: number },
  nextRoot: string | null,
): { kind: ExitKind; intoCode: string | null } {
  if (reach.nextDown === "0")
    return { kind: reach.endorheic === 1 ? "sink" : "sea", intoCode: null };
  if (nextRoot === null) return { kind: "leaves-region", intoCode: null };
  return { kind: "into-root", intoCode: nextRoot };
}

export interface ExitCandidate {
  id: string;
  upland: number;
  kind: ExitKind;
  intoCode: string | null;
}

export interface PickedExit<T extends ExitCandidate> {
  /** The expected candidate when `expectedId` is set, else the largest; null if none/not a candidate. */
  exit: T | null;
  /** The candidate with the largest upland (ties: lowest id). */
  largest: T | null;
  /** Whether `exit` is `largest` (informational). */
  exitIsLargest: boolean;
  /** Whether the expected reach is a candidate; null when nothing is expected. */
  expectedIsCandidate: boolean | null;
  /** Candidates other than `exit` with at least `minOtherUpland` km², largest first. */
  others: T[];
}

/**
 * Choose a root's exit. With `expectedId` the exit IS that reach, provided it is among the
 * candidates (otherwise exit is null and expectedIsCandidate false). Without one, the exit is
 * the candidate with the largest upland.
 */
export function pickExit<T extends ExitCandidate>(
  candidates: readonly T[],
  expectedId: string | null,
  minOtherUpland: number,
): PickedExit<T> {
  const sorted = [...candidates].sort(
    (a, b) => b.upland - a.upland || byId(a.id, b.id),
  );
  const largest = sorted[0] ?? null;
  const expected =
    expectedId === null
      ? null
      : (sorted.find((c) => c.id === expectedId) ?? null);
  const exit = expectedId === null ? largest : expected;
  return {
    exit,
    largest,
    exitIsLargest: exit !== null && exit === largest,
    expectedIsCandidate: expectedId === null ? null : expected !== null,
    others: sorted.filter((c) => c !== exit && c.upland >= minOtherUpland),
  };
}

/** True when `a` is within `pct` percent of `b` (b > 0). */
export function withinPct(a: number, b: number, pct: number): boolean {
  return b > 0 && Math.abs(((a - b) / b) * 100) <= pct;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Allowed gap (km²) between a root's polygon area and the area of its level-12 members:
 * the larger of `pct` percent of the root area and two median member polygons. Majority-share
 * assignment can only be off by whole polygons along the root's edge, so for small roots a
 * percentage cannot be met; two polygons is the allowance.
 */
export function lev12Tolerance(
  rootAreaKm2: number,
  memberAreasKm2: readonly number[],
  pct: number,
): number {
  return Math.max((rootAreaKm2 * pct) / 100, 2 * median(memberAreasKm2));
}
