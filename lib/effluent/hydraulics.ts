import type { NetReach } from "./schema";

/**
 * Hydraulics and textbook formulas of the effluent screening model. SI units, time in days
 * where a rate is per day. Inputs come from the config (see paramsFromConfig in river.ts); the only literals
 * here are the published formula constants.
 */

const SECONDS_PER_DAY = 86_400;

/** Flow at a reach for a scenario: Q = dischargeM3s × Q_gauge / climatology mean of the gauge. */
export function reachFlow(
  reach: Pick<NetReach, "dischargeM3s">,
  gaugeFlowM3s: number,
  gaugeClimatologyMeanM3s: number,
): number {
  return (reach.dischargeM3s * gaugeFlowM3s) / gaugeClimatologyMeanM3s;
}

export interface HydraulicsParams {
  manningN: number;
  widthCoef: number;
  widthExponent: number;
  minSlope: number;
}

export interface ReachHydraulics {
  slope: number;
  widthM: number;
  depthM: number;
  velocityMs: number;
  /** Travel time through the whole reach, days. */
  travelDays: number;
}

/** Wide rectangular channel: W = a·Q^b, H = (n·Q/(W·√S))^(3/5), v = Q/(W·H). */
export function reachHydraulics(
  qM3s: number,
  lengthKm: number,
  gradientMPerKm: number,
  p: HydraulicsParams,
): ReachHydraulics {
  if (!(qM3s > 0))
    throw new RangeError(`reach flow must be > 0 (got ${qM3s} m³/s)`);
  const slope = Math.max(gradientMPerKm / 1000, p.minSlope);
  const widthM = p.widthCoef * qM3s ** p.widthExponent;
  const depthM = ((p.manningN * qM3s) / (widthM * Math.sqrt(slope))) ** (3 / 5);
  const velocityMs = qM3s / (widthM * depthM);
  const travelDays = (lengthKm * 1000) / velocityMs / SECONDS_PER_DAY;
  return { slope, widthM, depthM, velocityMs, travelDays };
}

/** Reaeration rate at 20 °C (1/d) by the Covar (1976) rule; H in m, U in m/s. */
export function reaeration20(depthM: number, velocityMs: number): number {
  if (depthM < 0.61) return (5.32 * velocityMs ** 0.67) / depthM ** 1.85; // Owens-Gibbs
  if (depthM > 3.45 * velocityMs ** 2.5)
    return (3.93 * velocityMs ** 0.5) / depthM ** 1.5; // O'Connor-Dobbins
  return (5.026 * velocityMs) / depthM ** 1.67; // Churchill
}

/** k_T = k_20 · θ^(T−20). */
export function temperatureCorrect(
  k20: number,
  theta: number,
  tempC: number,
): number {
  return k20 * theta ** (tempC - 20);
}

/** DO saturation (mg/L) at water temperature and elevation: APHA / Benson-Krause, freshwater. */
export function doSaturation(tempC: number, elevationM: number): number {
  const ta = tempC + 273.15;
  const lnOs =
    -139.34411 +
    1.575701e5 / ta -
    6.642308e7 / ta ** 2 +
    1.2438e10 / ta ** 3 -
    8.621949e11 / ta ** 4;
  return Math.exp(lnOs) * (1 - 0.0001148 * elevationM);
}
