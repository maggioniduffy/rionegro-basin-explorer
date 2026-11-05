"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormat } from "@/components/panel/parts";
import { useMapStore } from "@/lib/store";

export interface ChartPoint {
  /** Distance from the outfall, km (metric; converted for the axis). */
  km: number;
  value: number;
  reachId: number;
}

export interface ChartBand {
  km: number;
  min: number;
  max: number;
}

export interface ChartRef {
  value: number;
  label: string;
}

interface Props {
  /** Accessible name and summary of the chart. */
  title: string;
  desc: string;
  points: ChartPoint[];
  band?: ChartBand[] | null;
  bandLabel?: string;
  /** Horizontal reference lines (thresholds, saturation). */
  refs?: ChartRef[];
  /** A marked point (the minimum DO). */
  mark?: { km: number; value: number; label: string };
  /** Y axis title, with its unit. */
  yLabel: string;
  yScale?: "linear" | "log";
  /** A value with its unit, for the readout. */
  formatValue: (v: number) => string;
  /** Tick label of a y value (no unit; the axis title has it). */
  formatTick?: (v: number) => string;
  /** Click or Enter on a reach's band; the label names it for assistive tech. */
  onPick?: (reachId: number) => void;
  pickLabel?: (reachId: number, fromKm: number, toKm: number) => string;
}

const HEIGHT = 260;
const M = { left: 56, right: 10, top: 14, bottom: 44 };
const KM_PER_MI = 1.609344; // as lib/units.ts
const BAND_FILL = "color-mix(in srgb, var(--accent) 18%, transparent)";

/** About `count` round tick values covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

/** A dependency-free SVG line chart of a value along the river; the page's only chart type. */
export function ProfileChart({
  title,
  desc,
  points,
  band,
  bandLabel,
  refs = [],
  mark,
  yLabel,
  yScale = "linear",
  formatValue,
  formatTick,
  onPick,
  pickLabel,
}: Props) {
  const t = useTranslations("effluents.profile");
  const f = useFormat();
  const imperial = useMapStore((s) => s.units) === "imperial";
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

  const log = yScale === "log";
  const kmUnit = imperial ? 1 / KM_PER_MI : 1;
  const plot = {
    w: width - M.left - M.right,
    h: HEIGHT - M.top - M.bottom,
  };

  const geo = useMemo(() => {
    const values = [
      ...points.map((p) => p.value),
      ...(band ?? []).flatMap((b) => [b.min, b.max]),
      ...refs.map((r) => r.value),
      ...(mark ? [mark.value] : []),
    ];
    const kms = points.map((p) => p.km);
    const kmMax = Math.max(...kms, 1e-9);
    let lo: number;
    let hi: number;
    let ticks: number[];
    if (log) {
      const pos = values.filter((v) => v > 0);
      const dLo = Math.floor(Math.log10(Math.min(...pos, 1)));
      const dHi = Math.max(
        Math.ceil(Math.log10(Math.max(...pos, 10))),
        dLo + 1,
      );
      lo = 10 ** dLo;
      hi = 10 ** dHi;
      ticks = Array.from({ length: dHi - dLo + 1 }, (_, i) => 10 ** (dLo + i));
    } else {
      lo = Math.min(0, ...values);
      const top = Math.max(...values, lo + 1e-9);
      hi = top + (top - lo) * 0.06;
      ticks = niceTicks(lo, hi);
      hi = Math.max(hi, ticks[ticks.length - 1] ?? hi);
    }
    const yOf = (v: number) => {
      const frac = log
        ? (Math.log10(Math.max(v, lo)) - Math.log10(lo)) /
          (Math.log10(hi) - Math.log10(lo))
        : (v - lo) / (hi - lo);
      return M.top + plot.h * (1 - Math.min(1, Math.max(0, frac)));
    };
    const xOf = (km: number) => M.left + (km / kmMax) * plot.w;
    const xTicks = niceTicks(
      0,
      kmMax * kmUnit,
      Math.max(3, Math.floor(plot.w / 90)),
    );
    return { yOf, xOf, ticks, xTicks, kmMax };
  }, [points, band, refs, mark, log, plot.w, plot.h, kmUnit]);

  const { yOf, xOf } = geo;
  const path = (pts: { x: number; y: number }[]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join("");
  const line = path(points.map((p) => ({ x: xOf(p.km), y: yOf(p.value) })));
  const area = band
    ? path(band.map((b) => ({ x: xOf(b.km), y: yOf(b.max) }))) +
      path(
        [...band].reverse().map((b) => ({ x: xOf(b.km), y: yOf(b.min) })),
      ).replace("M", "L") +
      "Z"
    : null;

  // One focusable band per reach, spanning from its first point to the next reach's.
  const reaches = useMemo(() => {
    const out: { reachId: number; from: number; to: number; first: number }[] =
      [];
    points.forEach((p, i) => {
      const last = out[out.length - 1];
      if (last && last.reachId === p.reachId) last.to = p.km;
      else {
        if (last) last.to = p.km;
        out.push({ reachId: p.reachId, from: p.km, to: p.km, first: i });
      }
    });
    return out;
  }, [points]);

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const x = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(xOf(p.km) - x) < Math.abs(xOf(points[best]!.km) - x))
        best = i;
    });
    return best;
  };

  const shown = active === null ? null : (points[active] ?? null);
  const tick = formatTick ?? ((v: number) => String(v));

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
        {geo.ticks.map((v) => (
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
              {tick(v)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((v) => (
          <text
            key={v}
            x={xOf(v / kmUnit)}
            y={M.top + plot.h + 16}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-secondary)"
            className="tabular-nums"
          >
            {v}
          </text>
        ))}
        <text
          x={M.left + plot.w / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-secondary)"
        >
          {t("xAxis", { unit: imperial ? "mi" : "km" })}
        </text>
        <text
          transform={`translate(12 ${M.top + plot.h / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-secondary)"
        >
          {yLabel}
        </text>
        {area && <path d={area} fill={BAND_FILL} stroke="none" />}
        {refs.map((r) => (
          <g key={r.label}>
            <line
              x1={M.left}
              x2={M.left + plot.w}
              y1={yOf(r.value)}
              y2={yOf(r.value)}
              stroke="var(--warning)"
              strokeDasharray="5 4"
            />
            <text
              x={M.left + plot.w}
              y={yOf(r.value) - 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-secondary)"
            >
              {r.label}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {mark && (
          <g>
            <circle
              cx={xOf(mark.km)}
              cy={yOf(mark.value)}
              r="5"
              fill="var(--warning)"
              stroke="var(--background)"
              strokeWidth="1.5"
            />
            <text
              x={Math.min(xOf(mark.km) + 8, M.left + plot.w)}
              y={yOf(mark.value) + 16}
              textAnchor={
                xOf(mark.km) + 8 > M.left + plot.w - 90 ? "end" : "start"
              }
              fontSize="11"
              fill="var(--foreground)"
            >
              {mark.label}
            </text>
          </g>
        )}
        {shown && (
          <g pointerEvents="none">
            <line
              x1={xOf(shown.km)}
              x2={xOf(shown.km)}
              y1={M.top}
              y2={M.top + plot.h}
              stroke="var(--text-secondary)"
              strokeDasharray="2 3"
            />
            <circle
              cx={xOf(shown.km)}
              cy={yOf(shown.value)}
              r="4"
              fill="var(--accent)"
              stroke="var(--background)"
              strokeWidth="1.5"
            />
          </g>
        )}
        {onPick &&
          reaches.map((r) => (
            <rect
              key={`${r.reachId}-${r.first}`}
              x={xOf(r.from)}
              y={M.top}
              width={Math.max(xOf(r.to) - xOf(r.from), 6)}
              height={plot.h}
              fill="transparent"
              stroke="none"
              tabIndex={0}
              role="button"
              aria-label={
                pickLabel?.(r.reachId, r.from, r.to) ?? String(r.reachId)
              }
              className="cursor-pointer outline-none focus-visible:stroke-(--accent) focus-visible:stroke-2"
              onClick={() => onPick(r.reachId)}
              onFocus={() => setActive(r.first)}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(r.reachId);
                }
              }}
            />
          ))}
      </svg>
      <p className="text-muted mt-1 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {shown ? (
          <span className="text-foreground tabular-nums">
            {f("km", shown.km)} · {formatValue(shown.value)}
          </span>
        ) : onPick ? (
          <span>{t("pickHint")}</span>
        ) : null}
        {band && bandLabel && (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: BAND_FILL }}
            />
            {bandLabel}
          </span>
        )}
      </p>
    </div>
  );
}
