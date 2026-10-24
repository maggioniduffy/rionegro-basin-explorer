"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, type KeyboardEvent, useState } from "react";
import { MASK_LEVEL_COUNT } from "@/lib/map/config";
import { levelToPosition, positionToLevel } from "@/lib/map/mask";
import { useMapStore } from "@/lib/store";
import { Icon, type IconName } from "./Icon";
import { Legend } from "./Legend";
import { DisplayOptionsContent } from "./OptionsPanel";
import { SubbasinTree } from "./SubbasinTree";
import { ViewModeToggle } from "./ViewModeToggle";

const TABS = ["map", "display"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICON: Record<Tab, IconName> = { map: "layers", display: "units" };

/**
 * The one left panel (desktop; phones get the same content in the bottom sheet): the
 * map controls and the display options as tabs, bottom left. The chevron minimizes it
 * to just the header row; clicking a tab while minimized opens it on that tab.
 */
export function Controls() {
  const t = useTranslations("controls");
  const ts = useTranslations("sheet");
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("map");

  function chooseTab(next: Tab) {
    setTab(next);
    setOpen(true);
  }

  // Tabs pattern (WAI-ARIA): one tab stop; arrows, Home and End move between tabs.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    chooseTab(next);
    document.getElementById(`controls-tab-${next}`)?.focus();
  }

  return (
    <section
      aria-label={t("label")}
      className={`border-line bg-panel-glass shadow-card absolute bottom-(--panel-bottom) left-3 flex max-h-[calc(100dvh_-_var(--panel-top)_-_var(--panel-bottom))] max-w-[calc(100vw-1.5rem)] flex-col rounded-[10px] border text-sm backdrop-blur-[6px] ${
        open ? "w-72" : "w-auto"
      }`}
    >
      {/* Minimized, only this header row stays; the map behind it is free to use. */}
      <div className="flex shrink-0 items-center gap-1 p-1.5">
        <div
          role="tablist"
          aria-label={t("label")}
          className="flex min-w-0 flex-1 gap-1"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`controls-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="map-controls-body"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => chooseTab(id)}
              onKeyDown={onTabKeyDown}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
                open && tab === id
                  ? "bg-(--panel-hover) font-medium"
                  : "text-muted hover:bg-(--panel-hover)"
              }`}
            >
              <Icon name={TAB_ICON[id]} />
              {ts(`tabs.${id}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="map-controls-body"
          title={open ? t("minimize") : t("expand")}
          className="shrink-0 rounded-md p-1.5 hover:bg-(--panel-hover)"
        >
          <Icon
            name="chevron"
            className={`transition-transform ${open ? "rotate-90" : "-rotate-90"}`}
          />
        </button>
      </div>

      {/* Hidden rather than unmounted, so slider, checkbox and tree keep their state,
          also across tabs. It scrolls on its own when the sub-basin tree makes it taller
          than the screen allows; the header stays put. The minimap is mounted only
          while visible, so it holds no WebGL context otherwise. */}
      <div
        id="map-controls-body"
        role="tabpanel"
        aria-labelledby={`controls-tab-${tab}`}
        hidden={!open}
        className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-4"
      >
        <div hidden={tab !== "map"} className="flex flex-col gap-4">
          <MapControlsContent />
        </div>
        <div hidden={tab !== "display"} className="flex flex-col gap-4">
          <DisplayOptionsContent minimap={open && tab === "display"} />
        </div>
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
