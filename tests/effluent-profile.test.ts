import { describe, expect, it } from "vitest";
import { envelopeOf, profileOf, type Profile } from "@/lib/effluent/profile";
import type { SimulationResult } from "@/lib/effluent/river";

const sample = (km: number, doMgL: number) => ({
  km,
  bodMgL: 1,
  doMgL,
  deficitMgL: 0,
  coliformsPer100mL: null,
  tpMgL: null,
});

describe("profileOf", () => {
  it("keeps the downstream reach's sample at a shared boundary km", () => {
    const result = {
      path: [
        { id: 1, samples: [sample(0, 7), sample(2, 5)] },
        { id: 2, samples: [sample(2, 6), sample(4, 4)] },
      ],
    } as unknown as SimulationResult;
    expect(profileOf(result).map((p) => [p.km, p.reachId, p.doMgL])).toEqual([
      [0, 1, 7],
      [2, 2, 6],
      [4, 2, 4],
    ]);
  });
});

describe("envelopeOf", () => {
  const p = (dos: number[]): Profile =>
    dos.map((doMgL, i) => ({
      km: i,
      reachId: 1,
      doMgL,
      bodMgL: 1,
      coliformsPer100mL: null,
    }));

  it("takes min and max per km, and null coliforms stay null", () => {
    const env = envelopeOf([p([7, 5, 6]), p([7, 4, 8])]);
    expect(env?.do).toEqual([
      { km: 0, min: 7, max: 7 },
      { km: 1, min: 4, max: 5 },
      { km: 2, min: 6, max: 8 },
    ]);
    expect(env?.coliforms).toBeNull();
  });

  it("is null when the km grids differ", () => {
    expect(envelopeOf([p([7, 5]), p([7, 5, 4])])).toBeNull();
  });
});
