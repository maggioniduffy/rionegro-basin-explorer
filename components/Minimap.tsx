"use client";

import { type GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { mapConfig, toLngLatBounds } from "@/lib/map/config";
import { initMaplibre } from "@/lib/map/init";
import { onMainMap } from "@/lib/map/main-map";
import {
  buildMinimapStyle,
  MINIMAP_BACKGROUND_LAYER_ID,
  MINIMAP_PADDING,
  MINIMAP_OUTLINE_LAYER_ID,
  MINIMAP_VIEW_SOURCE,
  minimapCamera,
  viewPolygon,
} from "@/lib/map/minimap";
import { THEME_COLORS } from "@/lib/map/style";
import { MINIMAP_STORAGE_KEY, useMapStore } from "@/lib/store";
import { Toggle } from "./LayerToggles";

/** The overview map with its show/hide toggle, remembered in localStorage. */
export function MinimapSection() {
  const t = useTranslations("options.minimap");
  const show = useMapStore((s) => s.showMinimap);
  const setShow = useMapStore((s) => s.setShowMinimap);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MINIMAP_STORAGE_KEY);
      if (saved === "true" || saved === "false") setShow(saved === "true");
    } catch {
      // Storage blocked (private mode): shown for this page.
    }
  }, [setShow]);

  function toggle(next: boolean) {
    setShow(next);
    try {
      localStorage.setItem(MINIMAP_STORAGE_KEY, String(next));
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Toggle checked={show} onChange={toggle}>
        {t("show")}
      </Toggle>
      {show && <Minimap />}
    </div>
  );
}

/**
 * Overview of the basin with a box for the main map's view; it zooms in to follow the
 * view when the main map is close in (minimapCamera). Click or drag on it to move the
 * main map there. Pointer only: the main map has its own keyboard controls.
 */
function Minimap() {
  const t = useTranslations("options.minimap");
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    initMaplibre();
    let mini: MapLibreMap;
    try {
      mini = new MapLibreMap({
        container: el,
        style: buildMinimapStyle({
          origin: window.location.origin,
          theme: useMapStore.getState().theme,
        }),
        bounds: toLngLatBounds(mapConfig.basinBbox),
        fitBoundsOptions: { padding: MINIMAP_PADDING },
        interactive: false,
        attributionControl: false,
        renderWorldCopies: false,
      });
    } catch (err) {
      // No WebGL: MapView already explains it; the minimap just stays empty.
      console.error(err);
      return;
    }
    mini.getCanvas().setAttribute("aria-hidden", "true");

    const { xmin, ymin, xmax, ymax } = mapConfig.basinBbox;
    let main: MapLibreMap | null = null;
    // While the pointer drags the view, the minimap holds still under it.
    let dragging = false;
    const showView = () => {
      const b = main?.getBounds();
      const view: [number, number, number, number] | null = b
        ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        : null;
      void mini
        .getSource<GeoJSONSource>(MINIMAP_VIEW_SOURCE)
        ?.setData(viewPolygon(view));
      const canvas = mini.getCanvas();
      if (!view || dragging || !canvas.clientWidth || !canvas.clientHeight)
        return;
      mini.jumpTo(
        minimapCamera({
          view,
          basin: [xmin, ymin, xmax, ymax],
          size: [canvas.clientWidth, canvas.clientHeight],
        }),
      );
    };
    mini.on("load", showView);
    mini.on("resize", showView);
    const stopMain = onMainMap((m) => {
      main?.off("move", showView);
      main = m;
      main?.on("move", showView);
      if (mini.loaded()) showView();
    });

    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (s.theme === prev.theme || !mini.loaded()) return;
      const { mask, outline } = THEME_COLORS[s.theme];
      mini.setPaintProperty(
        MINIMAP_BACKGROUND_LAYER_ID,
        "background-color",
        mask,
      );
      mini.setPaintProperty(MINIMAP_OUTLINE_LAYER_ID, "line-color", outline);
    });

    // Click or drag: centre the main map on the pointer.
    const panTo = (e: PointerEvent) => {
      if (!main) return;
      const r = el.getBoundingClientRect();
      main.jumpTo({
        center: mini.unproject([e.clientX - r.left, e.clientY - r.top]),
      });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      el.setPointerCapture(e.pointerId);
      panTo(e);
    };
    const move = (e: PointerEvent) => {
      if (dragging) panTo(e);
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      showView();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      unsubscribe();
      stopMain();
      main?.off("move", showView);
      mini.remove();
    };
  }, []);

  return (
    // MapLibre's CSS sets position: relative on its container and beats Tailwind's
    // `absolute` (unlayered vs layered), leaving it 0 high: size it with h-full w-full.
    <div className="h-44 shrink-0 overflow-hidden rounded-md border border-(--border)">
      <div
        ref={container}
        role="img"
        aria-label={t("label")}
        title={t("hint")}
        className="h-full w-full cursor-crosshair touch-none"
        data-testid="minimap"
      />
    </div>
  );
}
