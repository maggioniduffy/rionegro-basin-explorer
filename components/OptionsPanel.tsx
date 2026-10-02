"use client";

import { useTranslations } from "next-intl";
import { useMapStore } from "@/lib/store";
import { Icon } from "./Icon";
import { LayerToggles } from "./LayerToggles";
import { MinimapSection } from "./Minimap";
import { UnitsToggle } from "./UnitsToggle";

/**
 * Display options (units, layer visibility, …), bottom right. Closed, only the header
 * shows. Hidden below `md` until the mobile bottom sheet takes over (PLAN.md Phase 7).
 */
export function OptionsPanel() {
  const t = useTranslations("options");
  const open = useMapStore((s) => s.optionsOpen);
  const setOpen = useMapStore((s) => s.setOptionsOpen);

  return (
    <section
      aria-label={t("label")}
      className="pointer-events-auto mt-auto hidden max-h-[calc(50%-0.375rem)] min-h-0 shrink-0 flex-col rounded-lg border border-(--border) bg-(--panel) text-sm shadow-lg backdrop-blur md:flex"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="display-options-body"
        title={open ? t("minimize") : t("expand")}
        className="flex shrink-0 items-center justify-between gap-3 rounded-lg px-4 py-2.5 font-medium hover:bg-(--panel-hover)"
      >
        <span className="flex items-center gap-2">
          <Icon name="units" />
          {t("label")}
        </span>
        <Icon
          name="chevron"
          className={`transition-transform ${open ? "rotate-90" : "-rotate-90"}`}
        />
      </button>

      {/* Hidden rather than unmounted, so inputs keep their state. The minimap is
          unmounted while closed, so it holds no WebGL context then. */}
      <div
        id="display-options-body"
        hidden={!open}
        className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4"
      >
        {open && <MinimapSection />}
        <UnitsToggle />
        <LayerToggles />
      </div>
    </section>
  );
}
