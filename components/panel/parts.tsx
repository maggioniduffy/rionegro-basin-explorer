"use client";

import { useLocale, useTranslations } from "next-intl";
import type { MouthKind } from "@/lib/data/mouth";
import Link from "next/link";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useMapStore } from "@/lib/store";
import { formatQuantity, type Quantity } from "@/lib/units";
import { Icon } from "../Icon";

/** Which caveat explains a modeled value (messages panel.caveat.*). */
export type Caveat =
  "discharge" | "population" | "flooded" | "regulation" | "nonPerennial";

/** Modeled value path (River.modeled, Stream.modeled) → the caveat that explains it. */
export const CAVEAT_BY_PATH: [string, Caveat][] = [
  ["mouth.dischargeM3s", "discharge"],
  ["nonPerennialPct", "nonPerennial"],
  ["watershed.floodedMaxPct", "flooded"],
  ["watershed.population", "population"],
  ["mouth.regulationPct", "regulation"],
];

export function useFormat() {
  const locale = useLocale();
  const units = useMapStore((s) => s.units);
  return (q: Quantity, v: number) => formatQuantity(locale, q, v, units);
}

/**
 * The distance-to-the-sea cell: the value, or, when the data has none (reference regions),
 * why: the water ends in an endorheic sink, or the path has no sourced distance.
 */
export function useSeaDistance() {
  const t = useTranslations("panel");
  const f = useFormat();
  return (km: number | null, mouthKind: MouthKind | undefined) =>
    km !== null
      ? f("km", km)
      : mouthKind === "sink"
        ? t("fields.distanceToSeaNone")
        : t("fields.distanceToSeaUnknown");
}

export function Row({
  label,
  children,
  modeled = false,
}: {
  label: string;
  children: ReactNode;
  modeled?: boolean;
}) {
  const t = useTranslations("panel");
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-secondary">
        {label}
        {modeled && (
          <abbr title={t("modeledMark")} className="ml-0.5 no-underline">
            *
          </abbr>
        )}
      </dt>
      <dd className="text-text text-right font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {hint && <p className="text-muted text-xs">{hint}</p>}
      <dl className="divide-line-faint divide-y">{children}</dl>
    </section>
  );
}

/** Rule 4: every modeled value shown names its source and period. */
export function Caveats({ caveats }: { caveats: Caveat[] }) {
  const t = useTranslations("panel.caveat");
  return (
    <footer className="text-muted flex flex-col gap-1 border-t border-(--border) pt-3 text-xs">
      {caveats.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 font-medium">
            <Icon name="info" size={14} className="shrink-0" />
            {t("title")}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {caveats.map((c) => (
              <li key={c}>{t(c)}</li>
            ))}
          </ul>
        </>
      )}
      <p>{t("source")}</p>
      <Link
        href="/attributions#modeled"
        className="w-fit underline decoration-(--border) underline-offset-2 hover:decoration-current"
      >
        {t("more")}
      </Link>
    </footer>
  );
}

/**
 * Where the info panel sits: a floating card in the right column (desktop), or the
 * bottom sheet's Details tab (phones), which already draws the card.
 */
export const PanelVariant = createContext<"floating" | "sheet">("floating");

/**
 * The panel on the right of the map: close button, Escape to close (unless something
 * else, like the search box, already handled the key), and a busy state while loading.
 */
export function PanelFrame({
  label,
  busy = false,
  onClose,
  children,
}: {
  label: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("panel");
  const variant = useContext(PanelVariant);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={label}
      aria-busy={busy}
      data-testid="info-panel"
      className={
        variant === "sheet"
          ? "relative flex flex-col gap-4 text-sm"
          : "border-line bg-panel-glass shadow-card pointer-events-auto relative flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[10px] border p-4 text-sm backdrop-blur-[6px] group-data-[split=true]:max-h-[calc(50%-0.375rem)]"
      }
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        title={t("close")}
        className={`absolute flex h-9 w-9 ${variant === "sheet" ? "-top-2 -right-1" : "top-1.5 right-1.5"} items-center justify-center rounded-md hover:bg-(--panel-hover)`}
      >
        <Icon name="close" />
      </button>
      {children}
    </aside>
  );
}
