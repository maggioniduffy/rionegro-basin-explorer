import { getVersion, setWorkerUrl } from "maplibre-gl";

/**
 * Point MapLibre at the worker copied to /public by scripts/copy-maplibre-worker.ts
 * (runs before `dev` and `build`). The version in the path busts caches on upgrades.
 */
export function setupMaplibreWorker() {
  setWorkerUrl(
    `${window.location.origin}/maplibre/${getVersion()}/maplibre-gl-worker.mjs`,
  );
}
