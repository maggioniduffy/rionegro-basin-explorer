"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useRegion } from "@/components/RegionProvider";
import { FLOW_SPEEDS } from "@/lib/flow/config";
import { peekFlowIndex, useFlowIndex } from "@/lib/flow/data";
import { findSection } from "@/lib/flow/pick";
import { parseSectionId } from "@/lib/flow/schema";
import { useMapStore } from "@/lib/store";
import { FlowLegend } from "./FlowLegend";
import { FlowZoomHint } from "./FlowZoomHint";

const BTN =
  "text-secondary hover:text-text flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-(--panel-hover) disabled:pointer-events-none disabled:opacity-40";

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  expanded,
  size = 18,
}: {
  icon: "play" | "pause" | "upstream" | "downstream" | "close" | "chevron";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      className={BTN}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Play/pause for the section on screen. */
function PlayButton() {
  const t = useTranslations("flow.controls");
  const playing = useMapStore((s) => s.flowPlaying);
  const setPlaying = useMapStore((s) => s.setFlowPlaying);
  return (
    <IconButton
      icon={playing ? "pause" : "play"}
      label={playing ? t("pause") : t("play")}
      onClick={() => setPlaying(!playing)}
    />
  );
}

/** The ids of the neighbouring sections up and down the river that can be shown. */
function useNeighbours() {
  const region = useRegion();
  const id = useMapStore((s) => s.flowSection);
  const index = useFlowIndex() ?? peekFlowIndex(region) ?? null;
  if (!id) return { prev: null, next: null };
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
  return { prev: neighbour(-1), next: neighbour(1) };
}

/**
 * Icon row shared by the desktop panel and the phone bar: play/pause, speed, upstream and
 * downstream, optionally exit; the speed legend sits below it.
 */
export function FlowControlBar({
  exit,
  trailing,
}: {
  exit?: boolean;
  trailing?: React.ReactNode;
}) {
  const t = useTranslations("flow");
  const id = useMapStore((s) => s.flowSection);
  const speed = useMapStore((s) => s.flowSpeed);
  const setSpeed = useMapStore((s) => s.setFlowSpeed);
  const enterFlow = useMapStore((s) => s.enterFlow);
  const exitFlow = useMapStore((s) => s.exitFlow);
  const { prev, next } = useNeighbours();
  if (!id) return null;

  return (
    <section aria-label={t("controls.label")} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-center gap-0.5">
        <PlayButton />
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
              className={`not-first:border-line min-h-9 min-w-9 px-1.5 font-mono text-xs not-first:border-l ${
                speed === v
                  ? "bg-surface-active text-text font-semibold"
                  : "text-secondary hover:text-text hover:bg-(--panel-hover)"
              }`}
            >
              {t("controls.speedOption", { speed: v })}
            </button>
          ))}
        </div>
        <IconButton
          icon="upstream"
          label={t("controls.upstream")}
          disabled={!prev}
          onClick={() => prev && enterFlow(prev, { fit: true })}
        />
        <IconButton
          icon="downstream"
          label={t("controls.downstream")}
          disabled={!next}
          onClick={() => next && enterFlow(next, { fit: true })}
        />
        {exit && (
          <IconButton
            icon="close"
            label={t("controls.exit")}
            onClick={exitFlow}
          />
        )}
        {trailing}
      </div>
      <FlowLegend />
    </section>
  );
}

/**
 * Phones only: floating bar at the top, clear of the bottom sheet, with the zoom-out hint
 * above it. It collapses to a pill with play/pause and an expand button. On desktop the
 * same bar lives in the flow panel.
 */
export function FlowControls() {
  const t = useTranslations("flow.controls");
  const id = useMapStore((s) => s.flowSection);
  const [open, setOpen] = useState(true);
  if (!id) return null;

  return (
    <div className="pointer-events-none absolute top-(--panel-top) left-1/2 z-10 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col items-stretch gap-2">
      <FlowZoomHint />
      <div className="border-line bg-panel-glass shadow-card pointer-events-auto self-center rounded-[10px] border p-1.5 backdrop-blur-[6px]">
        {open ? (
          <FlowControlBar
            exit
            trailing={
              <button
                type="button"
                aria-expanded
                aria-label={t("hide")}
                title={t("hide")}
                onClick={() => setOpen(false)}
                className={BTN}
              >
                <Icon name="chevron" size={18} className="-rotate-90" />
              </button>
            }
          />
        ) : (
          <div className="flex items-center gap-0.5">
            <PlayButton />
            <button
              type="button"
              aria-expanded={false}
              aria-label={t("show")}
              title={t("show")}
              onClick={() => setOpen(true)}
              className={`${BTN} w-auto gap-0.5 px-2`}
            >
              <Icon name="river" size={18} />
              <Icon name="chevron" size={14} className="rotate-90" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
