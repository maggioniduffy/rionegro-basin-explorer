"use client";

import { useEffect } from "react";
import { useMapStore } from "@/lib/store";
import {
  parseSelection,
  sameSelection,
  selectionSearch,
} from "@/lib/url-state";

/**
 * Keeps ?r= / ?reach= and the store's selection in step. On load (and on back/forward)
 * the URL wins and the map fits to the selection; afterwards selections write the URL.
 * replaceState is integrated with the Next.js router, so a locale refresh keeps it.
 */
export function UrlSync() {
  useEffect(() => {
    const fromUrl = () => {
      const selection = parseSelection(
        new URLSearchParams(window.location.search),
      );
      const { selection: current, select } = useMapStore.getState();
      if (!sameSelection(selection, current)) select(selection, { fit: true });
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);

    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (sameSelection(s.selection, prev.selection)) return;
      const { pathname, search, hash } = window.location;
      const next = selectionSearch(new URLSearchParams(search), s.selection);
      if (next !== search) {
        window.history.replaceState(null, "", `${pathname}${next}${hash}`);
      }
    });
    return () => {
      window.removeEventListener("popstate", fromUrl);
      unsubscribe();
    };
  }, []);

  return null;
}
