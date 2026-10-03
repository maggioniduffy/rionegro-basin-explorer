"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { onMainMap } from "@/lib/map/main-map";
import {
  atLeastHalf,
  nearestSnap,
  type SheetSnap,
  sheetHeights,
} from "@/lib/sheet";
import { useMapStore } from "@/lib/store";
import { MapControlsContent } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { DisplayOptionsContent } from "./OptionsPanel";
import { InfoPanel } from "./panel/InfoPanel";
import { PanelVariant } from "./panel/parts";

const TABS = ["map", "info", "display"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICON: Record<Tab, IconName> = {
  map: "layers",
  info: "info",
  display: "units",
};

/** Below this many px of movement, a press on the handle is a tap, not a drag. */
const TAP_PX = 5;

/** Resting heights for the current window, header and attribution. */
function useHeights() {
  const [heights, setHeights] = useState(() => measure(0));
  useEffect(() => {
    let attribution = 0;
    const update = () => setHeights(measure(attribution));
    const observer = new ResizeObserver((entries) => {
      attribution = entries[0]?.contentRect.height ?? 0;
      update();
    });
    const stop = onMainMap((map) => {
      observer.disconnect();
      const el = map
        ?.getContainer()
        .querySelector(".maplibregl-ctrl-bottom-right");
      if (el) observer.observe(el);
    });
    window.addEventListener("resize", update);
    update();
    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return heights;
}

function measure(attribution: number) {
  const header = document.querySelector("header");
  return sheetHeights({
    viewport: window.innerHeight,
    top: header?.getBoundingClientRect().bottom ?? 0,
    attribution,
  });
}

/**
 * Phones: one sheet along the bottom with the map controls, the details of the
 * selection and the display options as tabs. It rests at peek, half or full height;
 * drag or tap the handle to change it. Selecting something opens its details.
 */
export function MobileSheet() {
  const t = useTranslations("sheet");
  const [tab, setTab] = useState<Tab>("map");
  const [snap, setSnap] = useState<SheetSnap>("peek");
  /** Live height while the handle is dragged. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const heights = useHeights();
  const hasDetails = useMapStore((s) => Boolean(s.selection ?? s.picked));
  const height = dragHeight ?? heights[snap];

  // A new selection or clicked feature opens the details tab.
  useEffect(
    () =>
      useMapStore.subscribe((s, prev) => {
        const opened =
          (s.selection && s.selection !== prev.selection) ||
          (s.picked && s.picked !== prev.picked);
        if (!opened) return;
        setTab("info");
        setSnap(atLeastHalf);
      }),
    [],
  );

  // Map controls at the bottom (attribution, scale bar) ride above the sheet.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sheet-height", `${height}px`);
  }, [height]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--sheet-height");
    },
    [],
  );

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > TAP_PX) d.moved = true;
    if (!d.moved) return;
    setDragHeight(Math.min(heights.full, Math.max(heights.peek, d.h + dy)));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || dragHeight === null) return;
    setSnap(nearestSnap(dragHeight, heights));
    setDragHeight(null);
  }
  function onHandleClick() {
    // The click that ends a drag is not a tap.
    if (dragHeight !== null) return;
    setSnap((s) => (s === "peek" ? "half" : "peek"));
  }

  function chooseTab(next: Tab) {
    setTab(next);
    setSnap(atLeastHalf);
  }

  // Tabs pattern (WAI-ARIA): one tab stop; arrows, Home and End move between tabs.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    chooseTab(next);
    document.getElementById(`sheet-tab-${next}`)?.focus();
  }

  const expanded = snap !== "peek";

  return (
    <section
      aria-label={t("label")}
      data-testid="mobile-sheet"
      style={{ height }}
      className={`fixed inset-x-0 bottom-0 flex flex-col rounded-t-xl border-t border-(--border) bg-(--panel) text-sm shadow-[0_-4px_16px_rgba(0,0,0,0.25)] backdrop-blur ${
        dragHeight === null ? "transition-[height] duration-200" : ""
      }`}
    >
      <button
        type="button"
        aria-label={expanded ? t("collapse") : t("expand")}
        aria-expanded={expanded}
        aria-controls="sheet-body"
        title={expanded ? t("collapse") : t("expand")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onHandleClick}
        className="flex h-6 shrink-0 touch-none items-center justify-center"
      >
        <span className="h-1 w-10 rounded-full bg-(--muted)" />
      </button>

      <div
        role="tablist"
        aria-label={t("label")}
        className="flex shrink-0 gap-1 border-b border-(--border) px-3 pb-2"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`sheet-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="sheet-body"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => chooseTab(id)}
            onKeyDown={onTabKeyDown}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 ${
              tab === id
                ? "bg-(--panel-hover) font-medium"
                : "text-muted hover:bg-(--panel-hover)"
            }`}
          >
            <Icon name={TAB_ICON[id]} />
            {t(`tabs.${id}`)}
            {id === "info" && hasDetails && tab !== "info" && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-sky-400"
              />
            )}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted (hidden), so inputs and the sub-basin tree keep their
          state across tabs. */}
      <div
        id="sheet-body"
        role="tabpanel"
        aria-labelledby={`sheet-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4"
      >
        <div hidden={tab !== "map"} className="flex flex-col gap-4">
          <MapControlsContent />
        </div>
        <div hidden={tab !== "info"}>
          {hasDetails ? (
            <PanelVariant.Provider value="sheet">
              <InfoPanel />
            </PanelVariant.Provider>
          ) : (
            <p className="text-muted">{t("empty")}</p>
          )}
        </div>
        <div hidden={tab !== "display"} className="flex flex-col gap-4">
          {/* No minimap on phones: the map itself is the overview there. */}
          <DisplayOptionsContent minimap={false} />
        </div>
      </div>
    </section>
  );
}
