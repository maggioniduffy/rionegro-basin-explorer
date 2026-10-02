"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  Map as MapLibreMap,
  type MapMouseEvent,
  ScaleControl,
} from "maplibre-gl";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  MAP_MAXZOOM,
  MASK_LEVEL_COUNT,
  mapConfig,
  toLngLatBounds,
} from "@/lib/map/config";
import { maskOpacities } from "@/lib/map/mask";
import { type Picked, toPicked } from "@/lib/map/picked";
import {
  BACKGROUND_LAYER_ID,
  buildStyle,
  DAM_LAYER_ID,
  DAM_WALL_LAYER_ID,
  ENDO_MASK_LAYER_IDS,
  endoMaskOpacities,
  FLOW_CLASSES,
  IGN_DETAIL_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
  IGN_LAKE_LINE_LAYER_ID,
  ignDetailFilter,
  IMAGERY_LAYER_ID,
  LAKE_HIT_LAYER_ID,
  LAKE_LAYER_ID,
  lakeFilter,
  MASK_LAYER_IDS,
  OUTLINE_LAYER_ID,
  REACH_LAYER_IDS,
  reachFilter,
  waterFilter,
  reachLayerId,
  SELECTED_LAYER_ID,
  selectionFilter,
  SUBBASIN_FILL_LAYER_ID,
  SUBBASIN_LINE_LAYER_ID,
  subbasinFillOpacity,
  subbasinFilter,
  basinOutlineOpacity,
  SUBBASIN_HIDE_LAYER_ID,
  hiddenSubbasinsFilter,
  subbasinLineOpacity,
  selectedOutlineFilter,
  SUBBASIN_SELECTED_LAYER_ID,
  THEME_COLORS,
} from "@/lib/map/style";
import { initMaplibre } from "@/lib/map/init";
import { setMainMap } from "@/lib/map/main-map";
import { SnapshotButton } from "./SnapshotButton";
import { SHEET_PEEK_PX, sheetHeights } from "@/lib/sheet";
import { useMapStore } from "@/lib/store";
import type { Selection } from "@/lib/url-state";

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

/**
 * Keep the initial basin view clear of the header and, on wide screens, the controls
 * panel; on phones, of the closed bottom sheet.
 */
function fitPadding() {
  const wide = window.innerWidth >= 768;
  return wide
    ? { top: 64, bottom: 32, right: 64, left: 312 }
    : { top: 64, bottom: 32 + SHEET_PEEK_PX, right: 64, left: 16 };
}

/**
 * Fitting to a selection also keeps clear of the info panel on the right; on phones,
 * of the bottom sheet, which a selection opens to half height.
 */
function selectionPadding() {
  const wide = window.innerWidth >= 768;
  if (wide) return { top: 80, bottom: 48, right: 400, left: 312 };
  const sheet = sheetHeights({
    viewport: window.innerHeight,
    top: 0,
    attribution: 0,
  }).half;
  return { top: 80, bottom: sheet + 16, right: 32, left: 32 };
}

/** Clicks within this many px of a line hit it; river lines are thin. */
const HIT_TOLERANCE_PX = 6;

/** What a click at a point finds: a river, reach or sub-basin, or a map feature. */
type Hit =
  | { type: "selection"; selection: Selection }
  | { type: "picked"; picked: Picked };

/**
 * What a click at a point finds. Dams first (small, drawn on top), then the reach under
 * it, preferring the largest river; then IGN streams and lakes; otherwise, in the
 * sub-basin view, the sub-basin; otherwise null.
 */
function hitAt(map: MapLibreMap, x: number, y: number): Hit | null {
  // Hidden land behaves like the empty map around the basin.
  if (
    map.queryRenderedFeatures([x, y], { layers: [SUBBASIN_HIDE_LAYER_ID] })
      .length > 0
  )
    return null;
  const dam = hitFeature(map, x, y, [DAM_LAYER_ID, DAM_WALL_LAYER_ID]);
  if (dam) return { type: "picked", picked: dam };
  const reach = hitReach(map, x, y);
  if (reach) return { type: "selection", selection: reach };
  const feature = hitFeature(map, x, y, [
    IGN_DETAIL_LAYER_ID,
    LAKE_HIT_LAYER_ID,
    IGN_LAKE_FILL_LAYER_ID,
  ]);
  if (feature) return { type: "picked", picked: feature };
  const subbasin = hitSubbasin(map, x, y);
  return subbasin ? { type: "selection", selection: subbasin } : null;
}

/** Layers drawn below the mask: a feature there can be rendered but covered by it. */
const BELOW_MASK_LAYER_IDS: string[] = [
  IGN_DETAIL_LAYER_ID,
  IGN_LAKE_FILL_LAYER_ID,
];

/**
 * Whether the mask covers a point (what the user sees, not what is merely under it): the
 * layers that draw the mask colour composite as 1 − Π(1 − opacity).
 */
function maskedAt(map: MapLibreMap, x: number, y: number): boolean {
  const s = useMapStore.getState();
  const layers = [
    ...maskOpacities(s.visibleLand, MASK_LEVEL_COUNT).map((opacity, k) => ({
      id: MASK_LAYER_IDS[k],
      opacity,
    })),
    ...endoMaskOpacities(s.visibleLand, s.hideEndorheic).map((opacity, k) => ({
      id: ENDO_MASK_LAYER_IDS[k],
      opacity,
    })),
  ].filter((l) => l.id !== undefined && l.opacity > 0);
  const found = new Set(
    map
      .queryRenderedFeatures([x, y], { layers: layers.map((l) => l.id!) })
      .map((f) => f.layer.id),
  );
  const clear = layers
    .filter((l) => found.has(l.id!))
    .reduce((a, l) => a * (1 - l.opacity), 1);
  return 1 - clear > 0.5;
}

/**
 * The first feature of `layers` (in that order) at a point. Lines and points get the
 * click tolerance; lakes need the point inside them.
 */
function hitFeature(
  map: MapLibreMap,
  x: number,
  y: number,
  layers: string[],
): Picked | null {
  const r = HIT_TOLERANCE_PX;
  for (const id of layers) {
    const area = id === LAKE_HIT_LAYER_ID || id === IGN_LAKE_FILL_LAYER_ID;
    const features = map.queryRenderedFeatures(
      area
        ? [x, y]
        : [
            [x - r, y - r],
            [x + r, y + r],
          ],
      { layers: [id] },
    );
    const feature = features[0];
    if (!feature) continue;
    if (BELOW_MASK_LAYER_IDS.includes(id) && maskedAt(map, x, y)) continue;
    const picked = toPicked(id, feature.properties);
    if (picked) return picked;
  }
  return null;
}

function hitSubbasin(map: MapLibreMap, x: number, y: number): Selection | null {
  if (useMapStore.getState().viewMode !== "subbasins") return null;
  const [feature] = map.queryRenderedFeatures([x, y], {
    layers: [SUBBASIN_FILL_LAYER_ID],
  });
  const id: unknown = feature?.properties.id;
  return typeof id === "string" && id ? { kind: "subbasin", id } : null;
}

function hitReach(map: MapLibreMap, x: number, y: number): Selection | null {
  const r = HIT_TOLERANCE_PX;
  const features = map.queryRenderedFeatures(
    [
      [x - r, y - r],
      [x + r, y + r],
    ],
    { layers: REACH_LAYER_IDS },
  );
  const best = features.reduce<(typeof features)[number] | undefined>(
    (a, f) =>
      !a || Number(f.properties.strahler) > Number(a.properties.strahler)
        ? f
        : a,
    undefined,
  );
  if (!best) return null;
  const river: unknown = best.properties.river;
  if (typeof river === "string" && river) return { kind: "river", id: river };
  const id = Number(best.id);
  return Number.isSafeInteger(id) && id > 0 ? { kind: "reach", id } : null;
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
  const layersChanged = !prev || s.layers !== prev.layers;
  if (endoChanged || layersChanged) {
    for (const c of FLOW_CLASSES)
      map.setFilter(reachLayerId(c), reachFilter(c, s.hideEndorheic, s.layers));
    for (const id of [
      LAKE_LAYER_ID,
      LAKE_HIT_LAYER_ID,
      IGN_LAKE_FILL_LAYER_ID,
      IGN_LAKE_LINE_LAYER_ID,
    ])
      map.setFilter(id, waterFilter(s.hideEndorheic, s.layers));
  }
  if (endoChanged) {
    for (const id of [DAM_LAYER_ID, DAM_WALL_LAYER_ID])
      map.setFilter(id, lakeFilter(s.hideEndorheic));
  }
  if (endoChanged || !prev || s.showIgnDetail !== prev.showIgnDetail) {
    map.setFilter(
      IGN_DETAIL_LAYER_ID,
      ignDetailFilter(s.showIgnDetail, s.hideEndorheic),
    );
  }
  if (endoChanged || !prev || s.isolatedIds !== prev.isolatedIds) {
    for (const id of [SUBBASIN_FILL_LAYER_ID, SUBBASIN_LINE_LAYER_ID])
      map.setFilter(id, subbasinFilter(s.hideEndorheic, s.isolatedIds));
    map.setPaintProperty(
      OUTLINE_LAYER_ID,
      "line-opacity",
      basinOutlineOpacity(s.isolatedIds),
    );
  }
  if (!prev || s.selection !== prev.selection) {
    map.setFilter(SELECTED_LAYER_ID, selectionFilter(s.selection));
    map.setFilter(
      SUBBASIN_SELECTED_LAYER_ID,
      selectedOutlineFilter(s.selection),
    );
  }
  if (!prev || s.isolatedIds !== prev.isolatedIds) {
    map.setFilter(SUBBASIN_HIDE_LAYER_ID, hiddenSubbasinsFilter(s.isolatedIds));
  }
  if (!prev || s.selection !== prev.selection || s.viewMode !== prev.viewMode) {
    map.setPaintProperty(
      SUBBASIN_FILL_LAYER_ID,
      "fill-opacity",
      subbasinFillOpacity(s.viewMode, s.selection),
    );
    for (const id of [SUBBASIN_LINE_LAYER_ID, SUBBASIN_SELECTED_LAYER_ID])
      map.setPaintProperty(id, "line-opacity", subbasinLineOpacity(s.viewMode));
  }
  if (!prev || s.theme !== prev.theme) {
    const { mask, outline, lake } = THEME_COLORS[s.theme];
    map.setPaintProperty(BACKGROUND_LAYER_ID, "background-color", mask);
    for (const id of [...MASK_LAYER_IDS, ...ENDO_MASK_LAYER_IDS])
      map.setPaintProperty(id, "fill-color", mask);
    map.setPaintProperty(OUTLINE_LAYER_ID, "line-color", outline);
    map.setPaintProperty(SUBBASIN_HIDE_LAYER_ID, "fill-color", mask);
    map.setPaintProperty(LAKE_LAYER_ID, "line-color", lake);
    map.setPaintProperty(IGN_LAKE_LINE_LAYER_ID, "line-color", lake);
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
            link("https://www.ign.gob.ar", t("attribution.ign")),
          ].join(" | "),
          theme: initial.theme,
          hideEndorheic: initial.hideEndorheic,
          visibleLand: initial.visibleLand,
          selection: initial.selection,
          viewMode: initial.viewMode,
          isolatedIds: initial.isolatedIds,
          showIgnDetail: initial.showIgnDetail,
          layers: initial.layers,
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
          "ScaleControl.Miles": t("maplibre.miles"),
          "ScaleControl.Feet": t("maplibre.feet"),
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
    // Bottom left, under the map controls: the right column reaches down to the
    // attribution, as the controls do.
    // The scale bar follows the km/mi toggle.
    const scale = new ScaleControl({ unit: initial.units });
    map.addControl(scale, "bottom-left");
    mapRef.current = map;
    setMainMap(map);
    // Test hook for e2e and scripts/perf-zoom.ts; inlined at build time, so production
    // builds without NEXT_PUBLIC_E2E carry no reference to it.
    if (process.env.NEXT_PUBLIC_E2E === "1") window.__map = map;

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

    // Set on "load": until then the style's layers don't exist, and querying them
    // logs an error on every pointer move.
    let loaded = false;

    // Click a line to select its river (or the reach, if unnamed); in the sub-basin
    // view, click land to select its sub-basin; click elsewhere to clear. Hovering
    // something selectable shows a pointer.
    map.on("click", (e) => {
      if (!loaded) return;
      const hit = hitAt(map, e.point.x, e.point.y);
      const store = useMapStore.getState();
      if (hit?.type === "picked") store.pick(hit.picked);
      else store.select(hit?.selection ?? null);
    });
    const onHover = (e: MapMouseEvent) => {
      if (!loaded) return;
      map.getCanvas().style.cursor = hitAt(map, e.point.x, e.point.y)
        ? "pointer"
        : "";
    };
    map.on("mousemove", onHover);
    if (process.env.NEXT_PUBLIC_E2E === "1") window.__mapHover = onHover;

    const fitTo = (bbox: [number, number, number, number]) =>
      map.fitBounds(bbox, {
        padding: selectionPadding(),
        maxZoom: 11,
        duration: 800,
      });

    map.on("load", () => {
      loaded = true;
      const s = useMapStore.getState();
      applyState(map, s);
      if (s.focus) fitTo(s.focus.bbox);
    });
    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (!loaded) return;
      if (s.focus && s.focus !== prev.focus) fitTo(s.focus.bbox);
      if (s.units !== prev.units) scale.setUnit(s.units);
      // Only style state needs applying; other store fields don't touch the map.
      if (
        s.visibleLand === prev.visibleLand &&
        s.hideEndorheic === prev.hideEndorheic &&
        s.theme === prev.theme &&
        s.selection === prev.selection &&
        s.viewMode === prev.viewMode &&
        s.isolatedIds === prev.isolatedIds &&
        s.showIgnDetail === prev.showIgnDetail &&
        s.layers === prev.layers
      )
        return;
      setIdle(false);
      applyState(map, s, prev);
    });

    return () => {
      unsubscribe();
      if (process.env.NEXT_PUBLIC_E2E === "1") {
        delete window.__map;
        delete window.__mapHover;
      }
      setMainMap(null);
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
      <div className="absolute top-16 right-3 flex flex-col gap-2">
        <div className="flex flex-col overflow-hidden rounded-md border border-(--border) bg-(--panel) shadow">
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
        {/* Not in the clipped group above: its error message sits outside it. */}
        <div className="rounded-md border border-(--border) bg-(--panel) shadow">
          <SnapshotButton />
        </div>
      </div>
    </>
  );
}
