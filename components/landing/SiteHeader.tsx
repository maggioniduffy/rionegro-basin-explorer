import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { LOCALES } from "@/i18n/config";
import { regionPath, type RegionId } from "@/regions";
import { Icon } from "../Icon";
import { ThemeToggle } from "../ThemeToggle";
import { Wordmark } from "./Wordmark";

/**
 * Language links. /en and /es set the locale cookie and redirect to `path` (proxy.ts), the
 * full path (the region's included).
 * Plain anchors, not <Link>: a prefetch would set the cookie without a click.
 */
export async function LocaleLinks({ path }: { path: string }) {
  const locale = await getLocale();
  const t = await getTranslations("localeSwitcher");
  return (
    <div className="flex items-center gap-2">
      <Icon name="language" size={24} className="text-secondary shrink-0" />
      <div
        role="group"
        aria-label={t("label")}
        className="border-line flex overflow-hidden rounded-md border text-[13px] font-semibold"
      >
        {LOCALES.map((l) => {
          const active = l === locale;
          return (
            <a
              key={l}
              href={`/${l}${path === "/" ? "" : path}`}
              lang={l}
              hrefLang={l}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-9 items-center px-3 ${
                active
                  ? "bg-accent text-on-accent"
                  : "text-strong-muted hover:text-text"
              }`}
            >
              {t("short", { locale: l })}
              <span className="sr-only"> ({t("locale", { locale: l })})</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Landing and attributions header: home link, all regions (the hub at /), Attributions,
 * theme, language. `path` is the page's path inside the region.
 */
export async function SiteHeader({
  region,
  path,
}: {
  region: RegionId;
  path: string;
}) {
  const t = await getTranslations("landing");
  return (
    <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] py-4">
      <Link
        href={regionPath(region)}
        aria-label={t("home")}
        className="text-text flex min-h-11 items-center"
      >
        <Wordmark />
      </Link>
      <nav
        aria-label={t("nav")}
        className="flex flex-wrap items-center gap-x-[clamp(12px,3vw,28px)] gap-y-2 text-sm"
      >
        <Link
          href="/"
          className="text-secondary hover:text-text inline-flex min-h-11 items-center"
        >
          {t("hub")}
        </Link>
        <Link
          href={regionPath(region, "/attributions")}
          className="text-secondary hover:text-text inline-flex min-h-11 items-center"
        >
          {t("attr")}
        </Link>
        <ThemeToggle />
        <LocaleLinks path={regionPath(region, path)} />
      </nav>
    </header>
  );
}
