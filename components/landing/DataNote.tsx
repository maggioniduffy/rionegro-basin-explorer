import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Icon } from "../Icon";

/** "Modeled, not measured": the rule 4 caveat, before anyone opens the map. */
export async function DataNote() {
  const t = await getTranslations("landing");
  return (
    <section
      aria-labelledby="data-note-title"
      className="mx-auto max-w-[1280px] px-[clamp(16px,4vw,40px)] pb-[clamp(40px,7vw,96px)]"
    >
      <div className="border-line grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-12 gap-y-6 border-y py-8">
        <div>
          <p className="text-accent flex items-center gap-2 font-mono text-xs tracking-[.14em] uppercase">
            <Icon name="info" size={24} className="shrink-0" />
            {t("dTag")}
          </p>
          <h2
            id="data-note-title"
            className="mt-3 text-[clamp(22px,2.6vw,30px)] font-medium tracking-[-0.02em] text-balance"
          >
            {t("dH")}
          </h2>
        </div>
        <div className="text-body text-[15px] leading-[1.6]">
          <p className="text-pretty">{t("d1")}</p>
          <p className="mt-3 text-pretty">{t("d2")}</p>
          <Link
            href="/attributions#modeled"
            className="text-accent hover:text-accent-soft mt-3.5 inline-block min-h-11 leading-[44px]"
          >
            {t("attr")} →
          </Link>
        </div>
      </div>
    </section>
  );
}
