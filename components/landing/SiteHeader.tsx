import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { LOCALES } from "@/i18n/config";
import { MAP_PATH } from "@/lib/url-state";
import { regionPath, type RegionId } from "@/regions";
import { MobileMenu } from "../MobileMenu";
import { ThemeToggle } from "../ThemeToggle";
import { Wordmark } from "./Wordmark";

/**
 * Language links, a pill segmented control. /en and /es set the locale cookie and redirect
 * to `path` (proxy.ts), the full path (the region's included).
 * Plain anchors, not <Link>: a prefetch would set the cookie without a click.
 */
export async function LocaleLinks({ path }: { path: string }) {
  const locale = await getLocale();
  const t = await getTranslations("localeSwitcher");
  return (
    <div
      role="group"
      aria-label={t("label")}
      className="bg-surface-active flex gap-0.5 rounded-full p-[3px] text-xs font-semibold"
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
            className={`inline-flex min-h-7 items-center rounded-full px-2.5 ${
              active ? "bg-cta text-on-cta" : "text-secondary hover:text-text"
            }`}
          >
            {t("short", { locale: l })}
            <span className="sr-only"> ({t("locale", { locale: l })})</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * Landing and attributions header: home link, all regions (the hub at /), Attributions,
 * theme, language and the map. `path` is the page's path inside the region.
 */
export async function SiteHeader({
  region,
  path,
}: {
  region: RegionId;
  path: string;
}) {
  const t = await getTranslations("landing");
  const link =
    "text-secondary hover:text-text inline-flex min-h-11 items-center";
  const cta =
    "bg-cta text-on-cta hover:bg-cta-hover inline-flex min-h-10 items-center rounded-full px-4 font-medium whitespace-nowrap transition-colors";
  const map = regionPath(region, MAP_PATH);
  return (
    <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(20px,5vw,64px)] py-[18px]">
      <Link
        href={regionPath(region)}
        aria-label={t("home")}
        className="text-text flex min-h-11 items-center"
      >
        <Wordmark phoneMark />
      </Link>
      <nav
        aria-label={t("nav")}
        className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:flex"
      >
        <Link href="/" className={link}>
          {t("hub")}
        </Link>
        <Link href={regionPath(region, "/attributions")} className={link}>
          {t("attr")}
        </Link>
        <ThemeToggle />
        <LocaleLinks path={regionPath(region, path)} />
        <Link href={map} className={cta}>
          {t("open")}
        </Link>
      </nav>
      {/* Below 640px: the map link stays, the rest goes into the menu. */}
      <div className="flex items-center gap-1 sm:hidden">
        <Link href={map} className={cta}>
          {t("open")}
        </Link>
        <MobileMenu>
          <Link href="/" className={`${link} w-full`}>
            {t("hub")}
          </Link>
          <Link
            href={regionPath(region, "/attributions")}
            className={`${link} w-full`}
          >
            {t("attr")}
          </Link>
          <ThemeToggle className="min-h-11! w-full justify-start" />
          <LocaleLinks path={regionPath(region, path)} />
        </MobileMenu>
      </div>
    </header>
  );
}
