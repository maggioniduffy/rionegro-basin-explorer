import type { EffluentConfig, EffluentNet, Level } from "./schema";
import {
  CENTRAL_LEVELS,
  paramsFromConfig,
  simulate,
  type ModelParams,
  type ParamLevels,
  type SimulationInput,
  type SimulationResult,
} from "./river";

/** One point of the river profile, a model sample with the reach it lies in. */
export interface ProfilePoint {
  /** Distance from the outfall, km. */
  km: number;
  reachId: number;
  doMgL: number;
  bodMgL: number;
  /** null = coliforms not simulated. */
  coliformsPer100mL: number | null;
}

export type Profile = ProfilePoint[];

const SAME_KM = 1e-9;

/**
 * The run's samples along the path as one profile. Adjacent reaches repeat the boundary km (the
 * upstream reach's last sample and the downstream reach's first); the downstream reach's first
 * sample is kept because it is the value after mixing or dilution at the confluence, the one
 * the water carries on with.
 */
export function profileOf(result: SimulationResult): Profile {
  const out: Profile = [];
  result.path.forEach((reach, i) => {
    const nextStart = result.path[i + 1]?.samples[0]?.km;
    reach.samples.forEach((s, j) => {
      const last = j === reach.samples.length - 1;
      if (
        last &&
        nextStart !== undefined &&
        Math.abs(nextStart - s.km) < SAME_KM
      )
        return;
      out.push({
        km: s.km,
        reachId: reach.id,
        doMgL: s.doMgL,
        bodMgL: s.bodMgL,
        coliformsPer100mL: s.coliformsPer100mL,
      });
    });
  });
  return out;
}

export interface EnvelopePoint {
  km: number;
  min: number;
  max: number;
}

export interface ProfileEnvelope {
  do: EnvelopePoint[];
  /** null when any profile has no coliforms. */
  coliforms: EnvelopePoint[] | null;
}

/** Min and max per km across profiles of the same path; null if empty or the km grids differ. */
export function envelopeOf(profiles: Profile[]): ProfileEnvelope | null {
  const first = profiles[0];
  if (!first) return null;
  for (const p of profiles)
    if (
      p.length !== first.length ||
      p.some((pt, i) => Math.abs(pt.km - first[i]!.km) > SAME_KM)
    )
      return null;
  const band = (pick: (p: ProfilePoint) => number | null) => {
    const out: EnvelopePoint[] = [];
    for (let i = 0; i < first.length; i++) {
      const values = profiles.map((p) => pick(p[i]!));
      if (values.some((v) => v === null)) return null;
      const v = values as number[];
      out.push({ km: first[i]!.km, min: Math.min(...v), max: Math.max(...v) });
    }
    return out;
  };
  return {
    do: band((p) => p.doMgL)!,
    coliforms: band((p) => p.coliformsPer100mL),
  };
}

const LEVELS: Level[] = ["low", "central", "high"];

/**
 * The run's parameters with only the kd (and coliform decay) and Manning n levels swapped for the
 * config's: the width level and the temperature override stay the run's. `uncertaintyBand` and
 * `profileEnvelope` both vary the coefficients this way, so their bands agree.
 */
export function paramsWithLevels(
  config: EffluentConfig,
  base: ModelParams,
  levels: Pick<ParamLevels, "kd" | "manningN">,
): ModelParams {
  const g = paramsFromConfig(config, { ...CENTRAL_LEVELS, ...levels });
  return {
    ...base,
    kdPerDay20: g.kdPerDay20,
    kbPerDay20: g.kbPerDay20,
    hydraulics: { ...base.hydraulics, manningN: g.hydraulics.manningN },
  };
}

/**
 * The profiles of the kd (and coliform decay) × Manning n 3×3 grid, as `uncertaintyBand` runs it:
 * the run's own parameters (width level, temperature override) with only those coefficients
 * swapped, then their envelope. Null if the grids differ.
 */
export function profileEnvelope(
  net: EffluentNet,
  config: EffluentConfig,
  input: Omit<SimulationInput, "net">,
): ProfileEnvelope | null {
  const profiles: Profile[] = [];
  for (const kd of LEVELS)
    for (const manningN of LEVELS) {
      const params = paramsWithLevels(config, input.params, { kd, manningN });
      profiles.push(profileOf(simulate({ ...input, net, params })));
    }
  return envelopeOf(profiles);
}
