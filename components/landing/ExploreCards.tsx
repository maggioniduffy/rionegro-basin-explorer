import { getTranslations } from "next-intl/server";
import Image from "next/image";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon";
import { SampleValue } from "./SampleValue";
import type { RegionId } from "@/regions";
import { LANDING_SAMPLES } from "@/regions/generated";
import { LANDING_IMAGES } from "@/regions/images";

/** Chips shown before the "+N" overflow, as in the sub-basin panel. */
const CHIPS = 4;

function Card({
  icon,
  title,
  text,
  stage,
}: {
  icon: IconName;
  title: string;
  text: string;
  stage: ReactNode;
}) {
  return (
    <article className="bg-surface border-line-card flex flex-col overflow-hidden rounded-[14px] border">
      {/* A picture of the app's panels: decorative, the text below says what it does. */}
      <div aria-hidden className="relative h-60 overflow-hidden">
        {stage}
      </div>
      <div className="px-[22px] pt-5 pb-6">
        <h3 className="flex items-center gap-2.5 text-[19px] font-semibold">
          <Icon name={icon} size={24} className="text-accent shrink-0" />
          {title}
        </h3>
        <p className="text-secondary mt-2 text-[15px] leading-[1.55] text-pretty">
          {text}
        </p>
      </div>
    </article>
  );
}

function MockRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-line-faint flex justify-between gap-3 border-t py-1.5">
      <span className="text-secondary">{label}</span>
      <span className="text-text font-semibold tabular-nums">{children}</span>
    </div>
  );
}

const mockPanel =
  "bg-surface-raised border-line w-full rounded-[10px] border px-4 py-3.5 text-[13px]";

export async function ExploreCards({ region }: { region: RegionId }) {
  const basin = LANDING_IMAGES[region];
  const t = await getTranslations("landing");
  const fields = await getTranslations("panel.fields");
  const panel = await getTranslations("panel");
  const controls = await getTranslations("controls");
  const { river, subbasin } = LANDING_SAMPLES[region];
  const extra = subbasin.children.length - CHIPS;

  return (
    <section
      aria-labelledby="explore-title"
      className="mx-auto max-w-[1280px] px-[clamp(16px,4vw,40px)] py-[clamp(40px,7vw,96px)]"
    >
      <p className="text-tertiary font-mono text-xs tracking-[.14em] uppercase">
        {t("exTag")}
      </p>
      <h2
        id="explore-title"
        className="mt-3 text-[clamp(26px,3.6vw,44px)] font-medium tracking-[-0.025em]"
      >
        {t("exH")}
      </h2>
      <div className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
        <Card
          icon="river"
          title={t("f1h")}
          text={t("f1p")}
          stage={
            <div className="bg-stage flex h-full items-end p-[18px]">
              <div className={mockPanel}>
                <div className="text-base font-semibold">{river.name}</div>
                <div className="text-secondary mt-0.5 mb-2.5">
                  {panel("river.flowsInto")}{" "}
                  <span className="text-strong-muted underline">
                    {river.flowsInto.name}
                  </span>
                </div>
                <MockRow label={fields("length")}>
                  <SampleValue q="km" value={river.lengthKm} />
                </MockRow>
                <MockRow label={fields("strahler")}>{river.strahler}</MockRow>
                {river.dischargeM3s !== null && (
                  <MockRow label={`${fields("discharge")}*`}>
                    <SampleValue q="m3s" value={river.dischargeM3s} />
                  </MockRow>
                )}
              </div>
            </div>
          }
        />
        <Card
          icon="subbasin"
          title={t("f2h")}
          text={t("f2p")}
          stage={
            <div className="bg-stage flex h-full flex-col gap-3 p-[18px]">
              <div className="bg-surface-raised border-line flex overflow-hidden rounded-lg border text-[13px]">
                <span className="text-secondary flex-1 py-2 text-center">
                  {controls("viewBasin")}
                </span>
                <span className="bg-surface-active text-text flex-1 py-2 text-center font-semibold">
                  {controls("viewSubbasins")}
                </span>
              </div>
              <div className={`${mockPanel} flex-1`}>
                <div className="text-base font-semibold">
                  {panel("subbasin.title", { name: subbasin.name })}
                </div>
                <div className="text-secondary mt-1 flex items-center gap-0.5">
                  <span className="underline">{subbasin.parent.name}</span>
                  <span className="text-icon-muted px-1">›</span>
                  <span className="text-strong-muted">{subbasin.name}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {subbasin.children.slice(0, CHIPS).map((name) => (
                    <span
                      key={name}
                      className="border-line text-strong-muted rounded-full border px-[9px] py-1"
                    >
                      {name}
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="text-secondary px-[9px] py-1">
                      +{extra}
                    </span>
                  )}
                </div>
              </div>
            </div>
          }
        />
        <Card
          icon="mask"
          title={t("f3h")}
          text={t("f3p")}
          stage={
            <div className="h-full overflow-hidden bg-[#050706]">
              <Image
                src={basin}
                alt=""
                fill
                sizes="(max-width: 700px) 100vw, 400px"
                className="origin-[30%_45%] scale-[1.6] object-cover object-[30%_45%]"
              />
              <div className="bg-panel-glass border-line text-secondary absolute right-[18px] bottom-[18px] left-[18px] rounded-[10px] border px-3.5 py-3 text-xs">
                <div className="text-text mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Icon name="mask" className="text-accent shrink-0" />
                  {controls("visibleLand")}
                </div>
                <div className="bg-track relative h-1 rounded-sm">
                  <i className="bg-accent absolute inset-y-0 left-0 w-4/5 rounded-sm" />
                  <i className="bg-accent border-surface-raised absolute -top-1.5 left-4/5 -ml-2 size-4 rounded-full border-2" />
                </div>
                <div className="mt-2.5 flex justify-between">
                  <span>{controls("visibleLandMin")}</span>
                  <span>{controls("visibleLandMax")}</span>
                </div>
              </div>
            </div>
          }
        />
      </div>
      <p className="text-tertiary mt-3.5 text-xs">{t("sample")}</p>
    </section>
  );
}
