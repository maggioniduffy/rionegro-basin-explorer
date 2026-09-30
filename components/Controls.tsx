"use client";

import { useTranslations } from "next-intl";
import { MASK_LEVEL_COUNT } from "@/lib/map/config";
import { useMapStore } from "@/lib/store";
import { Legend } from "./Legend";
import { ThemeToggle } from "./ThemeToggle";

export function Controls() {
  const t = useTranslations("controls");
  const visibleLand = useMapStore((s) => s.visibleLand);
  const setVisibleLand = useMapStore((s) => s.setVisibleLand);
  const hideEndorheic = useMapStore((s) => s.hideEndorheic);
  const setHideEndorheic = useMapStore((s) => s.setHideEndorheic);
  const max = MASK_LEVEL_COUNT - 1;

  return (
    <section
      aria-label={t("label")}
      className="absolute bottom-10 left-3 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-4 rounded-lg border border-(--border) bg-(--panel) p-4 text-sm shadow-lg backdrop-blur"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="visible-land" className="font-medium">
          {t("visibleLand")}
        </label>
        <input
          id="visible-land"
          type="range"
          min={0}
          max={max}
          step={0.01}
          value={visibleLand}
          aria-valuetext={t("visibleLandValue", {
            level: Math.round(visibleLand) + 1,
            count: max + 1,
          })}
          onChange={(e) => setVisibleLand(Number(e.target.value))}
          className="w-full accent-sky-400"
        />
        <div className="text-muted flex justify-between text-xs">
          <span>{t("visibleLandMin")}</span>
          <span>{t("visibleLandMax")}</span>
        </div>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 accent-sky-400"
          checked={hideEndorheic}
          onChange={(e) => setHideEndorheic(e.target.checked)}
        />
        <span>
          {t("hideEndorheic")}
          <span className="text-muted block text-xs">
            {t("hideEndorheicHint")}
          </span>
        </span>
      </label>

      <Legend />
      <ThemeToggle />
    </section>
  );
}
