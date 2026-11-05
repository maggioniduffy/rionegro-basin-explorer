import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EffluentAnalysis } from "@/components/effluent/EffluentAnalysis";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { regionFromSlug } from "@/regions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("effluents");
  return { title: t("metaTitle"), description: t("intro") };
}

/** The discharge analysis of a region with an effluent net; any other region is a 404. */
export default async function EffluentsPage({
  params,
}: PageProps<"/[region]/effluents">) {
  const region = regionFromSlug((await params).region);
  if (!region || !getEffluentRegion(region)) notFound();

  return (
    <div className="bg-bg text-text flex min-h-full w-full flex-col">
      <SiteHeader region={region} path="/effluents" />
      <EffluentAnalysis />
      <SiteFooter region={region} path="/effluents" />
    </div>
  );
}
