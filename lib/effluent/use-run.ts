"use client";

import { useMemo } from "react";
import type { RegionId } from "@/regions";
import { useRegion } from "@/components/RegionProvider";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { scenarioFor, type DischargeForecast } from "./forecast";
import { netReachIds } from "./overlay";
import { getEffluentRegion } from "./registry";
import {
  CENTRAL_LEVELS,
  effluentFromConfig,
  longTermMeanScenario,
  paramsFromConfig,
  simulate,
  thresholdsFromConfig,
  type Effluent,
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
  effluent: Effluent;
  /** Treatment removal already applied to the BOD and coliforms in `effluent`. */
  removalPct: number;
  params: ModelParams;
  thresholds: Thresholds;
  scenario: Scenario;
}

export type EffluentRun =
  | { status: "off" | "loading" | "unavailable"; inputs: null; result: null }
  | {
      status: "ok";
      inputs: EffluentRunInputs;
      result: SimulationResult;
    };

const OFF: EffluentRun = { status: "off", inputs: null, result: null };
const LOADING: EffluentRun = { status: "loading", inputs: null, result: null };
const UNAVAILABLE: EffluentRun = {
  status: "unavailable",
  inputs: null,
  result: null,
};

/**
 * One run of the model for the store's effluent state. The forecast is fetched only for a
 * scenario other than the long-term mean; a scenario the forecast can't give is "unavailable",
 * never the mean.
 */
export function useEffluentRun(): EffluentRun {
  const region = useRegion();
  const effluent = useMapStore((s) => s.effluent);
  const scenario = effluent?.overrides.scenario;
  const forecast = useApi<DischargeForecast>(
    scenario && getEffluentRegion(region) ? "/api/discharge" : null,
  );
  return useMemo(() => {
    if (!effluent) return OFF;
    if (scenario && forecast.status === "loading") return LOADING;
    if (scenario && forecast.status !== "ok") return UNAVAILABLE;
    return runEffluent(
      region,
      effluent,
      forecast.status === "ok" ? forecast.data : null,
    );
  }, [region, effluent, scenario, forecast]);
}

function runEffluent(
  region: RegionId,
  { reach, overrides }: EffluentUrl,
  forecast: DischargeForecast | null,
): EffluentRun {
  const data = getEffluentRegion(region);
  if (!data || !netReachIds(region)?.has(reach)) return UNAVAILABLE;
  try {
    const { config, net } = data;
    const outfall = config.outfalls.find((o) => o.reach === reach);
    const base = outfall ?? config.outfalls[0];
    if (!base) return UNAVAILABLE;
    const defaults = effluentFromConfig(config, base.id);
    const o: EffluentOverrides = overrides;
    const removal = o.removalPct ?? 0;
    const keep = 1 - removal / 100;
    const coliforms = o.coliformsPer100mL ?? defaults.coliformsPer100mL;
    const effluent: Effluent = {
      ...defaults,
      reachId: reach,
      flowM3s: o.flowM3s ?? defaults.flowM3s,
      bodMgL: (o.bodMgL ?? defaults.bodMgL) * keep,
      doMgL: o.doMgL ?? defaults.doMgL,
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
      ? scenarioFor(forecast as DischargeForecast, net, o.scenario)
      : longTermMeanScenario(net);
    if (!scenario) return UNAVAILABLE;
    const result = simulate({ net, params, effluent, scenario, thresholds });
    return {
      status: "ok",
      inputs: {
        outfallId: base.id,
        defaultsFrom: outfall ? "outfall" : "permitLimitAssumption",
        effluent,
        removalPct: removal,
        params,
        thresholds,
        scenario,
      },
      result,
    };
  } catch (error) {
    // simulate rejects inputs it can't run (RangeError); anything else is a config problem.
    if (!(error instanceof RangeError)) console.error(error);
    return UNAVAILABLE;
  }
}
