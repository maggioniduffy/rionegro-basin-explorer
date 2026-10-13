import type { RegionId } from "./index";

/**
 * The product name each region's wordmark shows: a proper noun, the same in every locale
 * (kept apart from content.ts so client components don't bundle the ask prompt).
 */
export const REGION_BRANDS: Record<RegionId, string> = {
  nqn: "Río Negro Basin Explorer",
};
