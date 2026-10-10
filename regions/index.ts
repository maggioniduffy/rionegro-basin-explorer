/**
 * Region registry (PLAN.md, Multi-region). Each region is a folder regions/<id>/ with its
 * pipeline configs; the app and the pipeline pick one by id. `nqn` is the Río Negro basin
 * (Limay, Neuquén, Negro).
 */
export const REGION_IDS = ["nqn"] as const;

export type RegionId = (typeof REGION_IDS)[number];

/** The region served for unknown hosts and used by pipeline steps without --region. */
export const DEFAULT_REGION: RegionId = "nqn";

export function isRegionId(value: unknown): value is RegionId {
  return (REGION_IDS as readonly unknown[]).includes(value);
}

/**
 * Each region has its own Mongo database on the same cluster, named after MONGODB_DB (the
 * base name). `nqn` keeps the base name itself, the database seeded before regions existed;
 * every other region appends `-<id>` (e.g. basin-explorer-cba).
 */
const DB_SUFFIX: Record<RegionId, string> = { nqn: "" };

export function regionDbName(base: string, region: RegionId): string {
  return `${base}${DB_SUFFIX[region]}`;
}
