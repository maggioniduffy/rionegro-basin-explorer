"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MASK_LEVEL_COUNT } from "@/lib/map/config";
import { useMapStore } from "@/lib/store";
import { Icon } from "./Icon";
import { Legend } from "./Legend";
import { SubbasinTree } from "./SubbasinTree";
import { ThemeToggle } from "./ThemeToggle";
import { ViewModeToggle } from "./ViewModeToggle";

/** The map controls panel, bottom left (desktop; phones get them in the bottom sheet). */
export function Controls() {
  const t = useTranslations("controls");
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label={t("label")}
      className={`absolute bottom-(--panel-bottom) left-3 flex max-h-[calc(100dvh_-_var(--panel-top)_-_var(--panel-bottom))] max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-(--border) bg-(--panel) text-sm shadow-lg backdrop-blur ${
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
        className="flex shrink-0 items-center justify-between gap-3 rounded-lg px-4 py-2.5 font-medium hover:bg-(--panel-hover)"
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

      {/* Hidden rather than unmounted, so slider and checkbox keep their state. It scrolls
          on its own when the sub-basin tree makes it taller than the screen allows; the
          header stays put. */}
      <div
        id="map-controls-body"
        hidden={!open}
        className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4"
      >
        <MapControlsContent />
      </div>
    </section>
  );
}

/** View mode, Visible Land, stream toggles, sub-basin tree, legend and theme. */
export function MapControlsContent() {
  const t = useTranslations("controls");
  const visibleLand = useMapStore((s) => s.visibleLand);
  const setVisibleLand = useMapStore((s) => s.setVisibleLand);
  const hideEndorheic = useMapStore((s) => s.hideEndorheic);
  const setHideEndorheic = useMapStore((s) => s.setHideEndorheic);
  const showIgnDetail = useMapStore((s) => s.showIgnDetail);
  const setShowIgnDetail = useMapStore((s) => s.setShowIgnDetail);
  const viewMode = useMapStore((s) => s.viewMode);
  const max = MASK_LEVEL_COUNT - 1;

  return (
    <>
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

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 accent-sky-400"
          checked={showIgnDetail}
          onChange={(e) => setShowIgnDetail(e.target.checked)}
        />
        <span>
          {t("showIgnDetail")}
          <span className="text-muted block text-xs">
            {t("showIgnDetailHint")}
          </span>
        </span>
      </label>

      {viewMode === "subbasins" && <SubbasinTree />}
      <Legend />
      <ThemeToggle />
    </>
  );
}
