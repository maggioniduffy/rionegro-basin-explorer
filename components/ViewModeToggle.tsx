"use client";

import { useTranslations } from "next-intl";
import { useMapStore, type ViewMode } from "@/lib/store";

const MODES: { mode: ViewMode; key: "viewBasin" | "viewSubbasins" }[] = [
  { mode: "basin", key: "viewBasin" },
  { mode: "subbasins", key: "viewSubbasins" },
];

/** "Basin / Sub-basins" switch: two buttons, the current one pressed. */
export function ViewModeToggle() {
  const t = useTranslations("controls");
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);

  return (
    <div className="flex flex-col gap-1.5">
      <span id="view-mode-label" className="font-medium">
        {t("view")}
      </span>
      <div
        role="group"
        aria-labelledby="view-mode-label"
        className="border-line flex overflow-hidden rounded-lg border"
      >
        {MODES.map(({ mode, key }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => setViewMode(mode)}
            className={`not-first:border-line min-h-9 flex-1 px-2.5 not-first:border-l ${
              viewMode === mode
                ? "bg-surface-active text-text font-semibold"
                : "text-secondary hover:text-text hover:bg-(--panel-hover)"
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
