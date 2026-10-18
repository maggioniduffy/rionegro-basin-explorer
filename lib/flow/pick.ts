import type { Track } from "./geometry";
import type { FlowIndex } from "./schema";

type IndexRiver = FlowIndex["rivers"][number];
type IndexSection = IndexRiver["sections"][number];

const riverOf = (index: FlowIndex, slug: string): IndexRiver | undefined =>
  index.rivers.find((r) => r.slug === slug);

/** Whether the river has at least one section the flow view can show. */
export function riverHasFlow(index: FlowIndex, slug: string): boolean {
  return riverOf(index, slug)?.sections.some((s) => s.flowable) ?? false;
}

/** An index entry by section id, with its river's slug. */
export function findSection(
  index: FlowIndex,
  id: string,
): { river: string; section: IndexSection } | null {
  for (const r of index.rivers) {
    const section = r.sections.find((s) => s.id === id);
    if (section) return { river: r.slug, section };
  }
  return null;
}

/**
 * The flowable section of a river nearest a point (by section midpoint), else, without a
 * point, the most downstream flowable one (sections count from the source). Null if the river
 * has none.
 */
export function nearestSection(
  index: FlowIndex,
  slug: string,
  lngLat: readonly [number, number] | null,
): string | null {
  const flowable = riverOf(index, slug)?.sections.filter((s) => s.flowable);
  if (!flowable?.length) return null;
  if (!lngLat) return flowable.reduce((a, s) => (s.index > a.index ? s : a)).id;
  const k = Math.cos((lngLat[1] * Math.PI) / 180);
  let best = flowable[0]!;
  let bestD = Infinity;
  for (const s of flowable) {
    const d = (s.mid[0] - lngLat[0]) ** 2 * k * k + (s.mid[1] - lngLat[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best.id;
}

/**
 * Distance in metres from a point (Mercator, relative to the track origin) to the track's
 * centerline: the nearest point on any segment, not just the lateral offset toSection gives.
 */
export function distanceToTrackM(track: Track, px: number, py: number): number {
  const n = track.s.length;
  if (n === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < Math.max(1, n - 1); i++) {
    const ax = track.x[i]!;
    const ay = track.y[i]!;
    const bx = n > 1 ? track.x[i + 1]! - ax : 0;
    const by = n > 1 ? track.y[i + 1]! - ay : 0;
    const len2 = bx * bx + by * by;
    const t =
      len2 > 0
        ? Math.min(1, Math.max(0, ((px - ax) * bx + (py - ay) * by) / len2))
        : 0;
    const d =
      Math.hypot(px - (ax + bx * t), py - (ay + by * t)) / track.mPerUnit[i]!;
    if (d < best) best = d;
  }
  return best;
}
