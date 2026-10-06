import { describe, expect, it } from "vitest";
import sample from "../app/landing-sample.json";
import { buildLandingSample } from "../scripts/landing-sample";

describe("landing sample", () => {
  it("matches data/out (run npm run landing:sample if not)", () => {
    expect(sample).toEqual(buildLandingSample());
  });
});
