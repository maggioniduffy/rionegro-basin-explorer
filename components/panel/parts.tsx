"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatQuantity, type Quantity } from "@/lib/units";
import { Icon } from "../Icon";

/** Which caveat explains a modeled value (messages panel.caveat.*). */
export type Caveat =
  "discharge" | "population" | "flooded" | "regulation" | "nonPerennial";

export function useFormat() {
  const locale = useLocale();
  return (q: Quantity, v: number) => formatQuantity(locale, q, v);
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
