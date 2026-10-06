"use client";

import { useEffect } from "react";
import { UNITS_STORAGE_KEY, useMapStore } from "./store";
import { UNIT_SYSTEMS, type UnitSystem } from "./units";

export const isUnitSystem = (v: unknown): v is UnitSystem =>
  UNIT_SYSTEMS.some((u) => u === v);

/**
 * Adopt the km/mi choice saved in localStorage. Nothing renders in units before
 * hydration needs it, so adopting it after mount is enough.
 */
export function useAdoptSavedUnits() {
  const setUnits = useMapStore((s) => s.setUnits);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(UNITS_STORAGE_KEY);
      if (isUnitSystem(saved)) setUnits(saved);
    } catch {
      // Storage blocked (private mode): metric for this page.
    }
  }, [setUnits]);
}
