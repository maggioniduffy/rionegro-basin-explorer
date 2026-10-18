"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRegion } from "@/components/RegionProvider";
import {
  Caveats,
  Group,
  PanelFrame,
  Row,
  useFormat,
} from "@/components/panel/parts";
import { loadSection, peekSection } from "@/lib/flow/data";
import type { FlowIndex, FlowReason, FlowSection } from "@/lib/flow/schema";
import { useMapStore } from "@/lib/store";

/** The most common reason a river's sections can't be shown, or null if it has none to explain. */
function mostCommonReason(index: FlowIndex, slug: string): FlowReason | null {
  const river = index.rivers.find((r) => r.slug === slug);
  if (!river || river.sections.some((s) => s.flowable)) return null;
  const counts = new Map<FlowReason, number>();
  for (const s of river.sections)
    if (s.reason) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  let best: FlowReason | null = null;
  let bestN = 0;
  for (const [reason, n] of counts)
    if (n > bestN) {
      best = reason;
      bestN = n;
    }
  return best;
}

/** Why a river in the flow index has no flow view; nothing for a river that has one or isn't indexed. */
export function NoFlowNote({
  index,
  slug,
}: {
  index: FlowIndex;
  slug: string;
}) {
  const t = useTranslations("flow");
  const reason = mostCommonReason(index, slug);
  if (!reason) return null;
  return <p className="text-muted text-xs">{t("noFlow", { reason })}</p>;
}

type Loaded = { id: string; section: FlowSection | null } | null;

/** The panel of the section being shown, in place of the info panel while flow mode is on. */
export function FlowPanel({ id }: { id: string }) {
  const t = useTranslations("flow");
  const region = useRegion();
  const exitFlow = useMapStore((s) => s.exitFlow);
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let alive = true;
    void loadSection(region, id).then((section) => {
      if (alive) setLoaded({ id, section });
    });
    return () => {
      alive = false;
    };
  }, [region, id]);
  // Keep the previous section's text while the next loads (panning switches often).
  const section =
    peekSection(region, id) ?? (loaded?.id === id ? loaded.section : null);
  const failed = loaded?.id === id && loaded.section === null && !section;

  return (
    <PanelFrame
      label={t("label")}
      busy={!section && !failed}
      onClose={exitFlow}
    >
      {!section && !failed && <p className="text-muted pr-8">{t("loading")}</p>}
      {failed && <p className="pr-8">{t("error")}</p>}
      {section && <SectionDetails section={section} />}
    </PanelFrame>
  );
}

function SectionDetails({ section }: { section: FlowSection }) {
  const t = useTranslations("flow");
  const f = useFormat();
  const { discharge, channel } = section;
  const usesFill = section.stations.gap.some((g) => g === 1);

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {section.riverName}
        </h2>
        <p className="text-muted text-sm">
          {t("sectionOf", { k: section.index + 1, n: section.count })}
        </p>
      </header>

      <Group title={t("discharge")}>
        <Row label={t("discharge")} modeled={discharge?.kind === "modeled"}>
          {discharge ? f("m3s", discharge.value) : t("noDischarge")}
          {discharge && (
            <span className="text-muted block text-xs font-normal">
              {t(`kind.${discharge.kind}`)}
            </span>
          )}
        </Row>
        {discharge && (
          <p className="text-muted py-1.5 text-xs">
            {discharge.period
              ? t(
                  discharge.kind === "modeled"
                    ? "sourcePeriodModeled"
                    : "sourcePeriod",
                  { source: discharge.source, period: discharge.period },
                )
              : discharge.source}
          </p>
        )}
        {section.regulationPct !== null && (
          <Row label={t("regulation")} modeled>
            {f("pct", section.regulationPct)}
          </Row>
        )}
      </Group>

      <Group title={t("channel.title")}>
        <Row
          label={t("channel.width")}
          modeled={channel.source !== "ign-polygon"}
        >
          {channel.source === "none"
            ? t("channel.none")
            : t("channel.widthValue", {
                min: f("m", channel.widthM.min),
                max: f("m", channel.widthM.max),
                p50: f("m", channel.widthM.p50),
              })}
        </Row>
        <Row label={t("channel.source")}>{t(`channel.${channel.source}`)}</Row>
        {usesFill && (
          <p className="text-muted py-1.5 text-xs">{t("channel.gap")}</p>
        )}
      </Group>

      <p className="text-muted text-xs">{t("speedNote")}</p>

      <Caveats caveats={["discharge", "regulation"]} />
      <p className="text-muted -mt-2 text-xs">{t("imagery")}</p>
    </>
  );
}
