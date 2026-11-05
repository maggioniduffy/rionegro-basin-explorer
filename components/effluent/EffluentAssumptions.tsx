"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRegion } from "@/components/RegionProvider";
import { effluentSources } from "@/lib/attributions";
import { getEffluentRegion } from "@/lib/effluent/registry";
import type { Sourced } from "@/lib/effluent/schema";
import { useForecast, useForecastDates } from "@/lib/effluent/use-run";

const CARD = "bg-surface border-line-card rounded-[14px] border p-4";
const LINK = "underline underline-offset-2";
const MODEL_STEPS = [
  "mixing",
  "travel",
  "decay",
  "deficit",
  "temperature",
  "stop",
  "screening",
] as const;

interface Row {
  label: string;
  value: string;
  source: string;
}

/** The model in words, every config entry with its source, the data periods and the caveats. */
export function EffluentAssumptions() {
  const t = useTranslations("effluents.assumptions");
  const tn = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const forecast = useForecast();
  const dates = useForecastDates();
  const data = getEffluentRegion(region);
  if (!data) return null;
  const { config } = data;
  const c = config.coefficients;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const n = (v: number) => num.format(v);
  const notSet = t("notSet");
  const sc = (s: Sourced, unit: string): string =>
    s.value === null ? notSet : `${n(s.value)} ${unit}`;
  const mgL = tn("units.doMgL");
  const per100 = tn("units.coliformsPer100mL");

  const fetched = forecast
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(forecast.fetchedAt))
    : null;
  const year = dates?.[0]
    ? Number(dates[0].slice(0, 4))
    : new Date().getUTCFullYear();
  const sources = effluentSources(year);
  const openMeteo = sources.find((x) => x.id === "openmeteo");
  const glofas = sources.find((x) => x.id === "glofas");

  const trio = (r: { low: number; central: number; high: number }) => ({
    low: n(r.low),
    central: n(r.central),
    high: n(r.high),
  });
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: t("groups.coefficients"),
      rows: [
        {
          label: t("items.kd"),
          value: t("values.rangeDay", {
            ...trio(c.kdPerDay),
            theta: n(c.kdPerDay.theta),
          }),
          source: c.kdPerDay.source,
        },
        {
          label: t("items.coliformDecay"),
          value: t("values.rangeDay", {
            ...trio(c.coliformDecayPerDay),
            theta: n(c.coliformDecayPerDay.theta),
          }),
          source: c.coliformDecayPerDay.source,
        },
        {
          label: t("items.kaRule"),
          value: t("values.kaRule", { theta: n(c.kaRule.theta) }),
          source: c.kaRule.source,
        },
        {
          label: t("items.manningN"),
          value: t("values.range", trio(c.manningN)),
          source: c.manningN.source,
        },
        {
          label: t("items.widthCoef"),
          value: t("values.widthRange", {
            ...trio(c.widthCoef),
            exponent: n(c.widthCoef.exponent),
          }),
          source: c.widthCoef.source,
        },
        {
          label: t("items.minSlope"),
          value: sc(c.minSlope, "m/m"),
          source: c.minSlope.source,
        },
        {
          label: t("items.bottleRate"),
          value: sc(c.bodBottleRatePerDay, "1/d"),
          source: c.bodBottleRatePerDay.source,
        },
        {
          label: t("items.waterTemp"),
          value: sc(c.waterTempC, "°C"),
          source: c.waterTempC.source,
        },
        {
          label: t("items.elevation"),
          value: sc(c.elevationM, "m"),
          source: c.elevationM.source,
        },
      ],
    },
    {
      title: t("groups.thresholds"),
      rows: [
        {
          label: t("items.doMin"),
          value: sc(config.thresholds.doMinMgL, mgL),
          source: config.thresholds.doMinMgL.source,
        },
        {
          label: t("items.coliThreshold"),
          value: sc(config.thresholds.coliformsPer100mL, per100),
          source: config.thresholds.coliformsPer100mL.source,
        },
        {
          label: t("items.bodThreshold"),
          value: sc(config.thresholds.bodMgL, mgL),
          source: config.thresholds.bodMgL.source,
        },
      ],
    },
    {
      title: t("groups.background"),
      rows: [
        {
          label: t("items.bgBod"),
          value: sc(config.background.bodMgL, mgL),
          source: config.background.bodMgL.source,
        },
        {
          label: t("items.bgColi"),
          value: sc(config.background.coliformsPer100mL, per100),
          source: config.background.coliformsPer100mL.source,
        },
        {
          label: t("items.doSat"),
          value: sc(config.background.doSaturationFrac, t("values.fraction")),
          source: config.background.doSaturationFrac.source,
        },
      ],
    },
    ...config.outfalls.map((o) => ({
      title: o.name,
      rows: [
        {
          label: t("items.effFlow"),
          value: sc(o.flowM3s, tn("units.flowM3s")),
          source: o.flowM3s.source,
        },
        {
          label: t("items.effBod"),
          value: sc(o.effluent.bodMgL, mgL),
          source: o.effluent.bodMgL.source,
        },
        ...(o.effluent.doMgL
          ? [
              {
                label: t("items.effDo"),
                value: sc(o.effluent.doMgL, mgL),
                source: o.effluent.doMgL.source,
              },
            ]
          : []),
        {
          label: t("items.effColi"),
          value: sc(o.effluent.coliformsPer100mL, per100),
          source: o.effluent.coliformsPer100mL.source,
        },
        {
          label: t("items.effTp"),
          value: sc(o.effluent.tpMgL, mgL),
          source: o.effluent.tpMgL.source,
        },
      ],
    })),
    {
      title: config.lake.name,
      rows: [
        {
          label: t("items.lakeArea"),
          value: sc(config.lake.areaKm2, "km²"),
          source: config.lake.areaKm2.source,
        },
        {
          label: t("items.lakeVolume"),
          value: sc(config.lake.volumeHm3, "hm³"),
          source: config.lake.volumeHm3.source,
        },
        {
          label: t("items.lakeDepth"),
          value: sc(config.lake.meanDepthM, "m"),
          source: config.lake.meanDepthM.source,
        },
        {
          label: t("items.lakeTp"),
          value: sc(config.lake.tpLoadTPerYr, "t/yr"),
          source: config.lake.tpLoadTPerYr.source,
        },
        {
          label: t("items.lakeResidence"),
          value: t("values.residence", {
            low: n(config.lake.residenceYr.low),
            high: n(config.lake.residenceYr.high),
          }),
          source: config.lake.residenceYr.source,
        },
      ],
    },
  ];

  return (
    <section className={`${CARD} flex flex-col gap-5`}>
      <h2 className="text-lg font-medium">{t("title")}</h2>

      <div className="flex flex-col gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
          {t("model.title")}
        </h3>
        <ul className="text-body flex list-disc flex-col gap-1 pl-5 text-sm">
          {MODEL_STEPS.map((k) => (
            <li key={k}>{t(`model.${k}`)}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
          {t("periods.title")}
        </h3>
        <ul className="text-body flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>{t("periods.hydrorivers")}</li>
          <li>{t("periods.glofas")}</li>
          <li>
            {fetched
              ? t("periods.forecast", { date: fetched })
              : t("periods.noForecast")}
          </li>
          <li>{t("periods.effluent")}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
          {t("entries")}
        </h3>
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-1">
            <h4 className="text-sm font-medium">{g.title}</h4>
            <dl className="flex flex-col">
              {g.rows.map((r) => (
                <div
                  key={r.label}
                  className="border-line-faint flex flex-col gap-0.5 border-t py-2 first:border-t-0"
                >
                  <dt className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span>{r.label}</span>
                    <span className="font-mono tabular-nums">{r.value}</span>
                  </dt>
                  <dd className="text-muted text-xs break-words">
                    {t("source", { source: r.source })}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <div className="text-muted flex flex-col gap-2 text-xs">
        <p>{t("coverage")}</p>
        <p>{t("pending")}</p>
        {openMeteo && glofas && (
          <p>
            {tn("attribution.prefix")}{" "}
            <a href={openMeteo.url} className={LINK}>
              {openMeteo.credit}
            </a>{" "}
            (
            <a href={openMeteo.license.url} className={LINK}>
              {openMeteo.license.name}
            </a>
            ). {tn("attribution.modified")} {glofas.credit}.
          </p>
        )}
      </div>
    </section>
  );
}
