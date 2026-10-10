"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, useState } from "react";
import { MASK_LEVEL_COUNT } from "@/lib/map/config";
import { levelToPosition, positionToLevel } from "@/lib/map/mask";
import { useMapStore } from "@/lib/store";
import { Icon } from "./Icon";
import { Legend } from "./Legend";
import { SubbasinTree } from "./SubbasinTree";
import { ViewModeToggle } from "./ViewModeToggle";

/** The map controls panel, bottom left (desktop; phones get them in the bottom sheet). */
export function Controls() {
  const t = useTranslations("controls");
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label={t("label")}
      className={`border-line bg-panel-glass shadow-card absolute bottom-(--panel-bottom) left-3 flex max-h-[calc(100dvh_-_var(--panel-top)_-_var(--panel-bottom))] max-w-[calc(100vw-1.5rem)] flex-col rounded-[10px] border text-sm backdrop-blur-[6px] ${
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
        className="flex shrink-0 items-center justify-between gap-3 rounded-[10px] px-4 py-2.5 font-medium hover:bg-(--panel-hover)"
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

/** View mode, Visible Land, stream toggles, sub-basin tree and legend. */
export function MapControlsContent() {
  const t = useTranslations("controls");
  const visibleLand = useMapStore((s) => s.visibleLand);
  const setVisibleLand = useMapStore((s) => s.setVisibleLand);
  const hideEndorheic = useMapStore((s) => s.hideEndorheic);
  const setHideEndorheic = useMapStore((s) => s.setHideEndorheic);
  const viewMode = useMapStore((s) => s.viewMode);
  const max = MASK_LEVEL_COUNT - 1;
  const position = levelToPosition(visibleLand);

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
          max={1}
          step={0.001}
          value={position}
          aria-valuetext={t("visibleLandValue", {
            level: Math.round(visibleLand) + 1,
            count: max + 1,
          })}
          onChange={(e) =>
            setVisibleLand(positionToLevel(Number(e.target.value)))
          }
          // The filled part of the rail (globals.css .range-slider).
          style={{ "--fill": `${position * 100}%` } as CSSProperties}
          className="range-slider"
        />
        <div className="text-secondary flex justify-between text-xs">
          <span>{t("visibleLandMin")}</span>
          <span>{t("visibleLandMax")}</span>
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-(--accent)"
          checked={hideEndorheic}
          onChange={(e) => setHideEndorheic(e.target.checked)}
        />
        {t("hideEndorheic")}
      </label>

      {viewMode === "subbasins" && <SubbasinTree />}
      <Legend />
    </>
  );
}
