"use client";

import { useEffect } from "react";
import { useRegion } from "@/components/RegionProvider";
import { hasEffluent, netReachIds } from "@/lib/effluent/overlay";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useMapStore } from "@/lib/store";
import { effluentSearch, parseEffluent, sameEffluent } from "@/lib/url-state";

/**
 * Keeps ?ef= and the store in step on the analysis page; no other parameter is touched. On load
 * (and on back/forward) the URL wins over whatever a soft navigation from the map left in the
 * store; afterwards the store writes the URL. With no usable ?ef= (absent, or a reach outside the
 * net) the page opens on the first configured outfall with its defaults, and writes it.
 */
export function EffluentUrlSync() {
  const region = useRegion();
  useEffect(() => {
    const net = netReachIds(region);
    const write = (next: string) => {
      const { pathname, search, hash } = window.location;
      if (next !== search)
        window.history.replaceState(null, "", `${pathname}${next}${hash}`);
    };
    const fromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const parsed = hasEffluent(region) ? parseEffluent(params) : null;
      let effluent = parsed && net?.has(parsed.reach) ? parsed : null;
      const first = getEffluentRegion(region)?.config.outfalls[0];
      if (!effluent && first && net?.has(first.reach))
        effluent = { reach: first.reach, overrides: {} };
      const store = useMapStore.getState();
      if (!effluent) {
        if (store.effluent) store.exitEffluent();
        return;
      }
      if (!sameEffluent(effluent, store.effluent))
        store.enterEffluent(effluent.reach, { overrides: effluent.overrides });
      write(effluentSearch(params, effluent));
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);

    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (sameEffluent(s.effluent, prev.effluent)) return;
      write(
        effluentSearch(new URLSearchParams(window.location.search), s.effluent),
      );
    });
    return () => {
      window.removeEventListener("popstate", fromUrl);
      unsubscribe();
    };
  }, [region]);

  return null;
}
