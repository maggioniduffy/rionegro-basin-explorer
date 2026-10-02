"use client";

import { useMapStore } from "@/lib/store";
import { OptionsPanel } from "./OptionsPanel";
import { InfoPanel } from "./panel/InfoPanel";

/**
 * The right column: the info panel at the top (shared `--panel-top` edge with the
 * map controls) and the display options at the bottom. While the options are open,
 * each panel takes at most half the column and scrolls on its own (`data-split`).
 */
export function RightColumn() {
  const optionsOpen = useMapStore((s) => s.optionsOpen);

  return (
    <div
      data-split={optionsOpen}
      className="group pointer-events-none absolute top-(--panel-top) right-14 bottom-20 left-3 flex flex-col gap-3 md:left-auto md:w-88"
    >
      <InfoPanel />
      <OptionsPanel />
    </div>
  );
}
