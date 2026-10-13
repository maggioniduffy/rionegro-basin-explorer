import { getTranslations } from "next-intl/server";
import { DataNote } from "@/components/landing/DataNote";
import { ExploreCards } from "@/components/landing/ExploreCards";
import { HeroRivers } from "@/components/landing/HeroRivers";
import { MapAccessCard } from "@/components/landing/MapAccessCard";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { notFound } from "next/navigation";
import { regionFromSlug } from "@/regions";

export default async function LandingPage({ params }: PageProps<"/[region]">) {
  const region = regionFromSlug((await params).region);
  if (!region) notFound();
  const t = await getTranslations("landing");

  return (
    <div className="bg-bg text-text relative w-full overflow-x-clip">
      <SiteHeader region={region} path="/" />
      <main>
        <section className="relative px-[clamp(16px,4vw,40px)] pt-[clamp(40px,8vw,110px)] pb-[clamp(32px,5vw,64px)]">
          <HeroRivers />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(var(--bg-rgb),.1),var(--bg)_78%)]" />
          <div className="relative mx-auto max-w-[1100px] text-center">
            <p className="text-accent font-mono text-xs tracking-[.14em] uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mx-auto mt-[18px] max-w-[14em] text-[clamp(36px,6.4vw,80px)] leading-[1.02] font-medium tracking-[-0.035em] text-balance">
              {t("h1")}
            </h1>
            <p className="text-body mx-auto mt-[22px] max-w-[36em] text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-pretty">
              {t("sub")}
            </p>
          </div>
          <div className="relative mx-auto mt-[clamp(28px,5vw,56px)] max-w-[880px]">
            <MapAccessCard region={region} />
          </div>
        </section>
        <ExploreCards region={region} />
        <DataNote region={region} />
      </main>
      <SiteFooter region={region} path="/" />
    </div>
  );
}
