import "server-only";
import { createHash } from "node:crypto";
import { getCatalogDocs, type CatalogDocs } from "@/lib/data/queries";
import {
  catalogEntries,
  createFuzzyIndex,
  type CatalogEntry,
  type FuzzyIndex,
} from "./fuzzy";
import type { KnownIds } from "./intent";

export interface Catalog {
  entries: CatalogEntry[];
  index: FuzzyIndex;
  /** The documents behind it (names, flowsInto, upstream area) for the LLM prompt. */
  docs: CatalogDocs;
  /** River and sub-basin ids an intent may select. */
  known: KnownIds;
  /** Changes when any id or name changes (a reseed), so cached answers expire with it. */
  version: string;
}

/** Data only changes when the seed runs; an hour bounds how stale a warm instance gets. */
export const CATALOG_TTL_MS = 60 * 60 * 1000;

let cached: { at: number; promise: Promise<Catalog> } | undefined;

/** Builds the catalog from documents (exported for tests). */
export function buildCatalog(docs: CatalogDocs): Catalog {
  const entries = catalogEntries(docs);
  const version = createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.kind, e.id, e.name])))
    .digest("hex")
    .slice(0, 8);
  return {
    entries,
    index: createFuzzyIndex(entries),
    docs,
    known: {
      rivers: new Set(docs.rivers.map((r) => r._id)),
      subbasins: new Set(docs.subbasins.map((s) => s._id)),
    },
    version,
  };
}

/**
 * Every river, sub-basin and stream name, held in memory per server instance (about 500
 * short names). Concurrent callers share one load; a failed load is not cached.
 */
export function getCatalog(now = Date.now()): Promise<Catalog> {
  if (!cached || now - cached.at > CATALOG_TTL_MS) {
    const promise = getCatalogDocs()
      .then(buildCatalog)
      .catch((error: unknown) => {
        if (cached?.promise === promise) cached = undefined;
        throw error;
      });
    cached = { at: now, promise };
  }
  return cached.promise;
}
