"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  addProtocol,
  Map as MapLibreMap,
  ScaleControl,
} from "maplibre-gl";
import { useTranslations } from "next-intl";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import {
  MAP_MAXZOOM,
  MASK_LEVEL_COUNT,
  mapConfig,
  toLngLatBounds,
} from "@/lib/map/config";
import { maskOpacities } from "@/lib/map/mask";
import {
  BACKGROUND_LAYER_ID,
  buildStyle,
  ENDO_MASK_LAYER_IDS,
  endoMaskOpacities,
  FLOW_CLASSES,
  IMAGERY_LAYER_ID,
  LAKE_LAYER_ID,
  lakeFilter,
  MASK_LAYER_IDS,
  OUTLINE_LAYER_ID,
  reachFilter,
  reachLayerId,
  THEME_COLORS,
} from "@/lib/map/style";
import { setupMaplibreWorker } from "@/lib/map/worker";
import { useMapStore } from "@/lib/store";

let initialized = false;
function initMaplibre() {
  if (initialized) return;
  setupMaplibreWorker();
  addProtocol("pmtiles", new Protocol().tile);
  initialized = true;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Keep the initial basin view clear of the header and, on wide screens, the controls panel. */
function fitPadding() {
  const wide = window.innerWidth >= 768;
  return { top: 64, bottom: 32, right: 64, left: wide ? 312 : 16 };
}

type State = ReturnType<typeof useMapStore.getState>;

/** Push store state into an already-loaded map. */
function applyState(map: MapLibreMap, s: State, prev?: State) {
  const landChanged = !prev || s.visibleLand !== prev.visibleLand;
  const endoChanged = !prev || s.hideEndorheic !== prev.hideEndorheic;
  if (landChanged) {
    maskOpacities(s.visibleLand, MASK_LEVEL_COUNT).forEach((opacity, k) => {
      const id = MASK_LAYER_IDS[k];
      if (id) map.setPaintProperty(id, "fill-opacity", opacity);
    });
  }
  if (landChanged || endoChanged) {
    endoMaskOpacities(s.visibleLand, s.hideEndorheic).forEach((opacity, k) => {
      const id = ENDO_MASK_LAYER_IDS[k];
      if (id) map.setPaintProperty(id, "fill-opacity", opacity);
    });
  }
  if (endoChanged) {
    for (const c of FLOW_CLASSES)
      map.setFilter(reachLayerId(c), reachFilter(c, s.hideEndorheic));
    map.setFilter(LAKE_LAYER_ID, lakeFilter(s.hideEndorheic));
  }
  if (!prev || s.theme !== prev.theme) {
    const { mask, outline, lake } = THEME_COLORS[s.theme];
    map.setPaintProperty(BACKGROUND_LAYER_ID, "background-color", mask);
    for (const id of [...MASK_LAYER_IDS, ...ENDO_MASK_LAYER_IDS])
      map.setPaintProperty(id, "fill-color", mask);
    map.setPaintProperty(OUTLINE_LAYER_ID, "line-color", outline);
    map.setPaintProperty(LAKE_LAYER_ID, "line-color", lake);
  }
}

export default function MapView() {
  const t = useTranslations("map");
  // Read by the map-creating effect, which must not depend on `t`: `t` changes on a
  // locale switch, and the map should survive that (only its labels change).
  const tRef = useRef(t);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Client-only component (ssr: false), so document is available here.
  const [supported] = useState(webglSupported);

  useEffect(() => {
    tRef.current = t;
    // MapLibre sets the canvas label once, from the locale option; keep it current.
    mapRef.current?.getCanvas().setAttribute("aria-label", t("maplibre.title"));
  }, [t]);

  useEffect(() => {
    const t = tRef.current;
    const el = container.current;
    if (!el || !supported) return;
    initMaplibre();
    const initial = useMapStore.getState();
    const link = (href: string, text: string) =>
      `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
        style: buildStyle({
          origin: window.location.origin,
          imageryUrl: process.env.NEXT_PUBLIC_IMAGERY_TILE_URL || undefined,
          imageryAttribution: process.env.NEXT_PUBLIC_IMAGERY_ATTRIBUTION,
          dataAttribution: [
            link("https://www.hydrosheds.org", t("attribution.hydrosheds")),
            link(
              "https://doi.org/10.1038/s41586-021-03565-5",
              t("attribution.gires"),
            ),
            link(
              "https://www.hydrosheds.org/products/hydrolakes",
              t("attribution.hydrolakes"),
            ),
          ].join(" | "),
          theme: initial.theme,
          hideEndorheic: initial.hideEndorheic,
          visibleLand: initial.visibleLand,
        }),
        bounds: toLngLatBounds(mapConfig.basinBbox),
        fitBoundsOptions: { padding: fitPadding() },
        maxBounds: toLngLatBounds(mapConfig.bounds),
        minZoom: mapConfig.minzoom,
        maxZoom: MAP_MAXZOOM,
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        locale: {
          "Map.Title": t("maplibre.title"),
          "AttributionControl.ToggleAttribution": t(
            "maplibre.toggleAttribution",
          ),
          "AttributionControl.MapFeedback": t("maplibre.mapFeedback"),
          "ScaleControl.Kilometers": t("maplibre.kilometers"),
          "ScaleControl.Meters": t("maplibre.meters"),
        },
      });
    } catch (err) {
      console.error(err);
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    // Attribution stays expanded: EOX requires it to be clearly visible.
    map.addControl(new AttributionControl({ compact: false }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    mapRef.current = map;

    // Screenshot tests wait for data-map-idle="true" after each change.
    const setIdle = (idle: boolean) =>
      el.setAttribute("data-map-idle", String(idle));
    setIdle(false);
    map.on("movestart", () => setIdle(false));
    map.on("dataloading", () => setIdle(false));
    map.on("idle", () => setIdle(true));
    map.on("error", (e) => console.error(e.error));

    // Reveal the imagery only once the mask can cover it.
    const revealImagery = () => {
      if (!map.getLayer(IMAGERY_LAYER_ID) || !map.isSourceLoaded("mask"))
        return;
      map.setPaintProperty(IMAGERY_LAYER_ID, "raster-opacity", 1);
      map.off("sourcedata", revealImagery);
    };
    map.on("sourcedata", revealImagery);

    let loaded = false;
    map.on("load", () => {
      loaded = true;
      applyState(map, useMapStore.getState());
    });
    const unsubscribe = useMapStore.subscribe((s, prev) => {
      // Only style state needs applying; other store fields don't touch the map.
      if (
        !loaded ||
        (s.visibleLand === prev.visibleLand &&
          s.hideEndorheic === prev.hideEndorheic &&
          s.theme === prev.theme)
      )
        return;
      setIdle(false);
      applyState(map, s, prev);
    });

    return () => {
      unsubscribe();
      map.remove();
      mapRef.current = null;
    };
  }, [supported]);

  if (!supported) {
    return (
      <div className="text-muted flex h-full items-center justify-center p-6 text-center">
        {t("webglError")}
      </div>
    );
  }

  return (
    <>
      {/* MapLibre sets position: relative on its container, so size it from a wrapper. */}
      <div className="absolute inset-0">
        <div
          ref={container}
          className="h-full w-full"
          data-testid="map"
          data-map-idle="false"
        />
      </div>
      <div className="absolute top-16 right-3 flex flex-col overflow-hidden rounded-md border border-(--border) bg-(--panel) shadow">
        <button
          type="button"
          className="h-9 w-9 text-lg hover:bg-(--panel-hover)"
          aria-label={t("zoomIn")}
          title={t("zoomIn")}
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="h-9 w-9 border-t border-(--border) text-lg hover:bg-(--panel-hover)"
          aria-label={t("zoomOut")}
          title={t("zoomOut")}
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
      </div>
    </>
  );
}
