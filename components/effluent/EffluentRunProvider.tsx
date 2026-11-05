"use client";

import { useMemo, type ReactNode } from "react";
import { useRegion } from "@/components/RegionProvider";
import type { DischargeForecast } from "@/lib/effluent/forecast";
import { getEffluentRegion } from "@/lib/effluent/registry";
import {
  EffluentForecastContext,
  EffluentForecastDatesContext,
  EffluentForecastStatusContext,
  type ForecastStatus,
  EffluentRunContext,
  LOADING,
  OFF,
  runEffluent,
  unavailable,
} from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";

/**
 * Computes the run for the store's effluent state once and shares it: mount it once above every
 * reader (the map page; the analysis page). The forecast is fetched only for a scenario other
 * than the long-term mean (or always, with `alwaysFetchForecast`, for the analysis page's comparison;
 * the run still uses the mean for the mean scenario); a scenario the forecast can't give is "unavailable", never the mean.
 * A region without an effluent net is "off" and fetches nothing.
 */
export function EffluentRunProvider({
  children,
  alwaysFetchForecast = false,
}: {
  children: ReactNode;
  alwaysFetchForecast?: boolean;
}) {
  const region = useRegion();
  const effluent = useMapStore((s) => s.effluent);
  const scenario = effluent?.overrides.scenario;
  const configured = getEffluentRegion(region) !== null;
  const forecast = useApi<DischargeForecast>(
    (scenario || (alwaysFetchForecast && effluent)) && configured
      ? "/api/discharge"
      : null,
  );
  const run = useMemo(() => {
    if (!effluent || !configured) return OFF;
    if (scenario && forecast.status === "loading") return LOADING;
    if (scenario && forecast.status !== "ok")
      return unavailable({ reason: "forecast" });
    return runEffluent(
      region,
      effluent,
      scenario && forecast.status === "ok" ? forecast.data : null,
    );
  }, [region, effluent, configured, scenario, forecast]);
  // A scenario's 0-based `day` indexes the gauges' days (labelled day+1); the first gauge's dates label them.
  const dates = useMemo(
    () =>
      forecast.status === "ok"
        ? (forecast.data.gauges[0]?.days.map((d) => d.date) ?? null)
        : null,
    [forecast],
  );
  const fetched = forecast.status === "ok" ? forecast.data : null;
  const status: ForecastStatus =
    forecast.status === "ok"
      ? "ok"
      : forecast.status === "loading" && (scenario || alwaysFetchForecast)
        ? "loading"
        : "unavailable";
  return (
    <EffluentRunContext value={run}>
      <EffluentForecastContext value={fetched}>
        <EffluentForecastStatusContext value={status}>
          <EffluentForecastDatesContext value={dates}>
            {children}
          </EffluentForecastDatesContext>
        </EffluentForecastStatusContext>
      </EffluentForecastContext>
    </EffluentRunContext>
  );
}
