import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { FLOW_PARAM, MAP_PATH } from "@/lib/url-state";
import { regionPath, type RegionId } from "@/regions";
import { REGION_CONTENT } from "@/regions/content";
import { LANDING_FLOW_IMAGES } from "@/regions/images";

/**
 * "New · in progress" announcement of the flow close-up: copy beside the owner's screenshot,
 * and a link to a sample section. Renders nothing for a region without flow data.
 */
export async function FlowUpdate({ region }: { region: RegionId }) {
  const image = LANDING_FLOW_IMAGES[region];
  const section = REGION_CONTENT[region].landingFlowSection;
  if (!image || !section) return null;
  const t = await getTranslations("landing.flowNew");
  return (
    <section
      aria-labelledby="flow-new-title"
      className="mx-auto max-w-[1200px] px-[clamp(20px,5vw,64px)] pb-[clamp(56px,8vw,112px)]"
    >
      <div className="grid items-center gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <div className="border-line-strong text-secondary inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px]">
            <i aria-hidden className="bg-dot size-1.5 rounded-full" />
            {t("tag")}
          </div>
          <h2
            id="flow-new-title"
            className="font-display m-0 mt-5 text-[clamp(34px,4.6vw,60px)] leading-[1.05] font-normal tracking-[-0.015em] text-balance"
          >
            {t("h")}
          </h2>
          <p className="text-secondary mt-5 text-[15px] leading-[1.6] text-pretty">
            {t("p1")}
          </p>
          <p className="text-secondary mt-3 text-[15px] leading-[1.6] text-pretty">
            {t("p2")}
          </p>
          <Link
            href={regionPath(region, `${MAP_PATH}?${FLOW_PARAM}=${section}`)}
            className="bg-cta text-on-cta hover:bg-cta-hover mt-7 inline-flex min-h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium transition-colors"
          >
            {t("cta")} <span aria-hidden>→</span>
          </Link>
        </div>
        <Image
          src={image}
          alt={t("alt")}
          sizes="(max-width: 1024px) calc(100vw - 40px), 700px"
          className="bg-note-bg shadow-hero h-auto w-full rounded-[clamp(12px,1.6vw,20px)]"
        />
      </div>
    </section>
  );
}
