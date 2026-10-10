import "server-only";
import { getCatalogDocs } from "@/lib/data/queries";
import {
  catalogEntries,
  createFuzzyIndex,
  type CatalogEntry,
  type FuzzyIndex,
} from "./fuzzy";

export interface Catalog {
  entries: CatalogEntry[];
  index: FuzzyIndex;
}

/** Data only changes when the seed runs; an hour bounds how stale a warm instance gets. */
export const CATALOG_TTL_MS = 60 * 60 * 1000;

let cached: { at: number; promise: Promise<Catalog> } | undefined;

async function load(): Promise<Catalog> {
  const entries = catalogEntries(await getCatalogDocs());
  return { entries, index: createFuzzyIndex(entries) };
}

/**
 * Every river, sub-basin and stream name, held in memory per server instance (about 500
 * short names). Concurrent callers share one load; a failed load is not cached.
 */
export function getCatalog(now = Date.now()): Promise<Catalog> {
  if (!cached || now - cached.at > CATALOG_TTL_MS) {
    const promise = load().catch((error: unknown) => {
      if (cached?.promise === promise) cached = undefined;
      throw error;
    });
    cached = { at: now, promise };
  }
  return cached.promise;
}
