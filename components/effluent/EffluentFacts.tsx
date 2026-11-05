"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { useRegion } from "@/components/RegionProvider";
import { useFormat } from "@/components/panel/parts";
import { paramsWithLevels } from "@/lib/effluent/profile";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { uncertaintyBand, type Band } from "@/lib/effluent/river";
import { useEffluentRun } from "@/lib/effluent/use-run";

/**
 * The run's key results as fact cards: each central value with the range over the 3 × 3 grid of
 * kd (and coliform decay) × Manning n, its unit and a muted source line. Null unless the run is ok.
 */
export function EffluentFacts() {
  const t = useTranslations("effluents.facts");
  const te = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const run = useEffluentRun();
  const f = useFormat();
  const data = getEffluentRegion(region);

  // Nine more admissible-load runs (about 27 simulations); memoized on the run.
  const band = useMemo(() => {
    if (run.status !== "ok" || !data) return null;
    try {
      const { rawEffluent, params, scenario, thresholds } = run.inputs;
      return uncertaintyBand({
        net: data.net,
        effluent: rawEffluent,
        scenario,
        thresholds,
        paramsFor: (levels) => paramsWithLevels(data.config, params, levels),
      });
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [run, data]);

  if (run.status !== "ok" || !data) return null;
  const { summary } = run.result;
  const { coefficients } = data.config;
  const flow = run.inputs.rawEffluent.flowM3s;
  const num = (n: number, digits = 3) =>
    new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(
      n,
    );
  const mgL = (n: number) => `${num(n)} mg/L`;
  const per100 = (n: number) => te("results.coliformsValue", { n: num(n, 2) });
  const pct = (n: number) => `${num(n, 2)} %`;

  const range = (
    b: Band | null | undefined,
    fmt: (n: number) => string,
    nullWord: string,
  ) => {
    if (!b || b.min === b.max) return null;
    const end = (v: number | null) => (v === null ? nullWord : fmt(v));
    return t("range", { lo: end(b.min), hi: end(b.max) });
  };

  const plumeValue = (p: { km: number; lastKm: number | null }) =>
    p.km === 0
      ? te("results.plumeNone")
      : p.lastKm === null
        ? f("km", p.km)
        : te("results.plumeKmLast", {
            km: f("km", p.km),
            last: f("km", p.lastKm),
          });
  const plume = (
    key: "do" | "bod" | "coliforms",
    p: { km: number; lastKm: number | null } | null,
    b: Band | null | undefined,
    decay: "kd" | "coliform",
  ) =>
    p && (
      <Card
        key={key}
        label={t("plume", { pollutant: te(`pollutants.${key}`) })}
        value={plumeValue(p)}
        lines={[range(b, (n) => f("km", n), t("noLimit"))]}
        source={source(decay)}
      />
    );

  function source(decay: "kd" | "coliform") {
    return [
      t("sourceFlow"),
      decay === "kd"
        ? t("sourceKd", { source: coefficients.kdPerDay.source })
        : t("sourceColiformDecay", {
            source: coefficients.coliformDecayPerDay.source,
          }),
    ];
  }

  const admissible = (
    key: "bod" | "coliforms",
    a: {
      admissible: number | null;
      baseViolates: boolean;
      cause: string | null;
      requiredRemovalPct: number | null;
    },
    concentration: Band | null | undefined,
    removal: Band | null | undefined,
    fmt: (n: number) => string,
  ) => {
    const decay = key === "bod" ? "kd" : "coliform";
    const label = te(
      key === "bod" ? "results.admissibleBod" : "results.admissibleColiforms",
    );
    if (a.baseViolates)
      return (
        <Card
          key={key}
          label={label}
          value={te(
            `results.violates.${a.cause === "effluentDo" ? "effluentDo" : "background"}`,
          )}
          lines={[]}
          source={source(decay)}
          small
        />
      );
    return (
      <Card
        key={key}
        label={label}
        value={
          a.admissible === null ? te("results.neverBinds") : fmt(a.admissible)
        }
        lines={[
          a.admissible !== null && key === "bod"
            ? t("kgPerDay", {
                kgD: num(a.admissible * flow * 86.4),
                flow: f("m3s", flow),
              })
            : null,
          range(concentration, fmt, t("noLimit")),
          t("removal", { value: pct(a.requiredRemovalPct ?? 0) }),
          range(removal, pct, t("noRemovalEnough")),
        ]}
        source={source(decay)}
      />
    );
  };

  const kdBand = `${coefficients.kdPerDay.low}–${coefficients.kdPerDay.high}`;
  const nBand = `${coefficients.manningN.low}–${coefficients.manningN.high}`;

  return (
    <section className="flex flex-col gap-3" aria-label={t("title")}>
      <div>
        <h2 className="text-lg font-medium">{t("title")}</h2>
        <p className="text-muted mt-1 text-xs">{te("results.plumeHint")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {plume("do", summary.plume.do, band?.plumeKm.do, "kd")}
        {plume("bod", summary.plume.bod, band?.plumeKm.bod, "kd")}
        {plume(
          "coliforms",
          summary.plume.coliforms,
          band?.plumeKm.coliforms,
          "coliform",
        )}
        <Card
          label={te("results.minDo")}
          value={mgL(summary.minDo.mgL)}
          lines={[
            t("minDoWhere", {
              km: f("km", summary.minDo.km),
              id: summary.minDo.reachId,
            }),
            range(band?.minDoMgL, mgL, t("noLimit")),
          ]}
          source={source("kd")}
        />
        {admissible(
          "bod",
          run.admissible.bod,
          band?.admissibleBodMgL,
          band?.requiredRemovalBodPct,
          mgL,
        )}
        {run.admissible.coliforms &&
          admissible(
            "coliforms",
            run.admissible.coliforms,
            band?.admissibleColiformsPer100mL,
            band?.requiredRemovalColiformsPct,
            per100,
          )}
      </ul>
      <p className="text-muted text-xs">
        {band
          ? t("bandNote", {
              kd: kdBand,
              n: nBand,
              runs: band.runs,
              source: coefficients.manningN.source,
            })
          : t("bandOff")}
      </p>
      {summary.entersLake && (
        <p className="text-muted text-sm">
          {te("entersLake", { lake: data.net.lake.name })}
        </p>
      )}
    </section>
  );
}

/** One fact: label, central value, optional detail lines (null = skipped) and a muted source line. */
function Card({
  label,
  value,
  lines,
  source,
  small = false,
}: {
  label: string;
  value: ReactNode;
  lines: (string | null)[];
  source: string[];
  small?: boolean;
}) {
  return (
    <li className="border-line-card flex min-w-0 flex-col gap-1 rounded-xl border p-3">
      <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
        {label}
      </h3>
      <p
        className={
          small
            ? "text-text font-medium"
            : "text-text font-mono text-xl font-medium tabular-nums"
        }
      >
        {value}
      </p>
      {lines.map(
        (line, i) =>
          line && (
            <p key={i} className="text-secondary text-sm tabular-nums">
              {line}
            </p>
          ),
      )}
      <p className="text-muted mt-1 text-xs">{source.join(" · ")}</p>
    </li>
  );
}
