import "server-only";
import { z } from "zod";
import type { EffluentRegion } from "./registry";
import {
  shapeGaugeForecast,
  type DischargeForecast,
  type GaugeForecast,
} from "./forecast";

const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";
const VARIABLES = [
  "river_discharge",
  "river_discharge_median",
  "river_discharge_p25",
  "river_discharge_p75",
] as const;
const FETCH_TIMEOUT_MS = 10_000;
/** GloFAS runs daily; three hours keeps the upstream load low. */
const REVALIDATE_S = 10_800;
const FORECAST_DAYS = 30;

const series = z.array(z.number().finite().nullable());
const responseSchema = z
  .object({
    daily: z.object({
      time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      river_discharge: series,
      river_discharge_median: series,
      river_discharge_p25: series,
      river_discharge_p75: series,
    }),
  })
  .refine(({ daily }) =>
    VARIABLES.every((v) => daily[v].length === daily.time.length),
  );

async function fetchGauge(
  cell: { id: string; lat: number; lon: number },
  climatologyMeanM3s: number,
): Promise<GaugeForecast> {
  const url =
    `${FLOOD_API}?latitude=${cell.lat}&longitude=${cell.lon}` +
    `&daily=${VARIABLES.join(",")}&past_days=1&forecast_days=${FORECAST_DAYS}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: REVALIDATE_S },
  });
  if (!res.ok) throw new Error(`flood API ${res.status} for ${cell.id}`);
  const body: unknown = await res.json();
  if ((body as { error?: unknown } | null)?.error === true) {
    throw new Error(`flood API error for ${cell.id}`);
  }
  const parsed = responseSchema.parse(body);
  return shapeGaugeForecast(cell.id, climatologyMeanM3s, parsed.daily);
}

/** Today's GloFAS discharge and the next 30 days' ensemble stats for every gauge; throws on any upstream problem. */
export async function fetchDischargeForecast(
  region: EffluentRegion,
): Promise<DischargeForecast> {
  const gauges = await Promise.all(
    region.net.gauges.map((g) => {
      const cell = region.gaugeCells.find((c) => c.id === g.id);
      if (!cell) throw new Error(`no GloFAS cell for gauge ${g.id}`);
      return fetchGauge(cell, g.climatologyMeanM3s);
    }),
  );
  return { fetchedAt: new Date().toISOString(), gauges };
}
