import { describe, expect, it } from "vitest";
import { REGION_IDS } from "../regions";
import { LANDING_SAMPLES } from "../regions/generated";
import { buildLandingSample } from "../scripts/landing-sample";

describe("landing sample", () => {
  it.each(REGION_IDS)(
    "%s matches data/out (run npm run landing:sample -- --region <id> if not)",
    (region) => {
      expect(LANDING_SAMPLES[region]).toEqual(buildLandingSample(region));
    },
  );
});
