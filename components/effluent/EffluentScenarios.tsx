"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useRegion } from "@/components/RegionProvider";
import { useFormat } from "@/components/panel/parts";
import {
  runEffluent,
  useComparisonForecast,
  useEffluentRun,
  type EffluentRun,
} from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import type { EffluentUrl } from "@/lib/url-state";

type Ok = Extract<EffluentRun, { status: "ok" }>;
type Column = "mean" | "today" | "forecast";
/** A row's value for a run: a number, or why there is none ("none" = no effluent value meets the threshold). */
type Value = number | "none" | "noLimit";

/** Pending (forecast loading) or the run; `unavailable` covers a failed forecast and unrunnable inputs. */
type Cell = "pending" | EffluentRun;

const withScenario = (
  e: EffluentUrl,
  scenario: EffluentUrl["overrides"]["scenario"],
): EffluentUrl => ({ reach: e.reach, overrides: { ...e.overrides, scenario } });

/**
 * The same inputs under the long-term mean, today and the selected forecast day (median, with
 * p25–p75 as a range). A column whose forecast is unavailable says so; the mean is never
 * substituted. Five more runs of the model, memoized on the inputs and the forecast.
 */
export function EffluentScenarios() {
  const t = useTranslations("effluents.scenarios");
  const te = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const f = useFormat();
  const effluent = useMapStore((s) => s.effluent);
  const run = useEffluentRun();
  const cmp = useComparisonForecast(effluent !== null);
  const forecast = cmp.forecast;

  const selected = effluent?.overrides.scenario;
  const active: Column =
    selected === undefined
      ? "mean"
      : selected === "today"
        ? "today"
        : "forecast";
  // The forecast column is the selected day, else the first one.
  const day = typeof selected === "object" ? selected.day : 0;

  const cells = useMemo(() => {
    if (!effluent) return null;
    const go = (scenario: EffluentUrl["overrides"]["scenario"]): Cell =>
      runEffluent(region, withScenario(effluent, scenario), forecast);
    const needsForecast = (build: () => Cell): Cell =>
      cmp.status === "loading" ? "pending" : build();
    return {
      mean: go(undefined),
      today: needsForecast(() => go("today")),
      median: needsForecast(() => go({ day, stat: "median" })),
      p25: needsForecast(() => go({ day, stat: "p25" })),
      p75: needsForecast(() => go({ day, stat: "p75" })),
    };
  }, [region, effluent, forecast, cmp.status, day]);

  if (run.status !== "ok" || !cells) return null;

  const num = (n: number, digits = 3) =>
    new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(
      n,
    );
  const rows: {
    key: string;
    label: string;
    value: (r: Ok) => Value;
    fmt: (n: number) => string;
  }[] = [
    {
      key: "flow",
      label: t("rows.flow"),
      value: (r) => r.result.path[0]?.qM3s ?? "none",
      fmt: (n) => f("m3s", n),
    },
    {
      key: "plume",
      label: t("rows.plume"),
      value: (r) => r.result.summary.plume.do.km,
      fmt: (n) => (n === 0 ? te("results.plumeNone") : f("km", n)),
    },
    {
      key: "minDo",
      label: t("rows.minDo"),
      value: (r) => r.result.summary.minDo.mgL,
      fmt: (n) => `${num(n)} mg/L`,
    },
    {
      key: "bod",
      label: t("rows.bod"),
      value: (r) =>
        r.admissible.bod.baseViolates
          ? "none"
          : (r.admissible.bod.admissible ?? "noLimit"),
      fmt: (n) => `${num(n)} mg/L`,
    },
    {
      key: "removal",
      label: t("rows.removal"),
      value: (r) =>
        r.admissible.bod.baseViolates
          ? "none"
          : (r.admissible.bod.requiredRemovalPct ?? 0),
      fmt: (n) => `${num(n, 2)} %`,
    },
  ];

  const text = (v: Value, fmt: (n: number) => string) =>
    typeof v === "number" ? fmt(v) : t(`values.${v}`);
  const cell = (c: Cell, row: (typeof rows)[number], range?: [Cell, Cell]) => {
    if (c === "pending") return <span className="text-muted">…</span>;
    if (c.status !== "ok")
      return <span className="text-muted">{t("unavailable")}</span>;
    const v = row.value(c);
    let spread: string | null = null;
    if (range && range[0] !== "pending" && range[1] !== "pending") {
      const of = (r: EffluentRun) => (r.status === "ok" ? row.value(r) : null);
      const a = of(range[0]);
      const b = of(range[1]);
      if (
        typeof a === "number" &&
        typeof b === "number" &&
        typeof v === "number"
      ) {
        const lo = row.fmt(Math.min(a, b));
        const hi = row.fmt(Math.max(a, b));
        if (lo !== hi) spread = t("spread", { lo, hi });
      }
    }
    return (
      <>
        <span>{text(v, row.fmt)}</span>
        {spread && (
          <span className="text-muted block text-xs font-normal">{spread}</span>
        )}
      </>
    );
  };

  const dateLabel = forecast?.gauges[0]?.days[day]?.date;
  const heads: { col: Column; title: string; sub?: string }[] = [
    { col: "mean", title: t("columns.mean") },
    { col: "today", title: t("columns.today") },
    {
      col: "forecast",
      title: t("columns.forecast", { day: day + 1 }),
      sub: dateLabel
        ? new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(new Date(`${dateLabel}T00:00:00Z`))
        : undefined,
    },
  ];
  const tint = (col: Column) => (col === active ? "bg-surface-active/60" : "");

  return (
    <section
      className="bg-surface border-line-card rounded-[14px] border p-4"
      aria-label={t("title")}
    >
      <h2 className="text-lg font-medium">{t("title")}</h2>
      <p className="text-muted mt-1 text-xs">{t("hint")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-[28%] p-2" />
              {heads.map((h) => (
                <th
                  key={h.col}
                  scope="col"
                  aria-current={h.col === active ? "true" : undefined}
                  className={`p-2 text-left align-bottom font-medium ${tint(h.col)}`}
                >
                  {h.title}
                  {h.sub && (
                    <span className="text-muted block text-xs font-normal">
                      {h.sub}
                    </span>
                  )}
                  {h.col === "forecast" && (
                    <span className="text-muted block text-xs font-normal">
                      {t("forecastStat")}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line-faint divide-y">
            {rows.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="text-secondary p-2 text-left font-normal"
                >
                  {row.label}
                </th>
                <td className={`p-2 font-mono tabular-nums ${tint("mean")}`}>
                  {cell(cells.mean, row)}
                </td>
                <td className={`p-2 font-mono tabular-nums ${tint("today")}`}>
                  {cell(cells.today, row)}
                </td>
                <td
                  className={`p-2 font-mono tabular-nums ${tint("forecast")}`}
                >
                  {cell(cells.median, row, [cells.p25, cells.p75])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
