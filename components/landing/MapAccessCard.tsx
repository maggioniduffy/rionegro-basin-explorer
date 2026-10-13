import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { MAP_PATH, RIVER_PARAM } from "@/lib/url-state";
import { Icon } from "../Icon";
import { SampleValue } from "./SampleValue";
import type { RegionId } from "@/regions";
import { REGION_CONTENT } from "@/regions/content";
import { LANDING_SAMPLES } from "@/regions/generated";
import { LANDING_IMAGES } from "@/regions/images";

/**
 * The hero card: one link to the map, named by its own text (title, description, CTA)
 * and the image's alt. Hover zooms and brightens the image and nudges
 * the arrow; focus draws a 3px accent ring. CSS only (group-hover), no client state.
 */
export async function MapAccessCard({ region }: { region: RegionId }) {
  const sample = LANDING_SAMPLES[region];
  const basin = LANDING_IMAGES[region];
  /** Quick links: river slugs from rivers.ndjson `_id`, as in the map's ?r= state. */
  const quick = REGION_CONTENT[region].featuredRivers;
  const t = await getTranslations("landing.card");
  const fields = await getTranslations("panel.fields");
  const { river } = sample;

  return (
    <div>
      <Link
        href={MAP_PATH}
        className="group bg-surface border-line shadow-card hover:border-accent hover:shadow-card-hover focus-visible:border-accent block overflow-hidden rounded-[14px] border text-inherit transition-[border-color,box-shadow] duration-250 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-(--accent)"
      >
        <div className="relative aspect-video min-h-[220px] overflow-hidden bg-black">
          {/* The LCP element: preloaded, served as AVIF/WebP by next/image. */}
          {basin && (
            <Image
              src={basin}
              alt={t("alt")}
              loading="eager"
              fetchPriority="high"
              fill
              sizes="(max-width: 912px) calc(100vw - 32px), 880px"
              className="object-cover object-[45%_50%] transition-[transform,filter] duration-[800ms,400ms] ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-105 group-hover:brightness-[1.18]"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_55%,var(--image-fade))]" />
          <div
            aria-hidden
            className="bg-chip-glass border-line absolute top-3.5 left-3.5 min-w-[150px] rounded-[10px] border px-3 py-2.5 text-[13px] backdrop-blur-[6px]"
          >
            <div className="text-sm font-semibold">{river.name}</div>
            <div className="text-secondary mt-1.5 flex justify-between gap-[18px]">
              <span className="flex items-center gap-1.5">
                <Icon name="river" className="text-accent" />
                {fields("length")}
              </span>
              <span className="text-text font-mono">
                <SampleValue q="km" value={river.lengthKm} />
              </span>
            </div>
            <div className="text-secondary mt-[3px] flex justify-between gap-[18px]">
              <span>{fields("strahler")}</span>
              <span className="text-text font-mono">{river.strahler}</span>
            </div>
          </div>
          <div className="text-secondary absolute bottom-3 left-3.5 font-mono text-[11px]">
            {t("credit")}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-[22px] py-5">
          <div className="min-w-0 flex-[1_1_260px]">
            <div className="text-xl font-semibold tracking-[-0.01em]">
              {t("title")}
            </div>
            <p className="text-secondary mt-1.5 text-[15px] leading-normal text-pretty">
              {t("text")}
            </p>
          </div>
          <span className="bg-accent text-on-accent inline-flex min-h-12 flex-none items-center justify-center gap-2.5 rounded-[10px] px-[22px] text-base font-semibold">
            {t("btn")}
            <span
              aria-hidden
              className="inline-block transition-transform duration-250 group-hover:translate-x-[5px]"
            >
              →
            </span>
          </span>
        </div>
      </Link>
      <div className="mt-3.5 flex items-center gap-2.5 overflow-x-auto pb-1 whitespace-nowrap">
        <span className="text-secondary flex-none text-[13px]">
          {t("quick")}
        </span>
        {quick.map((r) => (
          <Link
            key={r.id}
            href={`${MAP_PATH}?${RIVER_PARAM}=${r.id}`}
            className="border-line-strong text-text hover:border-accent hover:text-accent inline-flex min-h-9 flex-none items-center rounded-full border px-3.5 text-sm transition-colors"
          >
            {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
