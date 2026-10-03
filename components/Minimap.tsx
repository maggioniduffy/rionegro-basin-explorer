"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { MINIMAP_STORAGE_KEY, useMapStore } from "@/lib/store";
import { Toggle } from "./LayerToggles";

// Loaded on demand, like the main map, so MapLibre stays out of the first page load.
const Minimap = dynamic(() => import("./map/MinimapMap"), { ssr: false });

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
