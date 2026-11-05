import { describe, expect, it } from "vitest";
import { runEffluent } from "@/lib/effluent/use-run";

const REACH = 61477479; // the configured cba outfall's reach

describe("runEffluent", () => {
  it("is unavailable for the forecast when a scenario is set and there is no forecast", () => {
    const run = runEffluent(
      "cba",
      { reach: REACH, overrides: { scenario: "today" } },
      null,
    );
    expect(run.status).toBe("unavailable");
    expect(run).toMatchObject({ reason: "forecast" });
  });

  it("names the effluent field the model rejected", () => {
    const run = runEffluent(
      "cba",
      { reach: REACH, overrides: { flowM3s: -1 } },
      null,
    );
    expect(run).toMatchObject({
      status: "unavailable",
      reason: "inputs",
      field: "flowM3s",
    });
  });

  it("computes the admissible load on the untreated effluent", () => {
    const raw = runEffluent(
      "cba",
      { reach: REACH, overrides: { bodMgL: 200 } },
      null,
    );
    const treated = runEffluent(
      "cba",
      { reach: REACH, overrides: { bodMgL: 200, removalPct: 50 } },
      null,
    );
    if (raw.status !== "ok" || treated.status !== "ok")
      throw new Error("not ok");
    expect(treated.inputs.effluent.bodMgL).toBe(100);
    expect(treated.inputs.rawEffluent.bodMgL).toBe(200);
    expect(treated.admissible.bod.requiredRemovalPct).toBe(
      raw.admissible.bod.requiredRemovalPct,
    );
  });
});
