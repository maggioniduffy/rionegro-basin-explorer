import Fuse from "fuse.js";
import type { CatalogDocs } from "@/lib/data/queries";
import type { Bbox } from "@/lib/data/schemas";
import { normalizeSearch } from "@/lib/data/search";

export type CatalogKind = "river" | "subbasin" | "stream";

/** Something a typed name can resolve to. Names come from the seeded documents. */
export interface CatalogEntry {
  kind: CatalogKind;
  id: string;
  /** Display name; null for endorheic land, which has no name and no terms. */
  name: string | null;
  /** Normalized names it is found by (see nameTerms). */
  terms: string[];
  /** Tie-break between equally good matches: lengthKm for rivers and streams, areaKm2 for sub-basins. */
  rank: number;
  /** Streams only: the extent of all its reaches and the sub-basin holding its mouth. */
  bbox?: Bbox;
  subbasin?: string | null;
}

export interface FuzzyMatch {
  entry: CatalogEntry;
  /** 0–1 edit-distance similarity between the query and the best matching term. */
  confidence: number;
}

// Generic first words of IGN and HydroRIVERS names; "collon cura" should find "Río Collón Curá".
const GENERIC_PREFIX = /^(rio|arroyo|canada|canadon) /;

/** Normalized names plus each one without its generic first word. */
export function nameTerms(names: string[]): string[] {
  const full = names.map(normalizeSearch).filter(Boolean);
  const bare = full.map((n) => n.replace(GENERIC_PREFIX, ""));
  return [...new Set([...full, ...bare])];
}

/** Levenshtein distance, two rows (names are short). */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      // Every index read here is already filled; `?? 0` only satisfies the type checker.
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** 1 for equal strings, 0 for nothing in common: "limai" vs "limay" → 0.8. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - editDistance(a, b) / len;
}

/** Catalog entries from the seeded documents; endorheic land has no name, so no terms. */
export function catalogEntries(docs: CatalogDocs): CatalogEntry[] {
  return [
    ...docs.rivers.map((r) => ({
      kind: "river" as const,
      id: r._id,
      name: r.name,
      terms: nameTerms([r.name, r.shortName, ...r.aliases]),
      rank: r.lengthKm,
    })),
    ...docs.subbasins.map((s) => ({
      kind: "subbasin" as const,
      id: s._id,
      name: s.name,
      terms: s.name === null ? [] : nameTerms([s.name]),
      rank: s.areaKm2,
    })),
    ...docs.streams.map((s) => ({
      kind: "stream" as const,
      id: s._id,
      name: s.name,
      terms: nameTerms([s.name]),
      rank: s.lengthKm,
      bbox: s.bbox,
      subbasin: s.subbasin,
    })),
  ];
}

interface TermRecord {
  term: string;
  entry: CatalogEntry;
}

export type FuzzyIndex = Fuse<TermRecord>;

/**
 * One record per term, so each name variant is scored on its own. Fuse only finds
 * candidates: its score treats a substring as a perfect match ("neu" in "neuquen"), so the
 * confidence is the edit-distance similarity instead.
 */
export function createFuzzyIndex(entries: CatalogEntry[]): FuzzyIndex {
  const records = entries.flatMap((entry) =>
    entry.terms.map((term) => ({ term, entry })),
  );
  return new Fuse(records, {
    keys: ["term"],
    includeScore: true,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    threshold: 0.4,
  });
}

// Equal confidence: a river before its sub-basin before a stream, then the larger one.
const KIND_ORDER: Record<CatalogKind, number> = {
  river: 0,
  subbasin: 1,
  stream: 2,
};

/** Best match per entry for a typed name, most confident first. */
export function fuzzyMatch(
  index: FuzzyIndex,
  query: string,
  opts: { kinds?: CatalogKind[]; limit?: number } = {},
): FuzzyMatch[] {
  const q = normalizeSearch(query);
  if (q === "") return [];
  const best = new Map<CatalogEntry, number>();
  for (const { item } of index.search(q)) {
    if (opts.kinds && !opts.kinds.includes(item.entry.kind)) continue;
    const score = Math.max(
      similarity(q, item.term),
      similarity(q.replace(GENERIC_PREFIX, ""), item.term),
    );
    if (score > (best.get(item.entry) ?? -1)) best.set(item.entry, score);
  }
  return [...best]
    .map(([entry, score]) => ({
      entry,
      confidence: Math.round(score * 1000) / 1000,
    }))
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] ||
        b.entry.rank - a.entry.rank,
    )
    .slice(0, opts.limit ?? 8);
}
