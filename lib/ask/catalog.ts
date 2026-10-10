import "server-only";
import { createHash } from "node:crypto";
import { getCatalogDocs, type CatalogDocs } from "@/lib/data/queries";
import type { RegionId } from "@/regions";
import {
  catalogEntries,
  createFuzzyIndex,
  type CatalogEntry,
  type FuzzyIndex,
} from "./fuzzy";
import type { KnownIds } from "./intent";

export interface Catalog {
  /** The region whose database the documents came from. */
  region: RegionId;
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

/** One catalog per region. */
const cached = new Map<RegionId, { at: number; promise: Promise<Catalog> }>();

/** Builds the catalog from documents (exported for tests). */
export function buildCatalog(region: RegionId, docs: CatalogDocs): Catalog {
  const entries = catalogEntries(docs);
  const version = createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.kind, e.id, e.name])))
    .digest("hex")
    .slice(0, 8);
  return {
    region,
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
 * Every river, sub-basin and stream name of a region, held in memory per server instance
 * (about 500 short names for nqn). Concurrent callers share one load; a failed load is
 * not cached.
 */
export function getCatalog(
  region: RegionId,
  now = Date.now(),
): Promise<Catalog> {
  const current = cached.get(region);
  if (current && now - current.at <= CATALOG_TTL_MS) return current.promise;
  const promise = getCatalogDocs(region)
    .then((docs) => buildCatalog(region, docs))
    .catch((error: unknown) => {
      if (cached.get(region)?.promise === promise) cached.delete(region);
      throw error;
    });
  cached.set(region, { at: now, promise });
  return promise;
}
