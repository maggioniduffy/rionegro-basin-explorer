"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { useMapStore } from "@/lib/store";
import { formatQuantity, type Quantity } from "@/lib/units";
import { Icon } from "../Icon";

/** Which caveat explains a modeled value (messages panel.caveat.*). */
export type Caveat =
  "discharge" | "population" | "flooded" | "regulation" | "nonPerennial";

export function useFormat() {
  const locale = useLocale();
  const units = useMapStore((s) => s.units);
  return (q: Quantity, v: number) => formatQuantity(locale, q, v, units);
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
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted">
        {label}
        {modeled && (
          <abbr title={t("modeledMark")} className="ml-0.5 no-underline">
            *
          </abbr>
        )}
      </dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
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
      <dl className="divide-y divide-(--border)">{children}</dl>
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
    </footer>
  );
}

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
      className="pointer-events-auto relative flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-lg border border-(--border) bg-(--panel) p-4 text-sm shadow-lg backdrop-blur group-data-[split=true]:max-h-[calc(50%-0.375rem)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        title={t("close")}
        className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md hover:bg-(--panel-hover)"
      >
        <Icon name="close" />
      </button>
      {children}
    </aside>
  );
}
