export interface NameVote {
  name: string;
  /** Number of sample points where this name was found. */
  points: number;
}

/**
 * Tally names found at each sample point along a segment. A name counts once per
 * point, so a river mapped as many short ways does not outvote a single long one.
 * Sorted by points, then name, for stable output.
 */
export function tallyNames(
  namesPerPoint: readonly (readonly string[])[],
): NameVote[] {
  const counts = new Map<string, number>();
  for (const names of namesPerPoint) {
    for (const name of new Set(names))
      counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** Evenly spaced picks from a list, always including the first and last. */
export function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))] as T,
  );
}
