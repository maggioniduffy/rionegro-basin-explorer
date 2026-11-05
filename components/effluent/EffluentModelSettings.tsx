"use client";

import { useLocale, useTranslations } from "next-intl";
import { NumberField } from "@/components/effluent/EffluentInputs";
import { useRegion } from "@/components/RegionProvider";
import { roundInput, type InputField } from "@/lib/effluent/inputs";
import { getEffluentRegion } from "@/lib/effluent/registry";
import type { ParamLevels } from "@/lib/effluent/river";
import { LEVELS, type Level } from "@/lib/effluent/schema";
import { useMapStore } from "@/lib/store";
import type { EffluentOverrides } from "@/lib/url-state";

const CARD = "bg-surface border-line-card rounded-[14px] border";
const LEVEL_FIELDS = ["kd", "manningN", "widthCoef"] as const;

const CLEAR: Partial<EffluentOverrides> = {
  doMinMgL: undefined,
  coliformsThreshold: undefined,
  tempC: undefined,
  levels: undefined,
};

/** The model settings of the analysis page: thresholds, water temperature and coefficient levels. */
export function EffluentModelSettings() {
  const t = useTranslations("effluents.settings");
  const tn = useTranslations("effluent");
  const locale = useLocale();
  const region = useRegion();
  const overrides = useMapStore((s) => s.effluent?.overrides);
  const set = useMapStore((s) => s.setEffluentOverrides);
  const data = getEffluentRegion(region);
  if (!data || !overrides) return null;
  const { thresholds, coefficients: c } = data.config;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });

  const commit = (field: InputField, raw: string, dflt: number | null) => {
    const v = roundInput(field, raw.trim() === "" ? NaN : Number(raw));
    if (v === null) return null;
    set({ [field]: v === dflt ? undefined : v });
    return v;
  };
  const levels: ParamLevels = {
    kd: overrides.levels?.kd ?? "central",
    manningN: overrides.levels?.manningN ?? "central",
    widthCoef: overrides.levels?.widthCoef ?? "central",
  };
  const pick = (key: (typeof LEVEL_FIELDS)[number], level: Level) => {
    const next: Partial<ParamLevels> = {};
    for (const k of LEVEL_FIELDS) {
      const l = k === key ? level : levels[k];
      if (l !== "central") next[k] = l;
    }
    set({ levels: Object.keys(next).length > 0 ? next : undefined });
  };
  const hasOverride = Object.keys(CLEAR).some(
    (k) => overrides[k as keyof EffluentOverrides] !== undefined,
  );

  const numbers: {
    field: InputField;
    label: string;
    unit: string;
    value: number | null;
    dflt: number | null;
    source: string;
  }[] = [
    {
      field: "doMinMgL",
      label: t("doThreshold"),
      unit: tn("units.doMgL"),
      value: overrides.doMinMgL ?? thresholds.doMinMgL.value,
      dflt: thresholds.doMinMgL.value,
      source: thresholds.doMinMgL.source,
    },
    {
      field: "coliformsThreshold",
      label: t("coliThreshold"),
      unit: tn("units.coliformsPer100mL"),
      value: overrides.coliformsThreshold ?? thresholds.coliformsPer100mL.value,
      dflt: thresholds.coliformsPer100mL.value,
      source: thresholds.coliformsPer100mL.source,
    },
    {
      field: "tempC",
      label: t("temp"),
      unit: "°C",
      value: overrides.tempC ?? c.waterTempC.value,
      dflt: c.waterTempC.value,
      source: c.waterTempC.source,
    },
  ];

  const groups = [
    {
      key: "kd",
      label: t("kd"),
      note: t("kdNote"),
      source: c.kdPerDay.source,
      detail: (l: Level) =>
        t("kdValue", {
          kd: num.format(c.kdPerDay[l]),
          kb: num.format(c.coliformDecayPerDay[l]),
        }),
      extra: t("kbSource", { source: c.coliformDecayPerDay.source }),
    },
    {
      key: "manningN",
      label: t("manningN"),
      note: null,
      source: c.manningN.source,
      detail: (l: Level) => t("nValue", { n: num.format(c.manningN[l]) }),
      extra: null,
    },
    {
      key: "widthCoef",
      label: t("widthCoef"),
      note: null,
      source: c.widthCoef.source,
      detail: (l: Level) =>
        t("widthValue", {
          a: num.format(c.widthCoef[l]),
          m: num.format(c.widthCoef.exponent),
        }),
      extra: null,
    },
  ] as const;

  return (
    <details className={`${CARD} group`}>
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 text-sm font-medium">
        {t("title")}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!hasOverride}
            onClick={() => set(CLEAR)}
            className="border-line min-h-10 rounded-md border px-3 text-sm disabled:opacity-50"
          >
            {t("reset")}
          </button>
        </div>
        {numbers.map((f) => (
          <div key={f.field} className="flex flex-col gap-1">
            <NumberField
              field={f.field}
              label={`${f.label} (${t("assumption")})`}
              unit={f.unit}
              value={f.value}
              placeholder={f.dflt === null ? tn("notSet") : undefined}
              onCommit={(raw) => commit(f.field, raw, f.dflt)}
            />
            <p className="text-muted text-xs">
              {t("source", { source: f.source })}
            </p>
          </div>
        ))}
        {groups.map((g) => {
          const key = g.key;
          return (
            <fieldset key={key} className="flex min-w-0 flex-col gap-1">
              <legend className="mb-1 text-sm">{g.label}</legend>
              {g.note && <p className="text-muted text-xs">{g.note}</p>}
              <div
                role="group"
                aria-label={g.label}
                className="border-line flex overflow-hidden rounded-lg border"
              >
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={levels[key] === l}
                    onClick={() => pick(key, l)}
                    className={`not-first:border-line flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center px-1 py-1 text-xs not-first:border-l ${
                      levels[key] === l
                        ? "bg-surface-active text-text font-semibold"
                        : "text-secondary hover:text-text hover:bg-(--panel-hover)"
                    }`}
                  >
                    <span>{t(`level.${l}`)}</span>
                    <span className="font-mono tabular-nums">
                      {g.detail(l)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-muted text-xs">
                {t("source", { source: g.source })}
              </p>
              {g.extra && <p className="text-muted text-xs">{g.extra}</p>}
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}
