"use client";

import { useTranslations } from "next-intl";
import { UNITS_STORAGE_KEY, useMapStore } from "@/lib/store";
import { UNIT_SYSTEMS, type UnitSystem } from "@/lib/units";
import { useAdoptSavedUnits } from "@/lib/use-saved-units";
import { Icon } from "./Icon";

/** km/mi for the panels and the scale bar; remembered in localStorage. */
export function UnitsToggle() {
  const t = useTranslations("options.units");
  const units = useMapStore((s) => s.units);
  const setUnits = useMapStore((s) => s.setUnits);

  useAdoptSavedUnits();

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
