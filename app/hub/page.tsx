import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { Logomark } from "@/components/Icon";
import { Grain } from "@/components/landing/Grain";
import { LocaleLinks } from "@/components/landing/SiteHeader";
import { MobileMenu } from "@/components/MobileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isLocale } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";
import { REGION_IDS, regionPath } from "@/regions";
import { LANDING_IMAGES } from "@/regions/images";

/**
 * The hub (R4): one card per served region (REGION_IDS), linking to its path (/cordoba,
 * /rionegro). proxy.ts serves it at / on every host, outside app/[region], with the shared
 * messages; each card's name, text and image alt come from that region's own
 * messages, so the hub adds no per-region strings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hub.metadata");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
    },
  };
}

export default async function HubPage() {
  const t = await getTranslations("hub");
  const card = await getTranslations("landing.card");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";

  return (
    <div className="bg-bg text-text relative flex min-h-full w-full flex-col overflow-x-clip">
      <Grain />
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(20px,5vw,64px)] py-[18px]">
        <span className="flex min-h-11 items-center gap-2.5">
          <Logomark width={34} className="shrink-0" />
          <span className="font-sans text-base font-medium tracking-[-0.01em]">
            {t("metadata.title")}
          </span>
        </span>
        <nav className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:flex">
          <ThemeToggle />
          <LocaleLinks path="/" />
        </nav>
        <MobileMenu>
          <ThemeToggle className="min-h-11! w-full justify-start" />
          <LocaleLinks path="/" />
        </MobileMenu>
      </header>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[clamp(40px,6vw,72px)] px-[clamp(20px,5vw,64px)] pt-[clamp(48px,9vw,96px)] pb-[clamp(56px,8vw,112px)]">
        <div className="text-center">
          <div className="border-line-strong text-secondary inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px]">
            <i aria-hidden className="bg-dot size-1.5 rounded-full" />
            {t("eyebrow")}
          </div>
          <h1 className="font-display mx-auto mt-6 max-w-[14em] text-[clamp(44px,6.4vw,88px)] leading-none font-normal tracking-[-0.02em] text-balance">
            {t("h1")}
          </h1>
          <p className="text-secondary mx-auto mt-[22px] max-w-[34em] text-[clamp(16px,1.5vw,19px)] leading-[1.55] text-pretty">
            {t("sub")}
          </p>
        </div>
        <section aria-label={t("regions")}>
          <ul className="grid gap-x-8 gap-y-12 sm:grid-cols-2">
            {REGION_IDS.map((id) => {
              const m = messagesFor(id, locale);
              const image = LANDING_IMAGES[id];
              return (
                <li key={id} className="flex">
                  <Link
                    href={regionPath(id)}
                    className="group flex w-full flex-col gap-5 text-inherit"
                  >
                    <div className="bg-note-bg shadow-hero relative aspect-[14/9] overflow-hidden rounded-[20px]">
                      {image && (
                        <Image
                          src={image}
                          alt={m.landing.card.alt}
                          fill
                          sizes="(max-width: 640px) calc(100vw - 40px), 540px"
                          className="object-cover transition-transform duration-[800ms] ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-[1.03]"
                        />
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-black/45 to-transparent" />
                      <div className="absolute bottom-3 left-3.5 font-mono text-[11px] text-white/90">
                        {card("credit")}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      <h2 className="font-display text-[28px] leading-tight font-normal tracking-[-0.01em]">
                        {m.metadata.title}
                      </h2>
                      <p className="text-secondary text-[15px] leading-normal text-pretty">
                        {m.metadata.description}
                      </p>
                      <span className="text-accent mt-auto pt-1 font-semibold">
                        {t("open")} →
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
