import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { RegionProvider } from "@/components/RegionProvider";
import { isRegionId, REGION_IDS } from "@/regions";

/**
 * Every page and API route lives under app/[region]; proxy.ts rewrites each request to
 * its host's region (regions/hosts.ts), so the region never shows in public URLs.
 */
export function generateStaticParams() {
  return REGION_IDS.map((region) => ({ region }));
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
  const { region } = await params;
  if (!isRegionId(region)) notFound();
  return <RegionProvider region={region}>{children}</RegionProvider>;
}
