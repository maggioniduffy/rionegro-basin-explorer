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

/** URL/ID-safe slug: "Collón Curá" → "collon-cura". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** An IGN name as stored: Unicode NFC, whitespace trimmed and collapsed; null if empty. */
export function cleanName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return name === "" ? null : name;
}

/**
 * Comparison key for a name: no accents, lower case, punctuation as spaces. "Río Negro
 * (Brazo Norte)" and "Río Negro Brazo Norte" share a key; so do "Poñihue" and "Poñihué".
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9°]+/g, " ")
    .trim();
}

/**
 * A river's id: its `slug` in pipeline/names.json, which stays fixed once published even
 * when the name changes; otherwise the slug of its short name.
 */
export function riverSlug(entry: { slug?: string; shortName: string }): string {
  return entry.slug ?? slugify(entry.shortName);
}
