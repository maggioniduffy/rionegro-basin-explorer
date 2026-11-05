"use client";

import { useMemo, type ReactNode } from "react";
import { useRegion } from "@/components/RegionProvider";
import type { DischargeForecast } from "@/lib/effluent/forecast";
import { getEffluentRegion } from "@/lib/effluent/registry";
import {
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
 * than the long-term mean; a scenario the forecast can't give is "unavailable", never the mean.
 * A region without an effluent net is "off" and fetches nothing.
 */
export function EffluentRunProvider({ children }: { children: ReactNode }) {
  const region = useRegion();
  const effluent = useMapStore((s) => s.effluent);
  const scenario = effluent?.overrides.scenario;
  const configured = getEffluentRegion(region) !== null;
  const forecast = useApi<DischargeForecast>(
    scenario && configured ? "/api/discharge" : null,
  );
  const run = useMemo(() => {
    if (!effluent || !configured) return OFF;
    if (scenario && forecast.status === "loading") return LOADING;
    if (scenario && forecast.status !== "ok")
      return unavailable({ reason: "forecast" });
    return runEffluent(
      region,
      effluent,
      forecast.status === "ok" ? forecast.data : null,
    );
  }, [region, effluent, configured, scenario, forecast]);
  return <EffluentRunContext value={run}>{children}</EffluentRunContext>;
}
