import { create } from "zustand";
import type { Theme } from "./map/style";

/** localStorage key; read before hydration by the inline script in the layout. */
export const THEME_STORAGE_KEY = "theme";

/** Slider starts on the fourth level (~33% of the basin; data/work/mask/report.json). */
export const DEFAULT_VISIBLE_LAND = 3;

interface MapState {
  /** Visible Land slider, 0 … MASK_LEVEL_COUNT − 1 (fractional between levels). */
  visibleLand: number;
  hideEndorheic: boolean;
  theme: Theme;
  setVisibleLand: (v: number) => void;
  setHideEndorheic: (v: boolean) => void;
  setTheme: (t: Theme) => void;
}

// URL sync (?r=, ?s=) arrives with the river panel in Phase 3.
export const useMapStore = create<MapState>()((set) => ({
  visibleLand: DEFAULT_VISIBLE_LAND,
  hideEndorheic: false,
  theme: "dark",
  setVisibleLand: (visibleLand) => set({ visibleLand }),
  setHideEndorheic: (hideEndorheic) => set({ hideEndorheic }),
  setTheme: (theme) => set({ theme }),
}));
