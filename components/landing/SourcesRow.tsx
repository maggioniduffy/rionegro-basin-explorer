import { getTranslations } from "next-intl/server";
import type { RegionId } from "@/regions";
import { REGION_CONTENT } from "@/regions/content";

/** "Built on open hydrographic data" and the region's sources (proper nouns, not translated). */
export async function SourcesRow({ region }: { region: RegionId }) {
  const t = await getTranslations("landing");
  return (
    <section className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-10 gap-y-4 px-[clamp(20px,5vw,64px)] py-[clamp(32px,4vw,48px)]">
      <span className="text-secondary text-sm">{t("built")}</span>
      <ul className="text-strong-muted flex flex-wrap gap-x-[clamp(20px,3.4vw,48px)] gap-y-3 font-mono text-sm tracking-[.02em]">
        {REGION_CONTENT[region].landingSources.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </section>
  );
}
