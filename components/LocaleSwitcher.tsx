"use client";

import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(nextLocale: string) {
    if (!hasLocale(routing.locales, nextLocale)) return;
    // Keep the query string (?r=, ?s= in later phases) when switching locale.
    // Read at event time to avoid a Suspense boundary for useSearchParams.
    const href = `${pathname}${window.location.search}`;
    startTransition(() => {
      router.replace(href, { locale: nextLocale });
    });
  }

  return (
    <label className="text-muted flex items-center gap-2 text-sm">
      <span>{t("label")}</span>
      <select
        className="text-foreground rounded border border-(--border) bg-transparent px-2 py-1"
        value={locale}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
      >
        {routing.locales.map((l) => (
          <option key={l} value={l} className="bg-background">
            {t("locale", { locale: l })}
          </option>
        ))}
      </select>
    </label>
  );
}
