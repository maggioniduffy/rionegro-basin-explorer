import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { Logomark } from "@/components/Icon";
import { LocaleLinks } from "@/components/landing/SiteHeader";
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
    <div className="bg-bg text-text flex min-h-full w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] py-4">
        <span className="flex min-h-11 items-center gap-2.5">
          <Logomark width={34} className="shrink-0" />
          <span className="font-display text-base font-medium tracking-[-0.01em]">
            {t("metadata.title")}
          </span>
        </span>
        <nav className="flex flex-wrap items-center gap-x-[clamp(12px,3vw,28px)] gap-y-2 text-sm">
          <ThemeToggle />
          <LocaleLinks path="/" />
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-[clamp(16px,4vw,40px)] pt-[clamp(32px,6vw,80px)] pb-16">
        <div className="text-center">
          <p className="text-accent font-mono text-xs tracking-[.14em] uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="mx-auto mt-[18px] max-w-[16em] text-[clamp(32px,5vw,64px)] leading-[1.05] font-medium tracking-[-0.03em] text-balance">
            {t("h1")}
          </h1>
          <p className="text-body mx-auto mt-[18px] max-w-[36em] text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-pretty">
            {t("sub")}
          </p>
        </div>
        <section aria-label={t("regions")}>
          <ul className="grid gap-6 sm:grid-cols-2">
            {REGION_IDS.map((id) => {
              const m = messagesFor(id, locale);
              const image = LANDING_IMAGES[id];
              return (
                <li key={id} className="flex">
                  <Link
                    href={regionPath(id)}
                    className="group bg-surface border-line shadow-card hover:border-accent hover:shadow-card-hover focus-visible:border-accent flex w-full flex-col overflow-hidden rounded-[14px] border text-inherit transition-[border-color,box-shadow] duration-250 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-(--accent)"
                  >
                    <div className="relative aspect-video overflow-hidden bg-black">
                      {image && (
                        <Image
                          src={image}
                          alt={m.landing.card.alt}
                          fill
                          sizes="(max-width: 640px) calc(100vw - 32px), 520px"
                          className="object-cover transition-[transform,filter] duration-[800ms,400ms] group-hover:scale-105 group-hover:brightness-[1.18]"
                        />
                      )}
                      <div className="text-secondary absolute bottom-3 left-3.5 font-mono text-[11px]">
                        {card("credit")}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 px-[22px] py-5">
                      <h2 className="text-xl font-semibold tracking-[-0.01em]">
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
