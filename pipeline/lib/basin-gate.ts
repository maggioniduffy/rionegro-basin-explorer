/**
 * Pure logic for pipeline:basin-gate (DuckDB-free, so it is unit-tested): assigning
 * HydroBASINS level-12 polygons to reference (APRHI) basins, finding the terminal polygons
 * ("roots") of a group, and a few small measures. Ids are strings throughout (HYBAS_ID is a
 * BIGINT that the DuckDB wrapper returns as a string).
 */
import { upstreamSet } from "./graph";

export interface Overlap {
  /** Reference basin key (its code). */
  key: string;
  km2: number;
}

export interface Assignment {
  /** The winning key, or null when no reference basin holds `minShare` of the polygon. */
  key: string | null;
  /** The largest overlap share found (0..1), reported even when it is below `minShare`. */
  share: number;
}

/** Shares closer than this are a tie (area sums carry rounding noise). */
const TIE_EPS = 1e-9;

const byKey = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true });

/**
 * Assign a polygon of `areaKm2` to the reference basin with the largest overlap share, if
 * that share is at least `minShare`. Ties go to the lowest key, so the result is
 * deterministic. Overlaps of the same key are summed.
 */
export function assignLargestShare(
  overlaps: readonly Overlap[],
  areaKm2: number,
  minShare: number,
): Assignment {
  if (!(areaKm2 > 0)) return { key: null, share: 0 };
  const sums = new Map<string, number>();
  for (const o of overlaps) sums.set(o.key, (sums.get(o.key) ?? 0) + o.km2);
  let best: string | null = null;
  let bestShare = 0;
  for (const key of [...sums.keys()].sort(byKey)) {
    const share = Math.min(1, (sums.get(key) ?? 0) / areaKm2);
    // Keys are visited in ascending order, so only a strictly larger share replaces the winner.
    if (share > bestShare + TIE_EPS) {
      best = key;
      bestShare = share;
    }
  }
  return {
    key: best !== null && bestShare >= minShare ? best : null,
    share: bestShare,
  };
}

/** One HydroBASINS level-12 polygon's link to its downstream neighbor. */
export interface Lev12Link {
  id: string;
  /** NEXT_DOWN: "0" at a terminal polygon. */
  nextDown: string;
  /** ENDO: 0 not endorheic, 1 part of an endorheic basin, 2 endorheic sink. */
  endo: number;
}

export type RootKind = "sea" | "sink" | "virtual-sink" | "flows-out";

/**
 * How a terminal polygon of a group ends.
 *  - sea:          NEXT_DOWN = 0 and ENDO != 2
 *  - sink:         NEXT_DOWN = 0 and ENDO = 2 (a true endorheic sink)
 *  - virtual-sink: ENDO = 2 and NEXT_DOWN > 0 (HydroBASINS links some sinks to the
 *                  surrounding basin; TechDoc v1c)
 *  - flows-out:    NEXT_DOWN > 0, ENDO != 2, into a polygon outside the group
 */
export function rootKind(nextDown: string, endo: number): RootKind {
  if (nextDown === "0") return endo === 2 ? "sink" : "sea";
  return endo === 2 ? "virtual-sink" : "flows-out";
}

export interface Root {
  id: string;
  kind: RootKind;
  /** Target polygon of NEXT_DOWN, null when it is 0. */
  intoId: string | null;
  /** Group code of the target polygon; null if it is unassigned, unknown or NEXT_DOWN is 0. */
  intoCode: string | null;
}

/**
 * The terminal polygons of a group: members whose NEXT_DOWN is 0 or points outside the group.
 * `groupOf` gives the group code of any polygon id (null if unassigned or unknown).
 */
export function findRoots(
  links: readonly Lev12Link[],
  members: ReadonlySet<string>,
  groupOf: (id: string) => string | null,
): Root[] {
  const roots: Root[] = [];
  for (const l of links) {
    if (!members.has(l.id)) continue;
    if (l.nextDown !== "0" && members.has(l.nextDown)) continue;
    const into = l.nextDown === "0" ? null : l.nextDown;
    roots.push({
      id: l.id,
      kind: rootKind(l.nextDown, l.endo),
      intoId: into,
      intoCode: into === null ? null : groupOf(into),
    });
  }
  return roots;
}

/** Roots at or above `minUpArea` (largest first), and the count and area of the rest. */
export function splitRootsByUpArea<
  T extends { upArea: number; subArea: number },
>(
  roots: readonly T[],
  minUpArea: number,
): { large: T[]; small: { count: number; subAreaKm2: number } } {
  const large = roots
    .filter((r) => r.upArea >= minUpArea)
    .sort((a, b) => b.upArea - a.upArea);
  const rest = roots.filter((r) => r.upArea < minUpArea);
  return {
    large,
    small: {
      count: rest.length,
      subAreaKm2: rest.reduce((s, r) => s + r.subArea, 0),
    },
  };
}

/**
 * Polygons upstream of the group's roots that are not members: where the reference outline
 * cuts a HydroBASINS drainage. `index` is the upstream index of every polygon (graph.ts).
 */
export function upstreamOutside(
  index: Map<string, string[]>,
  rootIds: readonly string[],
  members: ReadonlySet<string>,
): Set<string> {
  const outside = new Set<string>();
  for (const root of rootIds)
    for (const id of upstreamSet(index, root))
      if (!members.has(id)) outside.add(id);
  return outside;
}

/** Sum `value` over `ids` by group code (null = unassigned), largest first, at most `top`. */
export function sumByGroup(
  ids: Iterable<string>,
  groupOf: (id: string) => string | null,
  value: (id: string) => number,
  top: number,
): { code: string | null; km2: number }[] {
  const sums = new Map<string | null, number>();
  for (const id of ids) {
    const code = groupOf(id);
    sums.set(code, (sums.get(code) ?? 0) + value(id));
  }
  return [...sums]
    .map(([code, km2]) => ({ code, km2 }))
    .sort(
      (a, b) =>
        b.km2 - a.km2 ||
        byKey(a.code ?? "~unassigned", b.code ?? "~unassigned"),
    )
    .slice(0, top);
}

/** Intersection over union from the intersection and both areas; 0 for two empty shapes. */
export function iou(interKm2: number, aKm2: number, bKm2: number): number {
  const union = aKm2 + bKm2 - interKm2;
  return union > 0 ? interKm2 / union : 0;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export interface Box {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export const boxInside = (inner: Box, outer: Box) =>
  inner.xmin >= outer.xmin &&
  inner.ymin >= outer.ymin &&
  inner.xmax <= outer.xmax &&
  inner.ymax <= outer.ymax;
