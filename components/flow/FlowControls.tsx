"use client";

import { useTranslations } from "next-intl";
import { useRegion } from "@/components/RegionProvider";
import { FLOW_SPEEDS } from "@/lib/flow/config";
import { peekFlowIndex, useFlowIndex } from "@/lib/flow/data";
import { findSection } from "@/lib/flow/pick";
import { parseSectionId } from "@/lib/flow/schema";
import { useMapStore } from "@/lib/store";
import { FlowLegend } from "./FlowLegend";
import { FlowZoomHint } from "./FlowZoomHint";

const BTN =
  "text-secondary hover:text-text min-h-9 rounded-lg px-2.5 hover:bg-(--panel-hover) disabled:pointer-events-none disabled:opacity-40";

/**
 * Floating bar in flow mode: play/pause, speed, upstream/downstream, exit, the speed legend,
 * and the zoom-out hint above it. Bottom centre on desktop; at the top on phones, clear of the
 * bottom sheet.
 */
export function FlowControls() {
  const t = useTranslations("flow");
  const region = useRegion();
  const id = useMapStore((s) => s.flowSection);
  const playing = useMapStore((s) => s.flowPlaying);
  const speed = useMapStore((s) => s.flowSpeed);
  const setPlaying = useMapStore((s) => s.setFlowPlaying);
  const setSpeed = useMapStore((s) => s.setFlowSpeed);
  const enterFlow = useMapStore((s) => s.enterFlow);
  const exitFlow = useMapStore((s) => s.exitFlow);
  const index = useFlowIndex() ?? peekFlowIndex(region) ?? null;
  if (!id) return null;

  // prev/next come from the index entry's river: sections of one river are consecutive.
  const river = parseSectionId(id);
  const sections =
    index?.rivers.find((r) => r.slug === river?.river)?.sections ?? [];
  const neighbour = (delta: -1 | 1) => {
    const target = sections.find(
      (s) => s.index === (river?.index ?? 0) + delta,
    );
    return target && findSection(index!, target.id)?.section.flowable
      ? target.id
      : null;
  };
  const prev = neighbour(-1);
  const next = neighbour(1);

  return (
    <div className="pointer-events-none absolute top-(--panel-top) left-1/2 z-10 flex w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col items-stretch gap-2 md:top-auto md:bottom-(--panel-bottom)">
      <FlowZoomHint />
      <section
        aria-label={t("controls.label")}
        className="border-line bg-panel-glass shadow-card pointer-events-auto flex flex-col gap-2 rounded-[10px] border p-2 text-sm backdrop-blur-[6px]"
      >
        <div className="flex flex-wrap items-center justify-center gap-1">
          <button
            type="button"
            aria-pressed={playing}
            onClick={() => setPlaying(!playing)}
            className={`${BTN} font-medium`}
          >
            {playing ? t("controls.pause") : t("controls.play")}
          </button>
          <div
            role="group"
            aria-label={t("controls.speed")}
            className="border-line flex overflow-hidden rounded-lg border"
          >
            {FLOW_SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={speed === v}
                onClick={() => setSpeed(v)}
                className={`not-first:border-line min-h-9 px-2.5 font-mono not-first:border-l ${
                  speed === v
                    ? "bg-surface-active text-text font-semibold"
                    : "text-secondary hover:text-text hover:bg-(--panel-hover)"
                }`}
              >
                {t("controls.speedOption", { speed: v })}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && enterFlow(prev, { fit: true })}
            className={BTN}
          >
            {t("controls.upstream")}
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && enterFlow(next, { fit: true })}
            className={BTN}
          >
            {t("controls.downstream")}
          </button>
          <button type="button" onClick={exitFlow} className={BTN}>
            {t("controls.exit")}
          </button>
        </div>
        <FlowLegend />
      </section>
    </div>
  );
}
