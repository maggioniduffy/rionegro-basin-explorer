"use client";

import { useEffect } from "react";
import { useRegion } from "@/components/RegionProvider";
import { flowPaths } from "@/lib/flow/data";
import { openedWithCameraHash } from "@/lib/map/camera-hash";
import { useMapStore } from "@/lib/store";
import {
  flowSearch,
  parseFlow,
  parseSelection,
  sameSelection,
  selectionSearch,
} from "@/lib/url-state";

/**
 * Keeps ?r= / ?reach= (and ?flow= / ?fs=) and the store in step. On load (and on back/forward)
 * the URL wins and the map fits to the selection or the flow section; afterwards the store
 * writes the URL. replaceState is integrated with the Next.js router, so a locale refresh keeps it.
 * A region with no flow data ignores ?flow= and drops it on the next write.
 */
export function UrlSync() {
  const region = useRegion();
  useEffect(() => {
    const hasFlow = flowPaths(region) !== null;
    // A camera in the URL hash wins over the first selection / flow fit (later ones fit as usual).
    let skipFit = openedWithCameraHash();
    const fromUrl = () => {
      const fit = !skipFit;
      skipFit = false;
      const params = new URLSearchParams(window.location.search);
      const selection = parseSelection(params);
      const store = useMapStore.getState();
      if (!sameSelection(selection, store.selection))
        store.select(selection, { fit });
      // A region without flow data never keeps a section, not even one left in the store
      // by a soft navigation from another region.
      if (!hasFlow) {
        if (store.flowSection) store.exitFlow();
        return;
      }
      const flow = parseFlow(params);
      if (flow.section !== store.flowSection) {
        if (flow.section) store.enterFlow(flow.section, { fit });
        else store.exitFlow();
      }
      if (flow.section && flow.speed !== store.flowSpeed)
        store.setFlowSpeed(flow.speed);
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);

    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (
        sameSelection(s.selection, prev.selection) &&
        s.flowSection === prev.flowSection &&
        s.flowSpeed === prev.flowSpeed
      )
        return;
      const { pathname, search, hash } = window.location;
      const withSelection = selectionSearch(
        new URLSearchParams(search),
        s.selection,
      );
      const next = flowSearch(new URLSearchParams(withSelection), {
        section: s.flowSection,
        speed: s.flowSpeed,
      });
      if (next !== search) {
        window.history.replaceState(null, "", `${pathname}${next}${hash}`);
      }
    });
    return () => {
      window.removeEventListener("popstate", fromUrl);
      unsubscribe();
    };
  }, [region]);

  return null;
}
