import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { messagesFor } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { RegionProvider } from "@/components/RegionProvider";
import { REGION_IDS, REGION_SLUGS, regionFromSlug } from "@/regions";

/**
 * Every region page and API route lives under app/[region], whose param is the region's
 * slug (basinexplorer.vercel.app/cordoba; regions/index.ts REGION_SLUGS).
 */
export function generateStaticParams() {
  return REGION_IDS.map((id) => ({ region: REGION_SLUGS[id] }));
}

export const dynamicParams = false;

/** The region's title and description (regions/<id>/messages; the hub has its own, R4). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  // The image comes from ./opengraph-image.tsx. Its absolute URL uses Vercel's production
  // domain (VERCEL_PROJECT_PRODUCTION_URL), so no metadataBase is set here.
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function RegionLayout({
  children,
  params,
}: LayoutProps<"/[region]">) {
  const region = regionFromSlug((await params).region);
  if (!region) notFound();
  const locale = (await getLocale()) as Locale;
  // The root layout is not re-rendered on a client navigation from the hub or another
  // region, so its provider would keep that page's messages. This layout re-renders when
  // the region param changes, so the nested provider always carries this region's messages.
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(region, locale)}
    >
      <RegionProvider region={region}>{children}</RegionProvider>
    </NextIntlClientProvider>
  );
}
