import type { RegionId } from "@/regions";
import type { SimulationResult, Thresholds } from "./river";
import { getEffluentRegion } from "./registry";

/** Whether the region has an effluent config and net; the gate for everything effluent. */
export const hasEffluent = (region: RegionId) =>
  getEffluentRegion(region) !== null;

const netIds = new Map<RegionId, Set<number>>();

/** The ids of the reaches of the region's effluent net; null for a region without one. */
export function netReachIds(region: RegionId): Set<number> | null {
  const effluent = getEffluentRegion(region);
  if (!effluent) return null;
  let ids = netIds.get(region);
  if (!ids) {
    ids = new Set(effluent.net.reaches.map((r) => r.id));
    netIds.set(region, ids);
  }
  return ids;
}

export type ReachStatus = "exceeds" | "within";

/**
 * Each reach of the simulated path as "exceeds" (the DO minimum is below its threshold, or the
 * coliforms or BOD of a sample are above a threshold that has a value) or "within".
 */
export function reachStatus(
  result: SimulationResult,
  thresholds: Thresholds,
): Map<number, ReachStatus> {
  const out = new Map<number, ReachStatus>();
  for (const reach of result.path) {
    const exceeds =
      reach.doMinMgL < thresholds.doMinMgL ||
      reach.samples.some(
        (s) =>
          (thresholds.bodMgL !== null && s.bodMgL > thresholds.bodMgL) ||
          (thresholds.coliformsPer100mL !== null &&
            s.coliformsPer100mL !== null &&
            s.coliformsPer100mL > thresholds.coliformsPer100mL),
      );
    out.set(reach.id, exceeds ? "exceeds" : "within");
  }
  return out;
}
