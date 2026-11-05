"use client";

import { useLocale, useTranslations } from "next-intl";
import { FlowChart } from "@/components/effluent/charts/FlowChart";
import { useRegion } from "@/components/RegionProvider";
import { useFormat } from "@/components/panel/parts";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useComparisonForecast } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";

const CARD = "bg-surface border-line-card rounded-[14px] border p-4";

/** The forecast at the gauge that drives the outfall reach: median, p25–p75, climatology mean, today. */
export function EffluentFlowChart() {
  const t = useTranslations("effluents.flow");
  const locale = useLocale();
  const region = useRegion();
  const f = useFormat();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const cmp = useComparisonForecast(reach !== null);
  const net = getEffluentRegion(region)?.net;
  const gaugeId = net?.reaches.find((r) => r.id === reach)?.gaugeId;
  const gauge = net?.gauges.find((g) => g.id === gaugeId);
  const forecast = cmp.forecast?.gauges.find((g) => g.id === gaugeId);
  if (!net || !gauge) return null;

  const note =
    cmp.status === "loading"
      ? t("loading")
      : !forecast || forecast.days.length === 0
        ? t("unavailable")
        : null;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const num = (n: number) =>
    new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(n);

  return (
    <section className={CARD} aria-label={t("title")}>
      <h2 className="text-lg font-medium">{t("title")}</h2>
      <p className="text-secondary mt-1 text-sm">
        {t("gauge", { name: gauge.name })}
      </p>
      {note || !forecast ? (
        <p className="text-muted mt-3" aria-busy={cmp.status === "loading"}>
          {note}
        </p>
      ) : (
        <div className="mt-3">
          <FlowChart
            title={t("title")}
            desc={t("desc", {
              gauge: gauge.name,
              from: date(forecast.days[0]!.date),
              to: date(forecast.days[forecast.days.length - 1]!.date),
              mean: f("m3s", forecast.climatologyMeanM3s),
            })}
            today={
              forecast.today
                ? {
                    label: date(forecast.today.date),
                    value: forecast.today.m3s,
                  }
                : null
            }
            days={forecast.days.map((d) => ({ ...d, label: date(d.date) }))}
            mean={{
              value: forecast.climatologyMeanM3s,
              label: t("mean", {
                value: f("m3s", forecast.climatologyMeanM3s),
              }),
            }}
            bandLabel={t("band")}
            yLabel={t("yAxis")}
            formatValue={(v) => f("m3s", v)}
            formatTick={num}
          />
          <p className="text-muted mt-2 text-xs">{t("legend")}</p>
          <p className="text-muted mt-1 text-xs">{t("caption")}</p>
        </div>
      )}
    </section>
  );
}
