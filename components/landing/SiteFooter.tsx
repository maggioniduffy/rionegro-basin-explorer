import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LOCALES } from "@/i18n/config";
import { MAP_PATH } from "@/lib/url-state";
import { Wordmark } from "./Wordmark";

export async function SiteFooter({ path }: { path: string }) {
  const t = await getTranslations("landing");
  const ls = await getTranslations("localeSwitcher");
  return (
    <footer className="border-line-card text-footer flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t px-[clamp(16px,4vw,40px)] pt-7 pb-10 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-text">
          <Wordmark />
        </span>
        <Link
          href="/attributions"
          className="text-secondary hover:text-text inline-flex min-h-11 items-center"
        >
          {t("attr")}
        </Link>
        <span>{t("credit")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* Plain anchors: see LocaleLinks. */}
        {LOCALES.map((l) => (
          <a
            key={l}
            href={`/${l}${path === "/" ? "" : path}`}
            lang={l}
            hrefLang={l}
            className="text-secondary hover:text-text inline-flex min-h-11 items-center"
          >
            {ls("short", { locale: l })}
            <span className="sr-only"> ({ls("locale", { locale: l })})</span>
          </a>
        ))}
        <Link
          href={MAP_PATH}
          className="text-accent hover:text-accent-soft inline-flex min-h-11 items-center font-semibold"
        >
          {t("open")} →
        </Link>
      </div>
    </footer>
  );
}
