import { longTermMeanScenario, type Scenario } from "./river";
import type { EffluentNet } from "./schema";

/** The parsed Open-Meteo Flood API `daily` block: parallel arrays, one entry per date. */
export interface DailyDischarge {
  time: string[];
  river_discharge: (number | null)[];
  river_discharge_median: (number | null)[];
  river_discharge_p25: (number | null)[];
  river_discharge_p75: (number | null)[];
}

export interface GaugeForecast {
  id: string;
  /** GloFAS climatology mean from effluent-net.json. */
  climatologyMeanM3s: number;
  today: { date: string; m3s: number | null } | null;
  /** Dates after today; ensemble statistics, m³/s. */
  days: {
    date: string;
    median: number | null;
    p25: number | null;
    p75: number | null;
  }[];
}

export interface DischargeForecast {
  fetchedAt: string;
  gauges: GaugeForecast[];
}

/** "today" is the row of the current UTC date; days are the rows after it. */
export function shapeGaugeForecast(
  id: string,
  climatologyMeanM3s: number,
  daily: DailyDischarge,
  now: Date = new Date(),
): GaugeForecast {
  const todayDate = now.toISOString().slice(0, 10);
  const idx = daily.time.indexOf(todayDate);
  const today =
    idx < 0
      ? null
      : { date: todayDate, m3s: daily.river_discharge[idx] ?? null };
  const days: GaugeForecast["days"] = [];
  daily.time.forEach((date, i) => {
    if (date <= todayDate) return;
    days.push({
      date,
      median: daily.river_discharge_median[i] ?? null,
      p25: daily.river_discharge_p25[i] ?? null,
      p75: daily.river_discharge_p75[i] ?? null,
    });
  });
  return { id, climatologyMeanM3s, today, days };
}

/** `day` is 0-based into `days`: day 0 is tomorrow (UTC date after today). */
export type ScenarioSelector =
  "mean" | "today" | { day: number; stat: "p25" | "median" | "p75" };

/** Gauge flows for a selector; null when any gauge lacks the value (never falls back to the mean). */
export function scenarioFor(
  forecast: DischargeForecast,
  net: EffluentNet,
  sel: ScenarioSelector,
): Scenario | null {
  if (sel === "mean") return longTermMeanScenario(net);
  const out: Scenario = {};
  // Gauges must describe the same date, else the scenario mixes days.
  const dates = new Set<string | undefined>();
  for (const g of net.gauges) {
    const f = forecast.gauges.find((x) => x.id === g.id);
    if (!f) return null;
    const v = sel === "today" ? f.today?.m3s : f.days[sel.day]?.[sel.stat];
    if (v == null) return null;
    dates.add(sel === "today" ? f.today?.date : f.days[sel.day]?.date);
    out[g.id] = v;
  }
  return dates.size > 1 ? null : out;
}
