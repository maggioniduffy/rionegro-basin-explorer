"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRegion } from "@/components/RegionProvider";
import { useFormat } from "@/components/panel/parts";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun } from "@/lib/effluent/use-run";

/** The run's summary lines (plume, minimum DO, admissible load); null unless the run is ok. */
export function EffluentResults() {
  const t = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const run = useEffluentRun();
  const f = useFormat();
  const data = getEffluentRegion(region);
  if (run.status !== "ok" || !data) return null;
  const { summary } = run.result;
  const num = (n: number, digits = 3) =>
    new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(
      n,
    );
  const flow = run.inputs.rawEffluent.flowM3s;

  const plume = (
    label: string,
    p: { km: number; lastKm: number | null } | null,
  ) =>
    p && (
      <Line key={label} label={label}>
        {p.km === 0
          ? t("results.plumeNone")
          : p.lastKm === null
            ? t("results.plumeKm", { km: f("km", p.km) })
            : t("results.plumeKmLast", {
                km: f("km", p.km),
                last: f("km", p.lastKm),
              })}
      </Line>
    );

  const admissible = (
    label: string,
    a: {
      admissible: number | null;
      baseViolates: boolean;
      cause: string | null;
      requiredRemovalPct: number | null;
    },
    value: (n: number) => string,
  ) => (
    <Line label={label}>
      {a.baseViolates
        ? t(
            `results.violates.${a.cause === "effluentDo" ? "effluentDo" : "background"}`,
          )
        : a.admissible === null
          ? t("results.neverBinds")
          : t("results.admissibleValue", {
              value: value(a.admissible),
              removal: num(a.requiredRemovalPct ?? 0, 2),
            })}
    </Line>
  );

  return (
    <section className="flex flex-col gap-0.5" aria-label={t("results.title")}>
      <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
        {t("results.title")}
      </h3>
      <p className="text-muted text-xs">{t("results.plumeHint")}</p>
      <dl className="divide-line-faint divide-y">
        {plume(t("pollutants.do"), summary.plume.do)}
        {plume(t("pollutants.bod"), summary.plume.bod)}
        {plume(t("pollutants.coliforms"), summary.plume.coliforms)}
        <Line label={t("results.minDo")}>
          {t("results.minDoValue", {
            mgL: num(summary.minDo.mgL),
            km: f("km", summary.minDo.km),
          })}
        </Line>
        {admissible(t("results.admissibleBod"), run.admissible.bod, (c) =>
          t("results.bodValue", {
            mgL: num(c),
            kgD: num(c * flow * 86.4),
          }),
        )}
        {run.admissible.coliforms &&
          admissible(
            t("results.admissibleColiforms"),
            run.admissible.coliforms,
            (c) => t("results.coliformsValue", { n: num(c, 2) }),
          )}
      </dl>
      {summary.entersLake && (
        <p className="text-muted mt-2">
          {t("entersLake", { lake: data.net.lake.name })}
        </p>
      )}
    </section>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-secondary">{label}</dt>
      <dd className="text-text text-right font-mono font-medium tabular-nums">
        {children}
      </dd>
    </div>
  );
}
