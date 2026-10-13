import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { DataNote } from "@/components/landing/DataNote";
import { ExploreCards } from "@/components/landing/ExploreCards";
import { Grain } from "@/components/landing/Grain";
import { MapAccessCard } from "@/components/landing/MapAccessCard";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SourcesRow } from "@/components/landing/SourcesRow";
import { notFound } from "next/navigation";
import { MAP_PATH } from "@/lib/url-state";
import { regionFromSlug, regionPath } from "@/regions";

export default async function LandingPage({ params }: PageProps<"/[region]">) {
  const region = regionFromSlug((await params).region);
  if (!region) notFound();
  const t = await getTranslations("landing");

  return (
    <div className="bg-bg text-text relative w-full overflow-x-clip">
      <Grain />
      <SiteHeader region={region} path="/" />
      <main>
        <section className="px-[clamp(20px,5vw,64px)] pt-[clamp(48px,9vw,120px)] text-center">
          <div className="border-line-strong text-secondary inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px]">
            <i aria-hidden className="bg-dot size-1.5 rounded-full" />
            {t("eyebrow")}
          </div>
          <h1 className="font-display mx-auto mt-6 max-w-[12em] text-[clamp(44px,7.4vw,104px)] leading-none font-normal tracking-[-0.02em] text-balance">
            {t("h1")}
          </h1>
          <p className="text-secondary mx-auto mt-[22px] max-w-[32em] text-[clamp(16px,1.5vw,19px)] leading-[1.55] text-pretty">
            {t("sub")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Link
              href={regionPath(region, MAP_PATH)}
              className="bg-cta text-on-cta hover:bg-cta-hover inline-flex min-h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium transition-colors"
            >
              {t("open")} <span aria-hidden>→</span>
            </Link>
            <a
              href="#explore"
              className="border-line-strong text-text hover:border-text inline-flex min-h-12 items-center rounded-full border px-6 text-[15px] font-medium transition-colors"
            >
              {t("exTag")}
            </a>
          </div>
          <MapAccessCard region={region} />
        </section>
        <SourcesRow region={region} />
        <ExploreCards />
        <DataNote region={region} />
      </main>
      <SiteFooter region={region} path="/" overlap />
    </div>
  );
}
