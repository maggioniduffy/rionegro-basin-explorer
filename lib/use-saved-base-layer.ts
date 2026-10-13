"use client";

import { useEffect } from "react";
import {
  BASE_LAYER_STORAGE_KEY,
  BASE_LAYERS,
  type BaseLayer,
  useMapStore,
} from "./store";

export const isBaseLayer = (v: unknown): v is BaseLayer =>
  BASE_LAYERS.some((b) => b === v);

/**
 * Adopt the base-map choice saved in localStorage after mount, as use-saved-units does for
 * km/mi. Until then the map uses satellite, the default.
 */
export function useAdoptSavedBaseLayer() {
  const setBaseLayer = useMapStore((s) => s.setBaseLayer);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BASE_LAYER_STORAGE_KEY);
      if (isBaseLayer(saved)) setBaseLayer(saved);
    } catch {
      // Storage blocked (private mode): satellite for this page.
    }
  }, [setBaseLayer]);
}
