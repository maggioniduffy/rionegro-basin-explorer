"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { niceTicks } from "@/components/effluent/charts/ProfileChart";

export interface FlowDay {
  /** Tick and readout label (a date). */
  label: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

interface Props {
  title: string;
  desc: string;
  /** Today's modelled value, plotted before the first forecast day; null = no value. */
  today: { label: string; value: number | null } | null;
  days: FlowDay[];
  mean: { value: number; label: string };
  bandLabel: string;
  yLabel: string;
  formatValue: (v: number) => string;
  formatTick: (v: number) => string;
}

const HEIGHT = 240;
const M = { left: 56, right: 10, top: 14, bottom: 34 };
const BAND_FILL = "color-mix(in srgb, var(--accent) 18%, transparent)";

/** Runs of consecutive indices where `ok` holds, so a missing day breaks the line instead of bridging it. */
function runs(n: number, ok: (i: number) => boolean): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue;
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else out.push([i]);
  }
  return out;
}

/**
 * A dependency-free SVG chart of a gauge's forecast: the median with its p25–p75 band over the
 * days, the climatology mean as a dashed line and today as a marker. Shares the axis ticks of
 * ProfileChart; the x axis is the day, today first.
 */
export function FlowChart({
  title,
  desc,
  today,
  days,
  mean,
  bandLabel,
  yLabel,
  formatValue,
  formatTick,
}: Props) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.max(240, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plot = { w: width - M.left - M.right, h: HEIGHT - M.top - M.bottom };
  // Slot 0 is today, slot i the i-th forecast day.
  const slots = days.length + 1;
  const geo = useMemo(() => {
    const values = [
      mean.value,
      ...(today?.value != null ? [today.value] : []),
      ...days.flatMap((d) => [d.median, d.p25, d.p75]),
    ].filter((v): v is number => v !== null);
    const top = Math.max(...values, 1e-9);
    const ticks = niceTicks(0, top * 1.06);
    const hi = Math.max(top * 1.06, ticks[ticks.length - 1] ?? 0);
    return {
      ticks,
      yOf: (v: number) =>
        M.top + plot.h * (1 - Math.min(1, Math.max(0, v / hi))),
      xOf: (slot: number) =>
        M.left + (slots > 1 ? (slot / (slots - 1)) * plot.w : plot.w / 2),
    };
  }, [mean.value, today, days, slots, plot.w, plot.h]);
  const { yOf, xOf, ticks } = geo;

  const pathOf = (pts: { x: number; y: number }[]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join("");
  const medianPaths = runs(days.length, (i) => days[i]!.median !== null).map(
    (r) => pathOf(r.map((i) => ({ x: xOf(i + 1), y: yOf(days[i]!.median!) }))),
  );
  const bandPaths = runs(
    days.length,
    (i) => days[i]!.p25 !== null && days[i]!.p75 !== null,
  ).map((r) => {
    const up = r.map((i) => ({ x: xOf(i + 1), y: yOf(days[i]!.p75!) }));
    const down = [...r]
      .reverse()
      .map((i) => ({ x: xOf(i + 1), y: yOf(days[i]!.p25!) }));
    return pathOf(up) + pathOf(down).replace("M", "L") + "Z";
  });

  // Label about every `step`-th slot so the date labels never overlap.
  const step = Math.max(
    1,
    Math.ceil(slots / Math.max(2, Math.floor(plot.w / 70))),
  );
  const labelOf = (slot: number) =>
    slot === 0 ? (today?.label ?? "") : (days[slot - 1]?.label ?? "");
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const x = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    for (let s = 1; s < slots; s++)
      if (Math.abs(xOf(s) - x) < Math.abs(xOf(best) - x)) best = s;
    return best;
  };
  const shown =
    active === null
      ? null
      : active === 0
        ? today?.value != null
          ? `${today.label} · ${formatValue(today.value)}`
          : null
        : (() => {
            const d = days[active - 1];
            if (!d || d.median === null) return null;
            const range =
              d.p25 !== null && d.p75 !== null
                ? ` (${formatValue(d.p25)} – ${formatValue(d.p75)})`
                : "";
            return `${d.label} · ${formatValue(d.median)}${range}`;
          })();

  return (
    <div ref={ref} className="w-full min-w-0">
      <svg
        role="img"
        aria-labelledby={`${uid}t ${uid}d`}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="block overflow-visible"
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(null)}
      >
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{desc}</desc>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={M.left + plot.w}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--border)"
            />
            <text
              x={M.left - 6}
              y={yOf(v)}
              dy="0.32em"
              textAnchor="end"
              fontSize="11"
              fill="var(--text-secondary)"
              className="tabular-nums"
            >
              {formatTick(v)}
            </text>
          </g>
        ))}
        {Array.from({ length: slots }, (_, s) => s)
          .filter((s) => s % step === 0 && labelOf(s) !== "")
          .map((s) => (
            <text
              key={s}
              x={xOf(s)}
              y={M.top + plot.h + 16}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-secondary)"
              className="tabular-nums"
            >
              {labelOf(s)}
            </text>
          ))}
        <text
          transform={`translate(12 ${M.top + plot.h / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-secondary)"
        >
          {yLabel}
        </text>
        {bandPaths.map((d) => (
          <path key={d} d={d} fill={BAND_FILL} stroke="none" />
        ))}
        <line
          x1={M.left}
          x2={M.left + plot.w}
          y1={yOf(mean.value)}
          y2={yOf(mean.value)}
          stroke="var(--text-secondary)"
          strokeDasharray="5 4"
        />
        <text
          x={M.left + plot.w}
          y={yOf(mean.value) - 4}
          textAnchor="end"
          fontSize="11"
          fill="var(--text-secondary)"
        >
          {mean.label}
        </text>
        {medianPaths.map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
          />
        ))}
        {today?.value != null && (
          <circle
            cx={xOf(0)}
            cy={yOf(today.value)}
            r="5"
            fill="var(--warning)"
            stroke="var(--background)"
            strokeWidth="1.5"
          />
        )}
        {active !== null && shown && (
          <line
            x1={xOf(active)}
            x2={xOf(active)}
            y1={M.top}
            y2={M.top + plot.h}
            stroke="var(--text-secondary)"
            strokeDasharray="2 3"
            pointerEvents="none"
          />
        )}
      </svg>
      <p className="text-muted mt-1 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {shown && <span className="text-foreground tabular-nums">{shown}</span>}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-4 rounded-sm"
            style={{ background: BAND_FILL }}
          />
          {bandLabel}
        </span>
      </p>
    </div>
  );
}
