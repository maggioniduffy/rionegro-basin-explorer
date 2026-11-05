"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRegion, useRegionPath } from "@/components/RegionProvider";
import { PanelFrame, useFormat } from "@/components/panel/parts";
import {
  INPUT_BOUNDS,
  roundInput,
  type InputField,
} from "@/lib/effluent/inputs";
import { getEffluentRegion } from "@/lib/effluent/registry";
import {
  effluentFromConfig,
  type EffluentInputField,
} from "@/lib/effluent/river";
import { useEffluentRun, useForecastDates } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";
import { effluentSearch, type EffluentOverrides } from "@/lib/url-state";
import type { ScenarioSelector } from "@/lib/effluent/forecast";

const FIELDS = [
  "flowM3s",
  "bodMgL",
  "coliformsPer100mL",
  "doMgL",
] as const satisfies readonly EffluentInputField[];
type Field = (typeof FIELDS)[number];

/** Forecast days offered before a forecast is fetched (the API is asked for more). */
const FALLBACK_DAYS = 7;
const STATS = ["p25", "median", "p75"] as const;
type Stat = (typeof STATS)[number];
type Forecast = Exclude<ScenarioSelector, "mean" | "today">;

const SELECT =
  "border-line bg-panel-glass min-h-10 rounded-md border px-2 text-sm";

/**
 * The panel of the discharge being simulated, in place of the info panel while effluent mode is
 * on: outfall, inputs, scenario, the run's results and its caveats.
 */
export function EffluentPanel() {
  const t = useTranslations("effluent");
  const region = useRegion();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const moveOutfall = useMapStore((s) => s.moveOutfall);
  const exitEffluent = useMapStore((s) => s.exitEffluent);
  const run = useEffluentRun();
  const data = getEffluentRegion(region);
  if (!data || reach === null) return null;
  const outfalls = data.config.outfalls;
  const configured = outfalls.some((o) => o.reach === reach);

  return (
    <PanelFrame
      label={t("title")}
      busy={run.status === "loading"}
      onClose={exitEffluent}
    >
      <header className="flex flex-col gap-2 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {t("title")}
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">{t("outfall")}</span>
          <select
            className={SELECT}
            value={reach}
            onChange={(e) => moveOutfall(Number(e.target.value))}
          >
            {outfalls.map((o) => (
              <option key={o.id} value={o.reach}>
                {o.name}
              </option>
            ))}
            {!configured && (
              <option value={reach}>{t("customReach", { id: reach })}</option>
            )}
          </select>
        </label>
      </header>
      <Inputs reach={reach} configured={configured} />
      {run.status === "loading" && <p className="text-muted">{t("loading")}</p>}
      {run.status === "unavailable" && <Failure />}
      {run.status === "ok" && <Results />}
      <Notes />
    </PanelFrame>
  );
}

function Inputs({ reach, configured }: { reach: number; configured: boolean }) {
  const t = useTranslations("effluent");
  const region = useRegion();
  const overrides = useMapStore((s) => s.effluent?.overrides);
  const set = useMapStore((s) => s.setEffluentOverrides);
  const dates = useForecastDates();
  const data = getEffluentRegion(region);
  const base =
    data?.config.outfalls.find((o) => o.reach === reach) ??
    data?.config.outfalls[0];
  if (!data || !base || !overrides) return null;
  const defaults = effluentFromConfig(data.config, base.id);

  const commit = (field: InputField, raw: string, dflt: number | null) => {
    const n = raw.trim() === "" ? NaN : Number(raw);
    const v = roundInput(field, n);
    if (v === null) return null;
    set({ [field]: v === dflt ? undefined : v });
    return v;
  };
  const scenario = overrides.scenario;
  const forecast: Forecast | null =
    scenario && scenario !== "today" ? scenario : null;
  const days = Math.max(
    dates?.length ?? FALLBACK_DAYS,
    forecast ? forecast.day + 1 : 0,
  );
  const scenarioValue =
    scenario === undefined
      ? "mean"
      : scenario === "today"
        ? "today"
        : `d${scenario.day}`;
  const pickScenario = (value: string, stat: Stat) => {
    if (value === "mean") set({ scenario: undefined });
    else if (value === "today") set({ scenario: "today" });
    else set({ scenario: { day: Number(value.slice(1)), stat } });
  };
  const removal = overrides.removalPct ?? 0;
  const clear: Partial<EffluentOverrides> = {
    flowM3s: undefined,
    bodMgL: undefined,
    coliformsPer100mL: undefined,
    doMgL: undefined,
    removalPct: undefined,
    scenario: undefined,
  };
  const hasOverride = Object.keys(clear).some(
    (k) => overrides[k as keyof EffluentOverrides] !== undefined,
  );

  return (
    <section className="flex flex-col gap-3" aria-label={t("inputs")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
          {t("inputs")}
        </h3>
        <button
          type="button"
          disabled={!hasOverride}
          onClick={() => set(clear)}
          className="border-line min-h-10 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {t("reset")}
        </button>
      </div>
      <p className="text-muted text-xs">
        {t(configured ? "defaultsOutfall" : "defaultsAssumption", {
          name: base.name,
        })}
      </p>
      {FIELDS.map((field) => (
        <NumberField
          key={field}
          field={field}
          label={t(`fields.${field}`)}
          unit={t(`units.${field}`)}
          value={overrides[field] ?? defaults[field]}
          placeholder={defaults[field] === null ? t("notSet") : undefined}
          onCommit={(raw) => commit(field, raw, defaults[field])}
        />
      ))}
      <label className="flex flex-col gap-1">
        <span className="flex justify-between text-sm">
          {t("fields.removalPct")}
          <span className="font-mono tabular-nums">{removal} %</span>
        </span>
        <input
          type="range"
          min={INPUT_BOUNDS.removalPct.min}
          max={INPUT_BOUNDS.removalPct.max}
          step={INPUT_BOUNDS.removalPct.step ?? 1}
          value={removal}
          onChange={(e) => {
            const v = roundInput("removalPct", Number(e.target.value));
            if (v !== null) set({ removalPct: v === 0 ? undefined : v });
          }}
          style={{ "--fill": `${removal}%` } as React.CSSProperties}
          className="range-slider"
        />
        <Limit field="removalPct" unit="%" />
      </label>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">{t("scenario.label")}</span>
          <select
            className={SELECT}
            value={scenarioValue}
            onChange={(e) =>
              pickScenario(e.target.value, forecast?.stat ?? "median")
            }
          >
            <option value="mean">{t("scenario.mean")}</option>
            <option value="today">{t("scenario.today")}</option>
            {Array.from({ length: days }, (_, i) => (
              <option key={i} value={`d${i}`}>
                {dates?.[i]
                  ? t("scenario.dayDated", { day: i + 1, date: dates[i] })
                  : t("scenario.day", { day: i + 1 })}
              </option>
            ))}
          </select>
        </label>
        {forecast && (
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs">{t("scenario.stat")}</span>
            <select
              className={SELECT}
              value={forecast.stat}
              onChange={(e) =>
                set({
                  scenario: { day: forecast.day, stat: e.target.value as Stat },
                })
              }
            >
              {STATS.map((s) => (
                <option key={s} value={s}>
                  {t(`scenario.stats.${s}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </section>
  );
}

function Limit({ field, unit }: { field: InputField; unit: string }) {
  const t = useTranslations("effluent");
  const locale = useLocale();
  const { min, max } = INPUT_BOUNDS[field];
  const n = new Intl.NumberFormat(locale);
  return (
    <span className="text-muted text-xs">
      {t("limit", { min: n.format(min), max: n.format(max), unit })}
    </span>
  );
}

/** A number field that commits on blur or Enter; `onCommit` returns the stored value, null to revert. */
function NumberField({
  field,
  label,
  unit,
  value,
  placeholder,
  onCommit,
}: {
  field: Field;
  label: string;
  unit: string;
  value: number | null;
  placeholder?: string;
  onCommit: (raw: string) => number | null;
}) {
  const id = `effluent-${field}`;
  const shown = value === null ? "" : String(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          // Remounts when the stored value changes (reset, URL), dropping the draft text.
          key={shown}
          id={id}
          type="number"
          inputMode="decimal"
          min={INPUT_BOUNDS[field].min}
          max={INPUT_BOUNDS[field].max}
          step="any"
          defaultValue={shown}
          placeholder={placeholder}
          onBlur={(e) => {
            const v = onCommit(e.currentTarget.value);
            e.currentTarget.value = v === null ? shown : String(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="border-line bg-panel-glass min-h-10 w-full rounded-md border px-2 text-right font-mono text-sm tabular-nums"
        />
        <span className="text-muted w-16 shrink-0 text-xs">{unit}</span>
      </div>
      <Limit field={field} unit={unit} />
    </div>
  );
}

function Failure() {
  const t = useTranslations("effluent");
  const run = useEffluentRun();
  const set = useMapStore((s) => s.setEffluentOverrides);
  if (run.status !== "unavailable") return null;
  if (run.reason === "forecast")
    return (
      <div className="flex flex-col items-start gap-2" role="alert">
        <p className="text-warning">{t("failure.forecast")}</p>
        <button
          type="button"
          onClick={() => set({ scenario: undefined })}
          className="border-line min-h-10 rounded-md border px-3 text-sm"
        >
          {t("failure.useMean")}
        </button>
      </div>
    );
  if (run.reason === "inputs")
    return (
      <p className="text-warning" role="alert">
        {run.field
          ? t("failure.inputsField", { field: t(`fields.${run.field}`) })
          : t("failure.inputs")}
      </p>
    );
  return (
    <p className="text-warning" role="alert">
      {t(run.reason === "outsideNet" ? "failure.outsideNet" : "failure.config")}
    </p>
  );
}

function Results() {
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

const LINK =
  "underline decoration-(--border) underline-offset-2 hover:decoration-current";

function Notes() {
  const t = useTranslations("effluent");
  const inRegion = useRegionPath();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const overrides = useMapStore((s) => s.effluent?.overrides);
  if (reach === null || !overrides) return null;
  const href =
    inRegion("/effluents") +
    effluentSearch(new URLSearchParams(), { reach, overrides });
  return (
    <footer className="text-muted flex flex-col gap-2 border-t border-(--border) pt-3 text-xs">
      <Link
        href={href}
        className="text-text min-h-10 w-fit py-2 text-sm underline"
      >
        {t("fullAnalysis")}
      </Link>
      <p>{t("caveat")}</p>
      <p>{t("mapCoverage")}</p>
      <p>
        {t("attribution.prefix")}{" "}
        <a href="https://open-meteo.com/" className={LINK}>
          Weather data by Open-Meteo.com
        </a>{" "}
        (
        <a href="https://open-meteo.com/en/licence" className={LINK}>
          CC BY 4.0
        </a>
        ). {t("attribution.modified")} Contains modified Copernicus Emergency
        Management Service information 2026.
      </p>
    </footer>
  );
}
