"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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

  // No navigation: save the choice and re-render server components with the new
  // messages. Client state (the map, the slider) and the URL stay as they are.
  function onChange(nextLocale: string) {
    if (!isLocale(nextLocale)) return;
    saveLocale(nextLocale);
    startTransition(() => router.refresh());
  }

  return (
    <div className="text-muted flex items-center gap-2 text-sm">
      <span id="locale-switcher-label">{t("label")}</span>
      {/* Two locales: a segmented toggle, one click on the other language switches. */}
      <div
        role="group"
        aria-labelledby="locale-switcher-label"
        className="flex overflow-hidden rounded-md border border-(--border)"
      >
        {LOCALES.map((l) => {
          const active = l === locale;
          return (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={active}
              aria-label={t("locale", { locale: l })}
              title={t("locale", { locale: l })}
              disabled={isPending}
              onClick={() => !active && onChange(l)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                active
                  ? "bg-sky-400 text-black"
                  : "text-foreground hover:bg-(--panel-hover)"
              }`}
            >
              {t("short", { locale: l })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
