"use client";

import { createContext, useContext } from "react";
import type { RegionId } from "@/regions";
import { scenarioFor, type DischargeForecast } from "./forecast";
import { netReachIds } from "./overlay";
import { getEffluentRegion } from "./registry";
import {
  CENTRAL_LEVELS,
  InputRangeError,
  admissibleLoad,
  effluentFromConfig,
  longTermMeanScenario,
  paramsFromConfig,
  simulate,
  thresholdsFromConfig,
  type AdmissibleLoad,
  type Effluent,
  type EffluentInputField,
  type ModelParams,
  type Scenario,
  type SimulationResult,
  type Thresholds,
} from "./river";
import type { EffluentOverrides, EffluentUrl } from "@/lib/url-state";

/**
 * Where the effluent's values come from: the configured outfall on that reach, or, for any other
 * reach of the net, the first configured outfall's permit-limit values (an assumption to label).
 */
export type EffluentDefaultsFrom = "outfall" | "permitLimitAssumption";

/** Everything a run used, defaults and overrides resolved; the panel and the analysis page read it. */
export interface EffluentRunInputs {
  /** The configured outfall whose values were the defaults. */
  outfallId: string;
  defaultsFrom: EffluentDefaultsFrom;
  /** The effluent as simulated: `removalPct` already applied to the BOD and coliforms. */
  effluent: Effluent;
  /** The effluent before treatment (defaults and overrides, no removal). */
  rawEffluent: Effluent;
  removalPct: number;
  params: ModelParams;
  thresholds: Thresholds;
  scenario: Scenario;
}

/** Why a run is unavailable; the panel words each one differently. */
export type UnavailableReason =
  /** A scenario other than the mean, and the forecast failed or can't give it. Never the mean instead. */
  | { reason: "forecast" }
  /** The model rejected the inputs; `field` is the effluent field at fault, null if not one. */
  | { reason: "inputs"; field: EffluentInputField | null }
  /** The reach is not in the region's net. */
  | { reason: "outsideNet" }
  /** No configured outfall, or an unexpected error. */
  | { reason: "config" };

export type EffluentRun =
  | { status: "off" | "loading"; inputs: null; result: null; admissible: null }
  | ({
      status: "unavailable";
      inputs: null;
      result: null;
      admissible: null;
    } & UnavailableReason)
  | {
      status: "ok";
      inputs: EffluentRunInputs;
      /** The simulation with the treated effluent. */
      result: SimulationResult;
      /** Admissible load of the untreated effluent: `requiredRemovalPct` is relative to the raw values. */
      admissible: AdmissibleLoad;
    };

export const OFF: EffluentRun = {
  status: "off",
  inputs: null,
  result: null,
  admissible: null,
};
export const LOADING: EffluentRun = {
  status: "loading",
  inputs: null,
  result: null,
  admissible: null,
};
export const unavailable = (r: UnavailableReason): EffluentRun => ({
  status: "unavailable",
  inputs: null,
  result: null,
  admissible: null,
  ...r,
});

export const EffluentRunContext = createContext<EffluentRun | null>(null);

/** The shared run; must be under an EffluentRunProvider. */
export function useEffluentRun(): EffluentRun {
  const run = useContext(EffluentRunContext);
  if (!run) throw new Error("useEffluentRun needs an EffluentRunProvider");
  return run;
}

/** One run of the model for an effluent state; pure, so it runs without React. */
export function runEffluent(
  region: RegionId,
  { reach, overrides }: EffluentUrl,
  forecast: DischargeForecast | null,
): EffluentRun {
  const data = getEffluentRegion(region);
  if (!data || !netReachIds(region)?.has(reach))
    return unavailable({ reason: "outsideNet" });
  try {
    const { config, net } = data;
    const outfall = config.outfalls.find((o) => o.reach === reach);
    const base = outfall ?? config.outfalls[0];
    if (!base) return unavailable({ reason: "config" });
    const defaults = effluentFromConfig(config, base.id);
    const o: EffluentOverrides = overrides;
    const removal = o.removalPct ?? 0;
    const keep = 1 - removal / 100;
    const coliforms = o.coliformsPer100mL ?? defaults.coliformsPer100mL;
    const rawEffluent: Effluent = {
      ...defaults,
      reachId: reach,
      flowM3s: o.flowM3s ?? defaults.flowM3s,
      bodMgL: o.bodMgL ?? defaults.bodMgL,
      doMgL: o.doMgL ?? defaults.doMgL,
      coliformsPer100mL: coliforms,
    };
    const effluent: Effluent = {
      ...rawEffluent,
      bodMgL: rawEffluent.bodMgL * keep,
      coliformsPer100mL: coliforms === null ? null : coliforms * keep,
    };
    const configured = thresholdsFromConfig(config);
    const thresholds: Thresholds = {
      ...configured,
      doMinMgL: o.doMinMgL ?? configured.doMinMgL,
      coliformsPer100mL: o.coliformsThreshold ?? configured.coliformsPer100mL,
    };
    const params = paramsFromConfig(config, { ...CENTRAL_LEVELS, ...o.levels });
    if (o.tempC !== undefined) params.tempC = o.tempC;
    const scenario = o.scenario
      ? forecast && scenarioFor(forecast, net, o.scenario)
      : longTermMeanScenario(net);
    if (!scenario) return unavailable({ reason: "forecast" });
    const result = simulate({ net, params, effluent, scenario, thresholds });
    const admissible = admissibleLoad({
      net,
      params,
      effluent: rawEffluent,
      scenario,
      thresholds,
    });
    return {
      status: "ok",
      inputs: {
        outfallId: base.id,
        defaultsFrom: outfall ? "outfall" : "permitLimitAssumption",
        effluent,
        rawEffluent,
        removalPct: removal,
        params,
        thresholds,
        scenario,
      },
      result,
      admissible,
    };
  } catch (error) {
    // simulate rejects inputs it can't run (RangeError); anything else is a config problem.
    if (error instanceof RangeError)
      return unavailable({
        reason: "inputs",
        field: error instanceof InputRangeError ? error.field : null,
      });
    console.error(error);
    return unavailable({ reason: "config" });
  }
}
