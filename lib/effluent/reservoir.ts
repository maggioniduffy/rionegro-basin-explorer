import type { LakeConfig } from "./schema";

/**
 * OECD (1982) fixed-boundary reservoir model: one completely mixed node at annual steady
 * state. P_lake = 1.55·[P_in/(1+√τ)]^0.82 (µg/L); P_in = TP load / inflow volume.
 */

const SECONDS_PER_YEAR = 365.25 * 86_400;
/** t → µg and m³ → L: (t/yr · 1e12 µg/t) / (m³/yr · 1e3 L/m³). */
const T_PER_M3_TO_UG_PER_L = 1e9;

export const TROPHIC_CLASSES = [
  "ultraOligotrophic",
  "oligotrophic",
  "mesotrophic",
  "eutrophic",
  "hypereutrophic",
] as const;
export type TrophicClass = (typeof TROPHIC_CLASSES)[number];

/** OECD fixed boundaries on annual mean in-lake TP (µg/L): <4, 4–10, 10–35, 35–100, >100. */
export function trophicClass(pLakeUgL: number): TrophicClass {
  if (pLakeUgL < 4) return "ultraOligotrophic";
  if (pLakeUgL < 10) return "oligotrophic";
  if (pLakeUgL < 35) return "mesotrophic";
  if (pLakeUgL <= 100) return "eutrophic";
  return "hypereutrophic";
}

export interface OecdInput {
  tpLoadTPerYr: number;
  inflowM3PerYr: number;
  /** Required unless residenceYr is given. */
  volumeM3?: number;
  /** Residence time override, years; default volume / inflow. */
  residenceYr?: number;
}

export interface OecdResult {
  residenceYr: number;
  /** Inflow-weighted TP concentration, µg/L. */
  pInUgL: number;
  pLakeUgL: number;
  trophic: TrophicClass;
}

export function oecdLake(input: OecdInput): OecdResult {
  const { tpLoadTPerYr, inflowM3PerYr, volumeM3 } = input;
  if (!(inflowM3PerYr > 0)) throw new RangeError("inflow must be > 0");
  if (
    input.residenceYr === undefined &&
    !(volumeM3 !== undefined && volumeM3 > 0)
  )
    throw new RangeError("volume must be > 0 when no residence time is given");
  const residenceYr = input.residenceYr ?? volumeM3! / inflowM3PerYr;
  if (!(residenceYr >= 0)) throw new RangeError("residence time must be >= 0");
  const pInUgL = (tpLoadTPerYr / inflowM3PerYr) * T_PER_M3_TO_UG_PER_L;
  const pLakeUgL = 1.55 * (pInUgL / (1 + Math.sqrt(residenceYr))) ** 0.82;
  return { residenceYr, pInUgL, pLakeUgL, trophic: trophicClass(pLakeUgL) };
}

export interface LakeBand {
  /** At the shortest residence time (config residenceYr.low). */
  atLow: OecdResult;
  /** At the longest residence time (config residenceYr.high). */
  atHigh: OecdResult;
  minUgL: number;
  maxUgL: number;
}

/** Annual inflow (m³/s, long-term mean) to m³/yr. */
export function annualInflowM3(meanInflowM3s: number): number {
  return meanInflowM3s * SECONDS_PER_YEAR;
}

/** OECD result over the config's residence-time range, for an annual inflow and TP load. */
export function lakeBand(
  lake: LakeConfig,
  inflowM3PerYr: number,
  tpLoadTPerYr: number | null = lake.tpLoadTPerYr.value,
): LakeBand {
  if (tpLoadTPerYr === null) throw new Error("lake: tpLoadTPerYr has no value");
  // The volume is not needed: the residence time comes from the config range.
  const base = { tpLoadTPerYr, inflowM3PerYr };
  const atLow = oecdLake({ ...base, residenceYr: lake.residenceYr.low });
  const atHigh = oecdLake({ ...base, residenceYr: lake.residenceYr.high });
  return {
    atLow,
    atHigh,
    minUgL: Math.min(atLow.pLakeUgL, atHigh.pLakeUgL),
    maxUgL: Math.max(atLow.pLakeUgL, atHigh.pLakeUgL),
  };
}
