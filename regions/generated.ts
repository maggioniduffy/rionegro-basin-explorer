import nqnSample from "./nqn/landing-sample.json";
import nqnShapes from "./nqn/og-shapes.json";
import type { RegionId } from "./index";

export type LandingSample = typeof nqnSample;
export type OgShapes = typeof nqnShapes;

/** Generated per region by `npm run landing:sample -- --region <id>`. */
export const LANDING_SAMPLES: Record<RegionId, LandingSample> = {
  nqn: nqnSample,
};

/** Generated per region by `npx tsx scripts/og-shapes.ts --region <id>`. */
export const OG_SHAPES: Record<RegionId, OgShapes> = { nqn: nqnShapes };
