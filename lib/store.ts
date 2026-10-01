import { create } from "zustand";
import type { Bbox } from "./data/schemas";
import type { Theme } from "./map/style";
import type { Selection } from "./url-state";

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
  /** Selected river or reach; mirrored in the URL by UrlSync. */
  selection: Selection | null;
  /** Fit the map to the selection once its data (bbox) has loaded. */
  fitPending: boolean;
  /** Last fit request; `key` makes a repeated fit to the same bbox a change. */
  focus: { bbox: Bbox; key: number } | null;
  select: (selection: Selection | null, opts?: { fit?: boolean }) => void;
  focusOn: (bbox: Bbox) => void;
}

export const useMapStore = create<MapState>()((set) => ({
  visibleLand: DEFAULT_VISIBLE_LAND,
  hideEndorheic: false,
  theme: "dark",
  setVisibleLand: (visibleLand) => set({ visibleLand }),
  setHideEndorheic: (hideEndorheic) => set({ hideEndorheic }),
  setTheme: (theme) => set({ theme }),
  selection: null,
  fitPending: false,
  focus: null,
  select: (selection, opts) =>
    set({ selection, fitPending: Boolean(selection && opts?.fit) }),
  focusOn: (bbox) =>
    set((s) => ({
      fitPending: false,
      focus: { bbox, key: (s.focus?.key ?? 0) + 1 },
    })),
}));
