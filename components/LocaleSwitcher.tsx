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
import { Icon } from "./Icon";

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
    <div
      className="text-secondary flex items-center gap-2 text-[13px]"
      title={t("label")}
    >
      <Icon name="language" />
      <span id="locale-switcher-label" className="sr-only">
        {t("label")}
      </span>
      {/* Two locales: a segmented toggle, one click on the other language switches. */}
      <div
        role="group"
        aria-labelledby="locale-switcher-label"
        className="border-line flex overflow-hidden rounded-md border"
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
              className={`min-h-9 px-3 font-semibold transition-colors ${
                active
                  ? "bg-accent text-on-accent"
                  : "text-strong-muted hover:text-text"
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
