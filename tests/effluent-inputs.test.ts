import { describe, expect, it } from "vitest";
import {
  INPUT_BOUNDS,
  roundInput,
  type InputField,
} from "@/lib/effluent/inputs";
import { effluentSearch, parseEffluent } from "@/lib/url-state";

const AWKWARD: [InputField, number][] = [
  ["bodMgL", 0.1 + 0.2],
  ["doMgL", 0.1 + 0.2],
  ["coliformsPer100mL", 1.23456e8],
  ["flowM3s", 1e-7],
  ["bodMgL", 2000],
  ["removalPct", -5],
  ["doMinMgL", 0.1 + 0.2],
  ["coliformsThreshold", 123456],
  ["tempC", 20.26],
];

describe("roundInput", () => {
  it.each(AWKWARD)(
    "%s %s stays in bounds and round-trips through ?ef=",
    (field, n) => {
      const v = roundInput(field, n)!;
      const { min, max } = INPUT_BOUNDS[field];
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
      expect(String(v)).toMatch(/^\d+(\.\d+)?$/);
      const search = effluentSearch(new URLSearchParams(), {
        reach: 1,
        overrides: { [field]: v },
      });
      const back = parseEffluent(new URLSearchParams(search));
      // A removal of 0 is the default and is dropped on purpose.
      expect(back?.overrides[field]).toBe(
        v === 0 && field === "removalPct" ? undefined : v,
      );
    },
  );

  it("rounds coliforms to two significant digits", () => {
    expect(roundInput("coliformsPer100mL", 1.23456e8)).toBe(120000000);
  });
});
