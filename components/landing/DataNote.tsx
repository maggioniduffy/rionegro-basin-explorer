import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { regionPath, type RegionId } from "@/regions";

/** "Modeled, not measured": the rule 4 caveat, before anyone opens the map. */
export async function DataNote({ region }: { region: RegionId }) {
  const t = await getTranslations("landing");
  return (
    <section
      aria-labelledby="data-note-title"
      className="relative z-3 px-[clamp(12px,2vw,24px)]"
    >
      <div className="bg-note-bg text-note-text border-note-border mx-auto grid max-w-[1320px] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-end gap-x-16 gap-y-7 rounded-[clamp(16px,2vw,28px)] border px-[clamp(24px,6vw,96px)] py-[clamp(40px,7vw,96px)]">
        <div>
          <p className="text-note-tag font-mono text-xs tracking-[.14em] uppercase">
            {t("dTag")}
          </p>
          <h2
            id="data-note-title"
            className="font-display mt-4 text-[clamp(36px,5vw,64px)] leading-none font-normal tracking-[-0.015em] text-balance"
          >
            {t("dH")}
          </h2>
        </div>
        <div className="text-note-body text-[15px] leading-[1.65]">
          <p className="text-pretty">{t("d1")}</p>
          <p className="mt-3 text-pretty">{t("d2")}</p>
          <Link
            href={regionPath(region, "/attributions#modeled")}
            className="text-note-link hover:text-note-link-hover mt-3.5 inline-flex min-h-11 items-center font-medium"
          >
            {t("attr")} →
          </Link>
        </div>
      </div>
    </section>
  );
}
