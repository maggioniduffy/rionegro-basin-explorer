import { getTranslations } from "next-intl/server";

const FEATURES = [
  ["01", "f1h", "f1p"],
  ["02", "f2h", "f2p"],
  ["03", "f3h", "f3p"],
] as const;

/** "What you can explore": three numbered columns, copy only. */
export async function ExploreCards() {
  const t = await getTranslations("landing");
  return (
    <section
      id="explore"
      aria-labelledby="explore-title"
      className="mx-auto max-w-[1200px] scroll-mt-6 px-[clamp(20px,5vw,64px)] py-[clamp(56px,8vw,112px)]"
    >
      <h2
        id="explore-title"
        className="font-display m-0 max-w-[12em] text-[clamp(34px,4.6vw,60px)] leading-[1.05] font-normal tracking-[-0.015em] text-balance"
      >
        {t("exH")}
      </h2>
      <div className="mt-[clamp(36px,5vw,64px)] grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-12 gap-y-10">
        {FEATURES.map(([n, h, p]) => (
          <div key={n} className="border-text border-t pt-5">
            <div className="text-accent font-mono text-[13px]">{n}</div>
            <h3 className="mt-3.5 text-xl font-medium tracking-[-0.01em]">
              {t(h)}
            </h3>
            <p className="text-secondary mt-2.5 text-[15px] leading-[1.6] text-pretty">
              {t(p)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
