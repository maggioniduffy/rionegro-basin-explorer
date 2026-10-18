"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useRegion } from "@/components/RegionProvider";
import { FLOW_MAXZOOM, FLOW_MIN_ZOOM } from "@/lib/flow/config";
import {
  flowPaths,
  loadFlowIndex,
  loadSection,
  peekSection,
} from "@/lib/flow/data";
import { buildTrack, lngLatToMercator, type Track } from "@/lib/flow/geometry";
import {
  createFlowLayer,
  FLOW_BEFORE_ID,
  FLOW_LAYER_ID,
} from "@/lib/flow/layer";
import { distanceToTrackM, findSection } from "@/lib/flow/pick";
import type { FlowSection } from "@/lib/flow/schema";
import { MAP_MAXZOOM } from "@/lib/map/config";
import { useMapStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** Same padding the selection fits use: clear of the left controls and the right panel. */
export type FlowFitPadding = () => {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Owns the flow layer's life on the main map: adds it once the style has loaded, keeps it in
 * step with the store (section, playing, speed), fits the camera on entering, restores the max
 * zoom on exit, and switches to the adjacent section when the view is panned onto it.
 * Renders nothing. A region with no flow data attaches nothing.
 */
export function FlowController({
  map,
  padding,
}: {
  map: MapLibreMap | null;
  padding: FlowFitPadding;
}) {
  const region = useRegion();
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  const paddingRef = useRef(padding);
  useEffect(() => {
    reducedRef.current = reduced;
    paddingRef.current = padding;
  });

  useEffect(() => {
    if (!map || !flowPaths(region)) return;
    const { layer, controller } = createFlowLayer();
    map.addLayer(layer, FLOW_BEFORE_ID);

    let current: FlowSection | null = null;
    // Latest request wins; a slow load of an earlier section is dropped.
    let token = 0;
    let fitting = false;
    const tracks = new Map<string, Track>();
    const trackOf = (section: FlowSection) => {
      let t = tracks.get(section.id);
      if (!t) {
        t = buildTrack(section);
        tracks.set(section.id, t);
      }
      return t;
    };

    const show = async (id: string | null) => {
      const mine = ++token;
      if (!id) {
        current = null;
        controller.setSection(null);
        map.setMaxZoom(MAP_MAXZOOM);
        return;
      }
      map.setMaxZoom(FLOW_MAXZOOM);
      const index = await loadFlowIndex(region);
      if (mine !== token) return;
      // An id the index doesn't know, or one that can't be shown, is dropped (URL included).
      if (!index || !findSection(index, id)?.section.flowable) {
        useMapStore.getState().exitFlow();
        return;
      }
      const section = await loadSection(region, id);
      if (mine !== token) return;
      if (!section || !section.flowable) {
        useMapStore.getState().exitFlow();
        return;
      }
      current = section;
      controller.setSection(section);
      const store = useMapStore.getState();
      if (store.flowFitPending) {
        useMapStore.setState({ flowFitPending: false });
        fitting = true;
        map.fitBounds(section.bbox, {
          padding: paddingRef.current(),
          maxZoom: FLOW_MAXZOOM,
          duration: 800,
        });
      }
      // The neighbours are what a pan can switch to; have them ready.
      for (const n of [section.prev, section.next])
        if (n) void loadSection(region, n);
    };

    const onMoveEnd = () => {
      if (fitting) {
        fitting = false;
        return;
      }
      if (!current || map.getZoom() < FLOW_MIN_ZOOM) return;
      const c = map.getCenter();
      const [mx, my] = lngLatToMercator(c.lng, c.lat);
      const distance = (section: FlowSection) => {
        const track = trackOf(section);
        return distanceToTrackM(track, mx - track.originX, my - track.originY);
      };
      let best: FlowSection = current;
      let bestD = distance(current);
      for (const n of [current.prev, current.next]) {
        const other = n ? peekSection(region, n) : undefined;
        if (!other?.flowable) continue;
        const d = distance(other);
        if (d < bestD) {
          best = other;
          bestD = d;
        }
      }
      if (best !== current)
        useMapStore.getState().enterFlow(best.id, { fit: false });
    };
    map.on("moveend", onMoveEnd);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (useMapStore.getState().flowSection) useMapStore.getState().exitFlow();
    };
    window.addEventListener("keydown", onKey);

    const enter = () => {
      const s = useMapStore.getState();
      // Reduced motion starts paused; the user can still play.
      useMapStore.getState().setFlowPlaying(!reducedRef.current);
      controller.setPlaying(!reducedRef.current);
      void show(s.flowSection);
    };
    // The URL may have set the section before the map existed.
    controller.setSpeed(useMapStore.getState().flowSpeed);
    if (useMapStore.getState().flowSection) enter();

    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (s.flowSpeed !== prev.flowSpeed) controller.setSpeed(s.flowSpeed);
      if (s.flowPlaying !== prev.flowPlaying)
        controller.setPlaying(s.flowPlaying);
      if (s.flowSection === prev.flowSection) return;
      if (!prev.flowSection && s.flowSection) enter();
      else void show(s.flowSection);
      // Nothing to animate once out: the layer would keep asking for repaints.
      if (!s.flowSection) useMapStore.getState().setFlowPlaying(false);
    });

    return () => {
      token++;
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      map.off("moveend", onMoveEnd);
      try {
        if (map.getLayer(FLOW_LAYER_ID)) map.removeLayer(FLOW_LAYER_ID);
        map.setMaxZoom(MAP_MAXZOOM);
      } catch {
        // The map was already removed.
      }
    };
  }, [map, region]);

  return null;
}
