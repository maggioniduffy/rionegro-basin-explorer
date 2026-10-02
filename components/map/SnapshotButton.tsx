"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { getMainMap } from "@/lib/map/main-map";
import { renderSnapshot, snapshotFileName } from "@/lib/map/snapshot";
import { THEME_COLORS } from "@/lib/map/style";
import { useMapStore } from "@/lib/store";

const TEXT_COLOR = { dark: "#e6e8ea", light: "#1f2328" } as const;

/** Saves the current view as a PNG, attribution included. */
export function SnapshotButton() {
  const t = useTranslations("map");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    const map = getMainMap();
    if (!map || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const theme = useMapStore.getState().theme;
      // The credits exactly as the map shows them, links flattened to their text.
      const attribution =
        map
          .getContainer()
          .querySelector(".maplibregl-ctrl-attrib-inner")
          ?.textContent?.trim() ?? "";
      const blob = await renderSnapshot(map, {
        attribution,
        background: THEME_COLORS[theme].mask,
        foreground: TEXT_COLOR[theme],
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = snapshotFileName(new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      // e.g. imagery served without CORS headers taints the canvas.
      console.error(err);
      setFailed(true);
      setTimeout(() => setFailed(false), 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-(--panel-hover) disabled:opacity-50"
        aria-label={t("snapshot")}
        title={t("snapshot")}
        disabled={busy}
        onClick={() => void save()}
      >
        <Icon name="snapshot" />
      </button>
      {/* Always rendered, so screen readers announce the message when it appears. */}
      <p
        role="status"
        className={`absolute top-1 right-full mr-2 rounded-md border border-(--border) bg-(--panel) px-2 py-1 text-xs whitespace-nowrap shadow ${failed ? "" : "sr-only"}`}
      >
        {failed ? t("snapshotError") : ""}
      </p>
    </div>
  );
}
