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
