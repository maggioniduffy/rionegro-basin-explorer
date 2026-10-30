import { describe, expect, it } from "vitest";
import cbaConfig from "@/regions/cba/effluent.config.json";
import cbaNet from "@/regions/cba/effluent-net.json";
import { doSaturation } from "@/lib/effluent/hydraulics";
import { oecdLake } from "@/lib/effluent/reservoir";
import {
  admissibleLoad,
  effluentFromConfig,
  longTermMeanScenario,
  paramsFromConfig,
  simulate,
  thresholdsFromConfig,
  uncertaintyBand,
  type Effluent,
  type SimulationInput,
} from "@/lib/effluent/river";
import {
  parseEffluentConfig,
  parseEffluentNet,
  type EffluentNet,
} from "@/lib/effluent/schema";

const config = parseEffluentConfig(cbaConfig);
const realNet = parseEffluentNet(cbaNet);

/** A hand-made net: one gauge with climatology mean 10 m³/s and no lake; gradient 0.2 m/km (slow, deep enough to sag). */
function fixtureNet(
  reaches: { id: number; nextDown: number; lengthKm: number; q: number }[],
): EffluentNet {
  return {
    region: "fixture",
    gauges: [{ id: "g", name: "g", climatologyMeanM3s: 10 }],
    lake: { ...realNet.lake, inReaches: [] },
    reaches: reaches.map((r) => ({
      id: r.id,
      nextDown: r.nextDown,
      lengthKm: r.lengthKm,
      dischargeM3s: r.q,
      gradientMPerKm: 0.2,
      uplandKm2: 1,
      gaugeId: "g",
    })),
    outfalls: [],
  };
}

const noEffluent: Effluent = {
  reachId: 1,
  flowM3s: 1,
  bodMgL: 0,
  doMgL: 0,
  coliformsPer100mL: null,
  tpMgL: null,
};

function input(
  net: EffluentNet,
  effluent: Effluent,
  scenario = { g: 10 },
): SimulationInput {
  return {
    net,
    params: paramsFromConfig(config),
    effluent,
    scenario,
    thresholds: thresholdsFromConfig(config),
  };
}

describe("effluent model", () => {
  it("conserves mass at the outfall and at a tributary inflow (TP)", () => {
    // Reach flows 2 -> 5 -> 5.5 m³/s (long-term mean); effluent 1 m³/s at 3 mg/L; background TP 0.1 mg/L.
    const net = fixtureNet([
      { id: 1, nextDown: 2, lengthKm: 2, q: 2 },
      { id: 2, nextDown: 3, lengthKm: 2, q: 5 },
      { id: 3, nextDown: 0, lengthKm: 2, q: 5.5 },
    ]);
    const base = input(net, { ...noEffluent, tpMgL: 3 });
    const params = { ...base.params, bgTpMgL: 0.1 };
    const r = simulate({ ...base, params });
    // mixed: (3·1 + 0.1·2) / 3; at B: (mixed·3 + 0.1·3) / 6; at C: (·6 + 0.1·0.5) / 6.5
    const mixed = (3 * 1 + 0.1 * 2) / 3;
    const atB = (mixed * 3 + 0.1 * 3) / 6;
    const atC = (atB * 6 + 0.1 * 0.5) / 6.5;
    expect(r.path[0]!.samples[0]!.tpMgL).toBeCloseTo(mixed, 9);
    expect(r.path[0]!.end.tpMgL).toBeCloseTo(mixed, 9);
    expect(r.path[1]!.samples[0]!.tpMgL).toBeCloseTo(atB, 9);
    expect(r.path[2]!.end.tpMgL).toBeCloseTo(atC, 9);
    expect(atC).toBeCloseTo(0.546154, 6);
    expect(r.flags.assumedZeroBackground.tp).toBe(false);
    // doubling the gauge flow doubles every reach flow: (3·1 + 0.1·4) / 5
    const wet = simulate({ ...base, params, scenario: { g: 20 } });
    expect(wet.path[0]!.samples[0]!.tpMgL).toBeCloseTo((3 + 0.4) / 5, 9);
  });

  it("matches the analytic Streeter-Phelps critical deficit", () => {
    const net = fixtureNet([{ id: 1, nextDown: 0, lengthKm: 300, q: 5 }]);
    const eff: Effluent = {
      ...noEffluent,
      flowM3s: 0.5,
      bodMgL: 300,
      doMgL: 8,
    };
    const inp = input(net, eff);
    const r = simulate(inp);
    const reach = r.path[0]!;
    const { kdPerDay: kd, kaPerDay: ka } = reach;
    expect(inp.params.tempC).toBe(20); // kd, ka are the 20 °C values
    const os = doSaturation(inp.params.tempC, inp.params.elevationM);
    // BOD₅ -> ultimate CBOD with the bottle rate, as the model does internally
    const toUltimate = 1 / (1 - Math.exp(-5 * inp.params.bodBottleRatePerDay));
    const l0 = ((300 * 0.5 + inp.params.bgBodMgL * 5) / 5.5) * toUltimate;
    const d0 = os - (8 * 0.5 + inp.params.bgDoSatFrac * os * 5) / 5.5;
    const tc =
      Math.log((ka / kd) * (1 - (d0 * (ka - kd)) / (kd * l0))) / (ka - kd);
    expect(tc).toBeGreaterThan(0);
    expect(tc).toBeLessThan(reach.travelDays);
    const dc = (kd / ka) * l0 * Math.exp(-kd * tc);
    expect(Math.abs(r.summary.minDo.mgL - (os - dc))).toBeLessThan(0.05);
  });

  it("returns an admissible BOD whose re-simulation sits at the DO threshold", () => {
    const net = fixtureNet([{ id: 1, nextDown: 0, lengthKm: 300, q: 1 }]);
    const eff: Effluent = {
      ...noEffluent,
      flowM3s: 0.5,
      bodMgL: 400,
      doMgL: 2,
    };
    const inp = input(net, eff);
    const thr = inp.thresholds.doMinMgL;
    const adm = admissibleLoad(inp);
    expect(adm.given.summary.minDo.mgL).toBeLessThan(thr); // the given effluent violates
    expect(adm.bod.baseViolates).toBe(false);
    expect(adm.bod.admissible).not.toBeNull();
    expect(adm.bod.admissible!).toBeLessThan(400);
    expect(adm.bod.requiredRemovalPct).toBeCloseTo(
      (1 - adm.bod.admissible! / 400) * 100,
      9,
    );
    const again = simulate({
      ...inp,
      effluent: { ...eff, bodMgL: adm.bod.admissible! },
    });
    expect(Math.abs(again.summary.minDo.mgL - thr)).toBeLessThan(0.05);
  });

  it("evaluates the OECD model on a hand-computed sample", () => {
    // load 10 t/yr, inflow 100 hm³/yr, volume 100 hm³: τ = 1 yr,
    // P_in = 10e9 / 1e8 = 100 µg/L, P_lake = 1.55·(100/2)^0.82 = 38.33 µg/L -> eutrophic (35–100).
    const r = oecdLake({ tpLoadTPerYr: 10, inflowM3PerYr: 1e8, volumeM3: 1e8 });
    expect(r.residenceYr).toBeCloseTo(1, 12);
    expect(r.pInUgL).toBeCloseTo(100, 9);
    expect(r.pLakeUgL).toBeCloseTo(38.33, 2);
    expect(r.trophic).toBe("eutrophic");
  });

  it("parses the cba config and net and runs Bajo Grande to the mouth", () => {
    const eff = effluentFromConfig(config, "bajo-grande");
    const inp: SimulationInput = {
      net: realNet,
      params: paramsFromConfig(config),
      effluent: eff,
      scenario: longTermMeanScenario(realNet),
      thresholds: thresholdsFromConfig(config),
    };
    const r = simulate(inp);
    expect(r.path.length).toBeGreaterThan(0);
    expect(r.path[0]!.id).toBe(eff.reachId);
    expect(r.path[r.path.length - 1]!.id).toBe(config.mouthReach);
    expect(r.summary.entersLake).toBe(false);
    const band = uncertaintyBand({
      ...inp,
      paramsFor: (levels) => paramsFromConfig(config, levels),
    });
    expect(band.runs).toBe(9);
  });
});
