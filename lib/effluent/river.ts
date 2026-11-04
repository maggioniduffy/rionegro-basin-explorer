import {
  doSaturation,
  reachFlow,
  reachHydraulics,
  reaeration20,
  temperatureCorrect,
  type HydraulicsParams,
} from "./hydraulics";
import type { EffluentConfig, EffluentNet, Level, NetReach } from "./schema";

/**
 * Downstream simulation of one discharge: complete mixing at the outfall, first-order decay
 * (BOD, fecal coliforms), conservative total P, Streeter-Phelps dissolved oxygen, dilution
 * where tributaries add flow. Pure and deterministic: a screening model, not a calibrated one.
 * Concentrations: BOD, DO, TP in mg/L; coliforms per 100 mL; lengths in km; time in days.
 */

/** Longest distance between two samples along a reach, km. */
const MAX_SAMPLE_STEP_KM = 1;
/** |ka − kd| below this uses the limit form of Streeter-Phelps. */
const KA_KD_EPS = 1e-6;

export interface ModelParams {
  kdPerDay20: number;
  kdTheta: number;
  kbPerDay20: number;
  kbTheta: number;
  kaTheta: number;
  hydraulics: HydraulicsParams;
  tempC: number;
  elevationM: number;
  /** Background BOD₅, mg/L. */
  bgBodMgL: number;
  /** BOD bottle rate at 20 °C, 1/d: converts BOD₅ to ultimate CBOD, L = BOD₅ / (1 − e^(−5k)). */
  bodBottleRatePerDay: number;
  bgDoSatFrac: number;
  /** null = unknown; simulated as 0 and flagged. */
  bgColiformsPer100mL: number | null;
  /** null = unknown (not in the config); simulated as 0 and flagged. */
  bgTpMgL: number | null;
}

export interface ParamLevels {
  /** Level of kd; the coliform decay uses the same level. */
  kd: Level;
  manningN: Level;
  widthCoef: Level;
}

export const CENTRAL_LEVELS: ParamLevels = {
  kd: "central",
  manningN: "central",
  widthCoef: "central",
};

function need(value: number | null, what: string): number {
  if (value === null) throw new Error(`effluent config: ${what} has no value`);
  return value;
}

/** Model coefficients from the config at the given ranges levels. */
export function paramsFromConfig(
  config: EffluentConfig,
  levels: ParamLevels = CENTRAL_LEVELS,
): ModelParams {
  const c = config.coefficients;
  return {
    kdPerDay20: c.kdPerDay[levels.kd],
    kdTheta: c.kdPerDay.theta,
    kbPerDay20: c.coliformDecayPerDay[levels.kd],
    kbTheta: c.coliformDecayPerDay.theta,
    kaTheta: c.kaRule.theta,
    hydraulics: {
      manningN: c.manningN[levels.manningN],
      widthCoef: c.widthCoef[levels.widthCoef],
      widthExponent: c.widthCoef.exponent,
      minSlope: need(c.minSlope.value, "coefficients.minSlope"),
    },
    tempC: need(c.waterTempC.value, "coefficients.waterTempC"),
    elevationM: need(c.elevationM.value, "coefficients.elevationM"),
    bgBodMgL: need(config.background.bodMgL.value, "background.bodMgL"),
    bodBottleRatePerDay: need(
      c.bodBottleRatePerDay.value,
      "coefficients.bodBottleRatePerDay",
    ),
    bgDoSatFrac: need(
      config.background.doSaturationFrac.value,
      "background.doSaturationFrac",
    ),
    bgColiformsPer100mL: config.background.coliformsPer100mL.value,
    bgTpMgL: null,
  };
}

export interface Effluent {
  /** Reach whose upstream end receives the discharge. */
  reachId: number;
  flowM3s: number;
  /** BOD₅, mg/L (the model converts to ultimate CBOD internally). */
  bodMgL: number;
  doMgL: number;
  /** null = not simulated. */
  coliformsPer100mL: number | null;
  /** null = not simulated. */
  tpMgL: number | null;
}

/** Effluent of a configured outfall, with its sourced default values. */
export function effluentFromConfig(
  config: EffluentConfig,
  outfallId: string,
): Effluent {
  const o = config.outfalls.find((x) => x.id === outfallId);
  if (!o) throw new Error(`effluent config: no outfall "${outfallId}"`);
  const e = o.effluent;
  return {
    reachId: o.reach,
    flowM3s: need(o.flowM3s.value, `outfalls.${o.id}.flowM3s`),
    bodMgL: need(e.bodMgL.value, `outfalls.${o.id}.effluent.bodMgL`),
    doMgL: need(e.doMgL?.value ?? null, `outfalls.${o.id}.effluent.doMgL`),
    coliformsPer100mL: e.coliformsPer100mL.value,
    tpMgL: e.tpMgL.value,
  };
}

export interface Thresholds {
  doMinMgL: number;
  /** null = no BOD plume is computed. */
  bodMgL: number | null;
  coliformsPer100mL: number | null;
  tpMgL: number | null;
}

/** The config has no receiving-water TP threshold, so it is null here. */
export function thresholdsFromConfig(config: EffluentConfig): Thresholds {
  const t = config.thresholds;
  return {
    doMinMgL: need(t.doMinMgL.value, "thresholds.doMinMgL"),
    bodMgL: t.bodMgL.value,
    coliformsPer100mL: t.coliformsPer100mL.value,
    tpMgL: null,
  };
}

/** Gauge flows (m³/s at the gauge) of a scenario, by gauge id. */
export type Scenario = Record<string, number>;

/** Every gauge at its GloFAS climatology mean, so each reach carries its HydroRIVERS mean flow. */
export function longTermMeanScenario(net: EffluentNet): Scenario {
  return Object.fromEntries(
    net.gauges.map((g) => [g.id, g.climatologyMeanM3s]),
  );
}

export interface Sample {
  /** Distance from the outfall, km. */
  km: number;
  /** BOD₅ equivalent of the remaining ultimate CBOD, mg/L. */
  bodMgL: number;
  /** Floored at 0. */
  doMgL: number;
  /** Os − DO before flooring (linear in the effluent BOD). */
  deficitMgL: number;
  coliformsPer100mL: number | null;
  tpMgL: number | null;
}

export interface ReachResult {
  id: number;
  kmStart: number;
  kmEnd: number;
  qM3s: number;
  velocityMs: number;
  depthM: number;
  kaPerDay: number;
  kdPerDay: number;
  travelDays: number;
  /** Values at the downstream end of the reach. */
  end: {
    bodMgL: number;
    doMgL: number;
    coliformsPer100mL: number | null;
    tpMgL: number | null;
  };
  doMinMgL: number;
  doMinKm: number;
  /** Includes the upstream end (after mixing or dilution) and the downstream end. */
  samples: Sample[];
}

export interface Peak {
  value: number;
  km: number;
  reachId: number;
}

export interface Plume {
  /** Total length where the threshold is exceeded, km. */
  km: number;
  /** Farthest distance from the outfall at which it is exceeded; null if never. */
  lastKm: number | null;
}

export interface SimulationResult {
  path: ReachResult[];
  summary: {
    totalKm: number;
    entersLake: boolean;
    minDo: { mgL: number; km: number; reachId: number };
    peak: { bod: Peak; coliforms: Peak | null; tp: Peak | null };
    plume: {
      do: Plume;
      bod: Plume | null;
      coliforms: Plume | null;
      tp: Plume | null;
    };
  };
  flags: {
    assumedZeroBackground: { coliforms: boolean; tp: boolean };
    simulated: { coliforms: boolean; tp: boolean };
  };
  /** DO saturation at the model temperature and elevation, mg/L. */
  doSaturationMgL: number;
}

export interface SimulationInput {
  net: EffluentNet;
  params: ModelParams;
  effluent: Effluent;
  scenario: Scenario;
  thresholds: Thresholds;
}

interface State {
  /** Ultimate CBOD (internal), mg/L. */
  bod: number;
  deficit: number;
  coli: number | null;
  tp: number | null;
}

/** Streeter-Phelps deficit after tau days from (L0, D0). */
export function streeterPhelpsDeficit(
  l0: number,
  d0: number,
  kd: number,
  ka: number,
  tau: number,
): number {
  if (Math.abs(ka - kd) < KA_KD_EPS)
    return (kd * l0 * tau + d0) * Math.exp(-kd * tau);
  return (
    ((kd * l0) / (ka - kd)) * (Math.exp(-kd * tau) - Math.exp(-ka * tau)) +
    d0 * Math.exp(-ka * tau)
  );
}

function mix(a: number, qa: number, b: number, qb: number): number {
  return (a * qa + b * qb) / (qa + qb);
}

function walkPath(input: SimulationInput): {
  reaches: NetReach[];
  entersLake: boolean;
} {
  const { net, effluent } = input;
  const byId = new Map(net.reaches.map((r) => [r.id, r]));
  const lake = new Set(net.lake.inReaches);
  if (lake.has(effluent.reachId))
    throw new Error(
      `outfall reach ${effluent.reachId} is inside the reservoir`,
    );
  const reaches: NetReach[] = [];
  const seen = new Set<number>();
  let id = effluent.reachId;
  for (;;) {
    const r = byId.get(id);
    if (!r) throw new Error(`reach ${id} is not in the net`);
    if (seen.has(id)) throw new Error(`cycle at reach ${id}`);
    seen.add(id);
    reaches.push(r);
    if (r.nextDown === 0) return { reaches, entersLake: false };
    if (lake.has(r.nextDown)) return { reaches, entersLake: true };
    id = r.nextDown;
  }
}

/** Length of the stretch of a polyline where margin(value) > 0, with linear crossings. */
function exceeded(pts: { km: number; margin: number }[]): {
  km: number;
  lastKm: number | null;
} {
  let km = 0;
  let lastKm: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const b = pts[i]!;
    if (b.margin > 0) lastKm = Math.max(lastKm ?? -Infinity, b.km);
    const a = pts[i - 1];
    if (!a) continue;
    const len = b.km - a.km;
    if (a.margin > 0 && b.margin > 0) km += len;
    else if (a.margin > 0 || b.margin > 0) {
      const pos = Math.max(a.margin, b.margin);
      const neg = Math.min(a.margin, b.margin);
      const frac = pos / (pos - neg);
      km += len * frac;
      if (a.margin > 0)
        lastKm = Math.max(lastKm ?? -Infinity, a.km + len * frac);
    }
  }
  return { km, lastKm };
}

/** Plume of one parameter; "above" for concentrations, "below" for DO. */
function plumeOf(
  path: ReachResult[],
  pick: (s: Sample) => number | null,
  threshold: number,
  direction: "above" | "below",
): Plume {
  let km = 0;
  let lastKm: number | null = null;
  for (const reach of path) {
    const pts = reach.samples.map((s) => {
      const v = pick(s) ?? 0;
      return {
        km: s.km,
        margin: direction === "above" ? v - threshold : threshold - v,
      };
    });
    const e = exceeded(pts);
    km += e.km;
    if (e.lastKm !== null) lastKm = Math.max(lastKm ?? -Infinity, e.lastKm);
  }
  return { km, lastKm };
}

function peakOf(
  path: ReachResult[],
  pick: (s: Sample) => number | null,
): Peak | null {
  let best: Peak | null = null;
  for (const reach of path)
    for (const s of reach.samples) {
      const v = pick(s);
      if (v !== null && (best === null || v > best.value))
        best = { value: v, km: s.km, reachId: reach.id };
    }
  return best;
}

/** Reject inputs the UI should have caught: negative effluent values, non-positive gauge flows. */
function validateInput(input: SimulationInput): void {
  const { net, effluent: e, scenario, params: p } = input;
  if (!(e.flowM3s >= 0)) throw new RangeError("effluent flow must be >= 0");
  const concentrations: [string, number | null][] = [
    ["BOD", e.bodMgL],
    ["DO", e.doMgL],
    ["coliforms", e.coliformsPer100mL],
    ["TP", e.tpMgL],
  ];
  for (const [name, v] of concentrations)
    if (v !== null && !(v >= 0))
      throw new RangeError(`effluent ${name} must be >= 0`);
  if (!(p.bodBottleRatePerDay > 0))
    throw new RangeError("BOD bottle rate must be > 0");
  for (const g of net.gauges) {
    const q = scenario[g.id];
    if (q !== undefined && !(q > 0))
      throw new RangeError(`gauge "${g.id}" flow must be > 0 (got ${q} m³/s)`);
  }
}

/**
 * Simulate one discharge along the downstream path of its reach.
 *
 * BOD is BOD₅ on input and output. The DO deficit is not floored in the state carried
 * downstream: past DO 0 it keeps growing as if the oxygen demand were still being met,
 * which is conservative (the reported DO is floored at 0 and the sag recovers later than a
 * real anoxic river would).
 */
export function simulate(input: SimulationInput): SimulationResult {
  const { net, params: p, effluent: e, scenario, thresholds } = input;
  validateInput(input);
  // BOD₅ in, BOD₅ out; the decay and Streeter-Phelps work on ultimate CBOD.
  const ultimatePerBod5 = 1 / (1 - Math.exp(-5 * p.bodBottleRatePerDay));
  const bgBodUlt = p.bgBodMgL * ultimatePerBod5;
  const os = doSaturation(p.tempC, p.elevationM);
  const bgDeficit = os - p.bgDoSatFrac * os;
  const bgColi = p.bgColiformsPer100mL ?? 0;
  const bgTp = p.bgTpMgL ?? 0;
  const simColi = e.coliformsPer100mL !== null;
  const simTp = e.tpMgL !== null;
  const gaugeMean = new Map(
    net.gauges.map((g) => [g.id, g.climatologyMeanM3s]),
  );

  const kd = temperatureCorrect(p.kdPerDay20, p.kdTheta, p.tempC);
  const kb = temperatureCorrect(p.kbPerDay20, p.kbTheta, p.tempC);

  const { reaches, entersLake } = walkPath(input);
  const flowOf = (r: NetReach): number => {
    const g = scenario[r.gaugeId];
    const mean = gaugeMean.get(r.gaugeId);
    if (g === undefined || mean === undefined)
      throw new Error(`scenario has no flow for gauge "${r.gaugeId}"`);
    return reachFlow(r, g, mean);
  };

  const path: ReachResult[] = [];
  let state: State | null = null;
  let prevQ = 0;
  let km = 0;
  for (const reach of reaches) {
    const qr = flowOf(reach);
    const q = qr + e.flowM3s;
    if (state === null) {
      const doBg = p.bgDoSatFrac * os;
      state = {
        bod: mix(e.bodMgL * ultimatePerBod5, e.flowM3s, bgBodUlt, qr),
        deficit: os - mix(e.doMgL, e.flowM3s, doBg, qr),
        coli: simColi ? mix(e.coliformsPer100mL!, e.flowM3s, bgColi, qr) : null,
        tp: simTp ? mix(e.tpMgL!, e.flowM3s, bgTp, qr) : null,
      };
    } else if (q > prevQ) {
      const add = q - prevQ;
      state = {
        bod: mix(state.bod, prevQ, bgBodUlt, add),
        deficit: mix(state.deficit, prevQ, bgDeficit, add),
        coli: state.coli === null ? null : mix(state.coli, prevQ, bgColi, add),
        tp: state.tp === null ? null : mix(state.tp, prevQ, bgTp, add),
      };
    }
    const h = reachHydraulics(
      q,
      reach.lengthKm,
      reach.gradientMPerKm,
      p.hydraulics,
    );
    const ka = temperatureCorrect(
      reaeration20(h.depthM, h.velocityMs),
      p.kaTheta,
      p.tempC,
    );
    const start: State = state;
    const steps = Math.max(1, Math.ceil(reach.lengthKm / MAX_SAMPLE_STEP_KM));
    const samples: Sample[] = [];
    // Ultimate CBOD at the downstream end, carried to the next reach.
    const endBodUlt = start.bod * Math.exp(-kd * h.travelDays);
    for (let i = 0; i <= steps; i++) {
      const tau = (h.travelDays * i) / steps;
      const deficit = streeterPhelpsDeficit(
        start.bod,
        start.deficit,
        kd,
        ka,
        tau,
      );
      samples.push({
        km: km + (reach.lengthKm * i) / steps,
        bodMgL: (start.bod * Math.exp(-kd * tau)) / ultimatePerBod5,
        doMgL: Math.max(0, os - deficit),
        deficitMgL: deficit,
        coliformsPer100mL:
          start.coli === null ? null : start.coli * Math.exp(-kb * tau),
        tpMgL: start.tp,
      });
    }
    const last = samples[samples.length - 1]!;
    const minSample = samples.reduce((m, s) => (s.doMgL < m.doMgL ? s : m));
    path.push({
      id: reach.id,
      kmStart: km,
      kmEnd: last.km,
      qM3s: q,
      velocityMs: h.velocityMs,
      depthM: h.depthM,
      kaPerDay: ka,
      kdPerDay: kd,
      travelDays: h.travelDays,
      end: {
        bodMgL: last.bodMgL,
        doMgL: last.doMgL,
        coliformsPer100mL: last.coliformsPer100mL,
        tpMgL: last.tpMgL,
      },
      doMinMgL: minSample.doMgL,
      doMinKm: minSample.km,
      samples,
    });
    state = {
      bod: endBodUlt,
      deficit: last.deficitMgL,
      coli: last.coliformsPer100mL,
      tp: last.tpMgL,
    };
    prevQ = q;
    km = last.km;
  }

  const worst = path.reduce((m, r) => (r.doMinMgL < m.doMinMgL ? r : m));
  const bodPeak = peakOf(path, (s) => s.bodMgL)!;
  const t = thresholds;
  return {
    path,
    summary: {
      totalKm: km,
      entersLake,
      minDo: { mgL: worst.doMinMgL, km: worst.doMinKm, reachId: worst.id },
      peak: {
        bod: bodPeak,
        coliforms: simColi ? peakOf(path, (s) => s.coliformsPer100mL) : null,
        tp: simTp ? peakOf(path, (s) => s.tpMgL) : null,
      },
      plume: {
        do: plumeOf(path, (s) => s.doMgL, t.doMinMgL, "below"),
        bod:
          t.bodMgL === null
            ? null
            : plumeOf(path, (s) => s.bodMgL, t.bodMgL, "above"),
        coliforms:
          simColi && t.coliformsPer100mL !== null
            ? plumeOf(
                path,
                (s) => s.coliformsPer100mL,
                t.coliformsPer100mL,
                "above",
              )
            : null,
        tp:
          simTp && t.tpMgL !== null
            ? plumeOf(path, (s) => s.tpMgL, t.tpMgL, "above")
            : null,
      },
    },
    flags: {
      assumedZeroBackground: {
        coliforms: simColi && p.bgColiformsPer100mL === null,
        tp: simTp && p.bgTpMgL === null,
      },
      simulated: { coliforms: simColi, tp: simTp },
    },
    doSaturationMgL: os,
  };
}

export interface Admissible {
  /**
   * Largest effluent concentration that keeps the threshold everywhere. null when the limit
   * never binds (baseViolates false) or when no concentration can meet it (baseViolates true).
   */
  admissible: number | null;
  /** Units of `admissible`: BOD₅ mg/L for the BOD result, per 100 mL for coliforms. */
  units: "BOD5" | "per100mL";
  /**
   * The threshold is violated even with a zero effluent concentration (same effluent flow and
   * DO), so no effluent concentration can fix it.
   */
  baseViolates: boolean;
  /** When baseViolates: what drives it; null otherwise. */
  cause: "effluentDo" | "background" | null;
  /** Where the limit binds; with baseViolates, the first violating point (null if never). */
  binding: { km: number; reachId: number } | null;
  /** max(0, 1 − admissible / given) × 100; null when baseViolates (no removal is enough). */
  requiredRemovalPct: number | null;
}

interface Point {
  km: number;
  reachId: number;
  base: number;
  ref: number;
}

/** Linear-response limit: value(Ce) = base + Ce/refCe·(ref − base) ≤ limit at every point. */
function admissibleFrom(
  points: Point[],
  limit: number,
  refCe: number,
  givenCe: number,
  units: Admissible["units"],
): Admissible {
  let adm = Infinity;
  let baseViolates = false;
  let binding: Admissible["binding"] = null;
  let firstViolating: Admissible["binding"] = null;
  for (const pt of points) {
    if (pt.base > limit && !baseViolates) {
      baseViolates = true;
      firstViolating = { km: pt.km, reachId: pt.reachId };
    }
    const slope = (pt.ref - pt.base) / refCe;
    if (slope <= 0) continue;
    const x = (limit - pt.base) / slope;
    if (x < adm) {
      adm = x;
      binding = { km: pt.km, reachId: pt.reachId };
    }
  }
  const admissible = Number.isFinite(adm) ? Math.max(0, adm) : null;
  if (baseViolates)
    return {
      admissible: null,
      units,
      baseViolates,
      cause: "background",
      binding: firstViolating,
      requiredRemovalPct: null,
    };
  return {
    admissible,
    units,
    baseViolates,
    cause: null,
    binding: admissible === null ? null : binding,
    requiredRemovalPct:
      admissible === null || givenCe <= 0
        ? 0
        : Math.max(0, 1 - admissible / givenCe) * 100,
  };
}

function pointsOf(
  base: SimulationResult,
  ref: SimulationResult,
  pick: (s: Sample) => number | null,
): Point[] {
  const pts: Point[] = [];
  base.path.forEach((reach, i) => {
    reach.samples.forEach((s, j) => {
      const r = ref.path[i]!.samples[j]!;
      pts.push({
        km: s.km,
        reachId: reach.id,
        base: pick(s) ?? 0,
        ref: pick(r) ?? 0,
      });
    });
  });
  return pts;
}

export interface AdmissibleLoad {
  /** Effluent BOD₅ that keeps DO ≥ the threshold (see Admissible for the null cases). */
  bod: Admissible;
  /** Effluent coliforms that keep the receiving water ≤ threshold; null if not simulated or no threshold. */
  coliforms: Admissible | null;
  /** The simulation with the given effluent. */
  given: SimulationResult;
}

/**
 * Admissible effluent concentrations at a flow. The response is linear in the effluent
 * concentration, so two runs (effluent 0 and the given/reference one) give every sample point.
 */
export function admissibleLoad(input: SimulationInput): AdmissibleLoad {
  const { effluent: e, thresholds: t } = input;
  const given = simulate(input);
  const run = (patch: Partial<Effluent>): SimulationResult =>
    simulate({ ...input, effluent: { ...e, ...patch } });

  const bodRefCe = e.bodMgL > 0 ? e.bodMgL : 1;
  const baseBod = run({ bodMgL: 0 });
  const refBod = e.bodMgL > 0 ? given : run({ bodMgL: bodRefCe });
  const bod = admissibleFrom(
    pointsOf(baseBod, refBod, (s) => s.deficitMgL),
    given.doSaturationMgL - t.doMinMgL,
    bodRefCe,
    e.bodMgL,
    "BOD5",
  );
  if (bod.baseViolates) {
    // Does the violation disappear when the effluent carries the background DO?
    const bgDo = given.doSaturationMgL * input.params.bgDoSatFrac;
    const withBgDo = run({ bodMgL: 0, doMgL: bgDo });
    bod.cause =
      withBgDo.summary.minDo.mgL >= t.doMinMgL ? "effluentDo" : "background";
  }

  let coliforms: Admissible | null = null;
  if (e.coliformsPer100mL !== null && t.coliformsPer100mL !== null) {
    const refCe = e.coliformsPer100mL > 0 ? e.coliformsPer100mL : 1;
    const base = run({ coliformsPer100mL: 0 });
    const ref =
      e.coliformsPer100mL > 0 ? given : run({ coliformsPer100mL: refCe });
    coliforms = admissibleFrom(
      pointsOf(base, ref, (s) => s.coliformsPer100mL),
      t.coliformsPer100mL,
      refCe,
      e.coliformsPer100mL,
      "per100mL",
    );
  }
  return { bod, coliforms, given };
}

export interface Band {
  min: number | null;
  central: number | null;
  /** null sorts as +∞: an admissible concentration that never binds, or a removal that no effluent concentration can achieve (baseViolates). */
  max: number | null;
}

export interface UncertaintyBand {
  runs: number;
  minDoMgL: Band;
  plumeKm: {
    do: Band;
    bod: Band | null;
    coliforms: Band | null;
    tp: Band | null;
  };
  admissibleBodMgL: Band;
  requiredRemovalBodPct: Band;
  admissibleColiformsPer100mL: Band | null;
  requiredRemovalColiformsPct: Band | null;
}

export interface UncertaintyInput extends Omit<SimulationInput, "params"> {
  /** Parameters for a kd (and coliform decay) level and a Manning n level. */
  paramsFor: (levels: ParamLevels) => ModelParams;
}

const LEVEL_LIST: Level[] = ["low", "central", "high"];

/** null counts as +∞ (an unbounded admissible load). */
function bandOf(values: (number | null)[], central: number | null): Band {
  const key = (v: number | null) => (v === null ? Infinity : v);
  const sorted = [...values].sort((a, b) => key(a) - key(b));
  return { min: sorted[0]!, central, max: sorted[sorted.length - 1]! };
}

/** Range of the results over kd ∈ {low, central, high} × Manning n ∈ {low, central, high}. */
export function uncertaintyBand(input: UncertaintyInput): UncertaintyBand {
  const { paramsFor, ...rest } = input;
  const runs: { central: boolean; load: AdmissibleLoad }[] = [];
  for (const kd of LEVEL_LIST)
    for (const manningN of LEVEL_LIST) {
      const params = paramsFor({ ...CENTRAL_LEVELS, kd, manningN });
      runs.push({
        central: kd === "central" && manningN === "central",
        load: admissibleLoad({ ...rest, params }),
      });
    }
  const centralRun = runs.find((r) => r.central)!.load;

  const band = (pick: (l: AdmissibleLoad) => number | null): Band =>
    bandOf(
      runs.map((r) => pick(r.load)),
      pick(centralRun),
    );
  const optBand = (
    pick: (l: AdmissibleLoad) => number | null | undefined,
  ): Band | null =>
    pick(centralRun) === undefined || pick(centralRun) === null
      ? null
      : band((l) => pick(l) ?? null);

  return {
    runs: runs.length,
    minDoMgL: band((l) => l.given.summary.minDo.mgL),
    plumeKm: {
      do: band((l) => l.given.summary.plume.do.km),
      bod: optBand((l) => l.given.summary.plume.bod?.km),
      coliforms: optBand((l) => l.given.summary.plume.coliforms?.km),
      tp: optBand((l) => l.given.summary.plume.tp?.km),
    },
    admissibleBodMgL: band((l) => l.bod.admissible),
    requiredRemovalBodPct: band((l) => l.bod.requiredRemovalPct),
    admissibleColiformsPer100mL:
      centralRun.coliforms === null
        ? null
        : band((l) => l.coliforms?.admissible ?? null),
    requiredRemovalColiformsPct:
      centralRun.coliforms === null
        ? null
        : band((l) => l.coliforms?.requiredRemovalPct ?? null),
  };
}
