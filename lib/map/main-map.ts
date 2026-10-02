import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The main map instance, for the components that drive or read it from outside
 * MapView (minimap, snapshot export). Not in the store: it is not state to render.
 */
let current: MapLibreMap | null = null;
const listeners = new Set<(map: MapLibreMap | null) => void>();

export function setMainMap(map: MapLibreMap | null) {
  current = map;
  for (const l of listeners) l(map);
}

export function getMainMap(): MapLibreMap | null {
  return current;
}

/** Calls `listener` now and whenever the main map is created or removed. */
export function onMainMap(listener: (map: MapLibreMap | null) => void) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
