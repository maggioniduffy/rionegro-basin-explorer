"use client";

import dynamic from "next/dynamic";

// MapLibre needs window and WebGL, so the map is never prerendered.
const MapView = dynamic(() => import("./MapView"), { ssr: false });

export function BasinMap() {
  return <MapView />;
}
