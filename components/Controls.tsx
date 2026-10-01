"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MASK_LEVEL_COUNT } from "@/lib/map/config";
import { useMapStore } from "@/lib/store";
import { Icon } from "./Icon";
import { Legend } from "./Legend";
import { SubbasinLegend } from "./SubbasinLegend";
import { ThemeToggle } from "./ThemeToggle";
import { ViewModeToggle } from "./ViewModeToggle";

export function Controls() {
  const t = useTranslations("controls");
  const visibleLand = useMapStore((s) => s.visibleLand);
  const setVisibleLand = useMapStore((s) => s.setVisibleLand);
  const hideEndorheic = useMapStore((s) => s.hideEndorheic);
  const setHideEndorheic = useMapStore((s) => s.setHideEndorheic);
  const viewMode = useMapStore((s) => s.viewMode);
  const max = MASK_LEVEL_COUNT - 1;
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label={t("label")}
      className={`absolute bottom-10 left-3 flex max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-(--border) bg-(--panel) text-sm shadow-lg backdrop-blur ${
        open ? "w-72" : "w-auto"
      }`}
    >
      {/* Minimized, only this header stays; the map behind it is free to use. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="map-controls-body"
        title={open ? t("minimize") : t("expand")}
        className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 font-medium hover:bg-(--panel-hover)"
      >
        <span className="flex items-center gap-2">
          <Icon name="layers" />
          {t("label")}
        </span>
        <Icon
          name="chevron"
          className={`transition-transform ${open ? "rotate-90" : "-rotate-90"}`}
        />
      </button>

      {/* Hidden rather than unmounted, so slider and checkbox keep their state. */}
      <div
        id="map-controls-body"
        hidden={!open}
        className="flex flex-col gap-4 px-4 pt-1 pb-4"
      >
        <ViewModeToggle />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="visible-land"
            className="flex items-center gap-2 font-medium"
          >
            <Icon name="mask" />
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

        {viewMode === "subbasins" && <SubbasinLegend />}
        <Legend />
        <ThemeToggle />
      </div>
    </section>
  );
}
