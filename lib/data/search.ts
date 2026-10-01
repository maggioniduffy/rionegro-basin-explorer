/**
 * Accent- and case-insensitive search key: "Río Collón Curá" → "rio collon cura".
 * Used for stored river names (seed) and for queries (/api/search).
 */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinct normalized names a river can be found by. */
export function searchTerms(names: string[]): string[] {
  return [...new Set(names.map(normalizeSearch).filter(Boolean))];
}
