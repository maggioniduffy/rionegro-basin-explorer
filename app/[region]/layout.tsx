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

export default async function RegionLayout({
  children,
  params,
}: LayoutProps<"/[region]">) {
  const { region } = await params;
  if (!isRegionId(region)) notFound();
  return <RegionProvider region={region}>{children}</RegionProvider>;
}
