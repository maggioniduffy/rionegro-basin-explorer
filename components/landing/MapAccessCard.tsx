import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { MAP_PATH, RIVER_PARAM } from "@/lib/url-state";
import { SampleValue } from "./SampleValue";
import { regionPath, type RegionId } from "@/regions";
import { REGION_CONTENT } from "@/regions/content";
import { LANDING_SAMPLES } from "@/regions/generated";
import { LANDING_IMAGES } from "@/regions/images";

/**
 * The hero image: one link to the map, named by landing.open (the image's alt describes the
 * picture). A chip with the sample river's figures (regions/<id>/landing-sample.json) and
 * the imagery credit sit on it; the quick links to featured rivers follow below.
 */
export async function MapAccessCard({ region }: { region: RegionId }) {
  const basin = LANDING_IMAGES[region];
  /** Quick links: river slugs from rivers.ndjson `_id`, as in the map's ?r= state. */
  const quick = REGION_CONTENT[region].featuredRivers;
  const t = await getTranslations("landing.card");
  const open = await getTranslations("landing");
  const fields = await getTranslations("panel.fields");
  const { river } = LANDING_SAMPLES[region];

  return (
    <div className="mx-auto mt-[clamp(40px,6vw,72px)] max-w-[1200px]">
      <Link
        href={regionPath(region, MAP_PATH)}
        aria-label={open("open")}
        className="bg-note-bg shadow-hero relative block aspect-[14/9] overflow-hidden rounded-[clamp(12px,1.6vw,20px)]"
      >
        {/* The LCP element: preloaded, served as AVIF/WebP by next/image. */}
        {basin && (
          <Image
            src={basin}
            alt={t("alt")}
            loading="eager"
            fetchPriority="high"
            fill
            sizes="(max-width: 1240px) calc(100vw - 40px), 1200px"
            className="object-cover object-[45%_50%]"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-black/45 to-transparent" />
        <div
          aria-hidden
          className="bg-chip-glass text-text absolute top-[clamp(12px,2vw,24px)] left-[clamp(12px,2vw,24px)] min-w-40 rounded-xl px-3.5 py-3 text-left text-[13px] backdrop-blur-[6px]"
        >
          <div className="text-[15px] font-semibold">{river.name}</div>
          <div className="text-secondary mt-1.5 flex justify-between gap-4">
            <span>{fields("length")}</span>
            <span className="text-text font-mono">
              <SampleValue q="km" value={river.lengthKm} />
            </span>
          </div>
          <div className="text-secondary mt-0.5 flex justify-between gap-4">
            <span>{fields("strahler")}</span>
            <span className="text-text font-mono">{river.strahler}</span>
          </div>
        </div>
        <div className="absolute bottom-3 left-3.5 font-mono text-[11px] text-white/90">
          {t("credit")}
        </div>
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
        <span className="text-secondary text-[13px]">{t("quick")}</span>
        {quick.map((r) => (
          <Link
            key={r.id}
            href={regionPath(region, `${MAP_PATH}?${RIVER_PARAM}=${r.id}`)}
            className="border-line-strong text-text hover:border-accent hover:text-accent inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm transition-colors"
          >
            {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
