"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useContext, useEffect, useState } from "react";
import { useRegion } from "@/components/RegionProvider";
import {
  Caveats,
  Group,
  PanelFrame,
  PanelVariant,
  Row,
  useFormat,
} from "@/components/panel/parts";
import {
  loadNet,
  loadNets,
  loadSection,
  peekNet,
  peekSection,
} from "@/lib/flow/data";
import { FlowControlBar } from "./FlowControls";
import { FlowZoomHint } from "./FlowZoomHint";
import type { FlowNetPub } from "@/lib/flow/net-pub-schema";
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

  // The section's published net, if any; undefined until known (no note shown meanwhile).
  const [netLoaded, setNetLoaded] = useState<{
    id: string;
    net: FlowNetPub | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadNets(region)
      .then((m) => (m.ids.includes(id) ? loadNet(region, id) : null))
      .then((net) => {
        if (alive) setNetLoaded({ id, net });
      });
    return () => {
      alive = false;
    };
  }, [region, id]);
  const cached = peekNet(region, id);
  const net = cached ?? (netLoaded?.id === id ? netLoaded.net : null);
  const netKnown = cached !== undefined || netLoaded?.id === id;

  return (
    <PanelFrame
      label={t("label")}
      busy={!section && !failed}
      onClose={exitFlow}
    >
      {!section && !failed && <p className="text-muted pr-8">{t("loading")}</p>}
      {failed && <p className="pr-8">{t("error")}</p>}
      {section && (
        <SectionDetails
          section={section}
          net={netKnown ? (net ?? null) : undefined}
        />
      )}
    </PanelFrame>
  );
}

/** Branches by kind and whether any node splits the flow (two or more branches leave it). */
function netFacts(net: FlowNetPub) {
  const out = new Map<number, number>();
  for (const b of net.branches) out.set(b.from, (out.get(b.from) ?? 0) + 1);
  return {
    channels: net.branches.filter((b) => b.kind === "channel").length,
    split: [...out.values()].some((n) => n >= 2),
    reservoirs: net.reservoirs.length,
  };
}

/** net: undefined while it loads, null for a section with no net (the single F1 track). */
function SectionDetails({
  section,
  net,
}: {
  section: FlowSection;
  net: FlowNetPub | null | undefined;
}) {
  const t = useTranslations("flow");
  const f = useFormat();
  const fmt = useFormatter();
  const floating = useContext(PanelVariant) === "floating";
  const facts = net ? netFacts(net) : null;
  const day = (d: string) =>
    fmt.dateTime(new Date(d), { dateStyle: "medium", timeZone: "UTC" });
  const { discharge, channel } = section;
  const usesFill = section.stations.gap.some((g) => g === 1);

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2
          className={`font-display leading-tight font-normal ${
            floating ? "text-[26px]" : "text-xl"
          }`}
        >
          {section.riverName}
        </h2>
        <p className="text-muted text-sm">
          {t("sectionOf", { k: section.index + 1, n: section.count })}
        </p>
      </header>

      {floating && (
        <div className="flex flex-col gap-2">
          <FlowZoomHint />
          <FlowControlBar />
        </div>
      )}

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
      </Group>

      <details className="text-muted flex flex-col gap-1 text-xs">
        <summary className="hover:text-text cursor-pointer py-1">
          {t("notes")}
        </summary>
        <div className="flex flex-col gap-1.5 pt-1">
          {usesFill && <p>{t("channel.gap")}</p>}
          {net !== undefined && (
            <p>
              {net && facts
                ? t(
                    facts.channels > 0
                      ? "channel.network"
                      : "channel.reservoirOnly",
                    {
                      from: day(net.source.dates[0]),
                      to: day(net.source.dates[1]),
                      count: facts.channels,
                    },
                  )
                : t("channel.singleTrack")}
            </p>
          )}
          {facts && facts.reservoirs > 0 && <p>{t("channel.reservoir")}</p>}
          {facts?.split && <p>{t("channel.shares")}</p>}
          <p>{t("speedNote")}</p>
          <p>{t("imagery")}</p>
        </div>
      </details>

      <Caveats caveats={["discharge", "regulation"]} />
    </>
  );
}
