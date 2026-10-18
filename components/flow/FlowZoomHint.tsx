"use client";

import { useTranslations } from "next-intl";
import { useMapStore } from "@/lib/store";

/** Shown when the map is zoomed out past the point where the particles fade out. */
export function FlowZoomHint() {
  const t = useTranslations("flow");
  const id = useMapStore((s) => s.flowSection);
  const zoomedOut = useMapStore((s) => s.flowZoomedOut);
  const enterFlow = useMapStore((s) => s.enterFlow);
  if (!id || !zoomedOut) return null;
  return (
    <div
      role="status"
      className="border-line bg-panel-glass shadow-card pointer-events-auto flex items-center gap-3 rounded-[10px] border px-3 py-2 text-sm backdrop-blur-[6px]"
    >
      <span>{t("zoomHint")}</span>
      <button
        type="button"
        onClick={() => enterFlow(id, { fit: true })}
        className="bg-surface-active text-text min-h-9 rounded-lg px-3 font-semibold hover:bg-(--panel-hover)"
      >
        {t("zoomBack")}
      </button>
    </div>
  );
}
