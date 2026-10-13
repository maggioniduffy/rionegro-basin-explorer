import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/landing/Wordmark";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { BasinMap } from "@/components/map/BasinMap";
import { Panels } from "@/components/Panels";
import { SearchBox } from "@/components/SearchBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UrlSync } from "@/components/UrlSync";
import { regionFromSlug, regionPath } from "@/regions";

export default async function MapPage({ params }: PageProps<"/[region]/map">) {
  const region = regionFromSlug((await params).region);
  if (!region) notFound();
  const t = await getTranslations("home");
  const landing = await getTranslations("landing");

  return (
    <main className="relative h-dvh overflow-hidden">
      <BasinMap />
      {/* The landing header, compact, floating over the map. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h1 className="bg-panel-glass border-line shadow-card pointer-events-auto flex min-h-11 shrink-0 items-center rounded-[10px] border px-3 backdrop-blur-[6px]">
            <Link
              href={regionPath(region)}
              aria-label={landing("home")}
              className="text-text"
            >
              {/* Its text is home.title, a proper noun. */}
              <Wordmark compact />
            </Link>
          </h1>
          <div className="pointer-events-auto min-w-40 flex-1 sm:w-full sm:max-w-96 sm:flex-none">
            <SearchBox />
          </div>
        </div>
        <div className="bg-panel-glass border-line shadow-card pointer-events-auto flex min-h-11 items-center gap-2 rounded-[10px] border px-1.5 backdrop-blur-[6px]">
          <Link
            href={regionPath(region, "/attributions")}
            aria-label={t("sources")}
            title={t("sources")}
            className="text-secondary hover:text-text inline-flex size-9 items-center justify-center rounded-md"
          >
            <Icon name="info" />
          </Link>
          <ThemeToggle compact />
          <LocaleSwitcher />
        </div>
      </header>
      <Panels />
      <UrlSync />
    </main>
  );
}
