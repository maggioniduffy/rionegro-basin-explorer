"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { UNITS_STORAGE_KEY, useMapStore } from "@/lib/store";
import { UNIT_SYSTEMS, type UnitSystem } from "@/lib/units";
import { Icon } from "./Icon";

const isUnitSystem = (v: unknown): v is UnitSystem =>
  UNIT_SYSTEMS.some((u) => u === v);

/** km/mi for the panels and the scale bar; remembered in localStorage. */
export function UnitsToggle() {
  const t = useTranslations("options.units");
  const units = useMapStore((s) => s.units);
  const setUnits = useMapStore((s) => s.setUnits);

  // Nothing renders in units before a panel opens, so adopting it after mount is enough.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(UNITS_STORAGE_KEY);
      if (isUnitSystem(saved)) setUnits(saved);
    } catch {
      // Storage blocked (private mode): metric for this page.
    }
  }, [setUnits]);

  function choose(next: UnitSystem) {
    setUnits(next);
    try {
      localStorage.setItem(UNITS_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 flex items-center gap-2 font-medium">
        <Icon name="units" />
        {t("label")}
      </legend>
      <div className="flex rounded-md border border-(--border) p-0.5">
        {UNIT_SYSTEMS.map((u) => (
          <label
            key={u}
            className={`flex-1 cursor-pointer rounded px-2 py-1 text-center has-focus-visible:outline-2 has-focus-visible:outline-sky-400 ${
              units === u ? "bg-(--panel-hover) font-medium" : "text-muted"
            }`}
          >
            <input
              type="radio"
              name="units"
              value={u}
              checked={units === u}
              onChange={() => choose(u)}
              className="sr-only"
            />
            {t(u)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
