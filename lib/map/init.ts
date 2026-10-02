import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { setupMaplibreWorker } from "./worker";

let initialized = false;

/** Worker URL and the pmtiles:// protocol, once per page; shared by every map. */
export function initMaplibre() {
  if (initialized) return;
  setupMaplibreWorker();
  addProtocol("pmtiles", new Protocol().tile);
  initialized = true;
}
