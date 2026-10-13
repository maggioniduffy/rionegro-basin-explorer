"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALES,
  type Locale,
} from "@/i18n/config";

/** Persist the choice; i18n/request.ts reads it on the next server render. */
function saveLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const labelId = useId();

  // No navigation: save the choice and re-render server components with the new
  // messages. Client state (the map, the slider) and the URL stay as they are.
  function onChange(nextLocale: string) {
    if (!isLocale(nextLocale)) return;
    saveLocale(nextLocale);
    startTransition(() => router.refresh());
  }

  return (
    <div title={t("label")}>
      <span id={labelId} className="sr-only">
        {t("label")}
      </span>
      {/* Two locales: a segmented toggle, one click on the other language switches. */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="bg-surface-active flex gap-0.5 rounded-full p-[3px] text-xs font-semibold"
      >
        {LOCALES.map((l) => {
          const active = l === locale;
          return (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={active}
              title={t("locale", { locale: l })}
              disabled={isPending}
              onClick={() => !active && onChange(l)}
              className={`min-h-7 rounded-full px-2.5 transition-colors ${
                active ? "bg-cta text-on-cta" : "text-secondary hover:text-text"
              }`}
            >
              {t("short", { locale: l })}
              <span className="sr-only"> ({t("locale", { locale: l })})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
