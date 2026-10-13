/**
 * Region registry (PLAN.md, Multi-region). Each region is a folder regions/<id>/; the app and
 * the pipeline pick one by id. `nqn` is the Río Negro basin (Limay, Neuquén, Negro); `cba`
 * is Córdoba (province and nearby interprovincial basins), known but not served yet.
 */

/** Every region the pipeline and the data scripts accept (--region), served or not. */
export const KNOWN_REGION_IDS = ["nqn", "cba"] as const;

export type KnownRegionId = (typeof KNOWN_REGION_IDS)[number];

export function isKnownRegionId(value: unknown): value is KnownRegionId {
  return (KNOWN_REGION_IDS as readonly unknown[]).includes(value);
}

/**
 * Regions the app serves. A region joins this list only once its app content exists:
 * adding its id makes TypeScript name every per-region record still missing it (map
 * config, messages, content, landing sample, OG shapes, landing image). See
 * regions/cba/README.md for the checklist.
 */
export const REGION_IDS = [
  "nqn",
  "cba",
] as const satisfies readonly KnownRegionId[];

export type RegionId = (typeof REGION_IDS)[number];

/** The region served for hosts that name no region (rionegrobasinexplorer.vercel.app, localhost). */
export const DEFAULT_REGION: RegionId = "nqn";

export function isRegionId(value: unknown): value is RegionId {
  return (REGION_IDS as readonly unknown[]).includes(value);
}

/**
 * Each region has its own Mongo database on the same cluster, named after MONGODB_DB (the
 * base name). `nqn` keeps the base name itself, the database seeded before regions existed;
 * every other region appends `-<id>` (e.g. basin-explorer-cba).
 */
const DB_SUFFIX: Record<KnownRegionId, string> = { nqn: "", cba: "-cba" };

export function regionDbName(base: string, region: KnownRegionId): string {
  return `${base}${DB_SUFFIX[region]}`;
}
