import { create } from "zustand";
import type { Bbox } from "./data/schemas";
import type { Picked } from "./map/picked";
import type { FlowClass, Theme } from "./map/style";
import type { UnitSystem } from "./units";
import type { Selection } from "./url-state";

/** localStorage key; read before hydration by the inline script in the layout. */
export const THEME_STORAGE_KEY = "theme";
/** localStorage key for the km/mi choice; read on mount by UnitsToggle. */
export const UNITS_STORAGE_KEY = "units";
/** localStorage key for the overview map's show/hide; read on mount by OptionsPanel. */
export const MINIMAP_STORAGE_KEY = "minimap";

/**
 * Display toggles for the map's water layers (Display panel). Rivers are the
 * HydroRIVERS reaches, split by GIRES flow class; natural lakes are HydroLAKES lakes
 * and controlled lakes plus IGN water bodies, artificial ones are reservoirs.
 */
export interface LayerVisibility {
  rivers: boolean;
  flow: Record<FlowClass, boolean>;
  naturalLakes: boolean;
  artificialLakes: boolean;
  /** OSM cities, towns and villages. */
  localities: boolean;
}

export const DEFAULT_LAYERS: LayerVisibility = {
  rivers: true,
  flow: { perennial: true, nonPerennial: true, unknown: true },
  naturalLakes: true,
  artificialLakes: true,
  localities: true,
};

/** "basin" shows the basin as one; "subbasins" colours its sub-basins. */
export type ViewMode = "basin" | "subbasins";

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
  viewMode: ViewMode;
  /** Leaving the sub-basin view also clears a selected sub-basin. */
  setViewMode: (m: ViewMode) => void;
  /**
   * Selected river, reach or sub-basin; mirrored in the URL by UrlSync. Selecting a
   * sub-basin switches to the sub-basin view.
   */
  selection: Selection | null;
  /** Fit the map to the selection once its data (bbox) has loaded. */
  fitPending: boolean;
  /** Last fit request; `key` makes a repeated fit to the same bbox a change. */
  focus: { bbox: Bbox; key: number } | null;
  select: (selection: Selection | null, opts?: { fit?: boolean }) => void;
  /**
   * A lake, dam, locality or IGN detail line the user clicked: shown in the panel, not in the URL.
   * Any selection clears it, and picking one clears the selection.
   */
  picked: Picked | null;
  pick: (picked: Picked | null) => void;
  focusOn: (bbox: Bbox) => void;
  /**
   * Sub-basin ids to keep visible while the rest of the basin is hidden, or null.
   * Set from the sub-basin panel; any new selection clears it.
   */
  isolatedIds: string[] | null;
  setIsolatedIds: (ids: string[] | null) => void;
  /**
   * Display options panel (bottom right). While it is open, the right column splits
   * in two halves: the info panel on top, the options below.
   */
  optionsOpen: boolean;
  setOptionsOpen: (v: boolean) => void;
  /** km/mi; panels and the scale bar follow it, independently of the locale. */
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  /** Overview map at the top of the Display panel. */
  showMinimap: boolean;
  setShowMinimap: (v: boolean) => void;
  layers: LayerVisibility;
  setLayers: (patch: Partial<LayerVisibility>) => void;
}

export const useMapStore = create<MapState>()((set) => ({
  visibleLand: DEFAULT_VISIBLE_LAND,
  hideEndorheic: false,
  theme: "dark",
  setVisibleLand: (visibleLand) => set({ visibleLand }),
  setHideEndorheic: (hideEndorheic) => set({ hideEndorheic }),
  setTheme: (theme) => set({ theme }),
  viewMode: "basin",
  setViewMode: (viewMode) =>
    set((s) => ({
      viewMode,
      ...(viewMode === "basin" && s.selection?.kind === "subbasin"
        ? { selection: null, isolatedIds: null }
        : {}),
    })),
  selection: null,
  fitPending: false,
  focus: null,
  select: (selection, opts) =>
    set((s) => ({
      selection,
      picked: null,
      isolatedIds: null,
      fitPending: Boolean(selection && opts?.fit),
      viewMode: selection?.kind === "subbasin" ? "subbasins" : s.viewMode,
    })),
  picked: null,
  pick: (picked) => set({ picked, selection: null, isolatedIds: null }),
  focusOn: (bbox) =>
    set((s) => ({
      fitPending: false,
      focus: { bbox, key: (s.focus?.key ?? 0) + 1 },
    })),
  isolatedIds: null,
  setIsolatedIds: (isolatedIds) => set({ isolatedIds }),
  optionsOpen: false,
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
  units: "metric",
  setUnits: (units) => set({ units }),
  showMinimap: true,
  setShowMinimap: (showMinimap) => set({ showMinimap }),
  layers: DEFAULT_LAYERS,
  setLayers: (patch) => set((s) => ({ layers: { ...s.layers, ...patch } })),
}));
