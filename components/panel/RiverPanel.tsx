"use client";

import { useTranslations } from "next-intl";
import { isMouthKind } from "@/lib/data/mouth";
import type { RiverResponse } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import {
  CAVEAT_BY_PATH,
  Caveats,
  Group,
  Row,
  useFormat,
  useSeaDistance,
} from "./parts";

export function RiverPanel({ river }: { river: RiverResponse }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const seaDistance = useSeaDistance();
  const select = useMapStore((s) => s.select);
  const modeled = (path: string) => river.modeled.includes(path);
  const caveats = CAVEAT_BY_PATH.filter(([path]) => modeled(path)).map(
    ([, c]) => c,
  );

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {river.name}
        </h2>
        <p className="text-muted text-sm">
          {t("river.flowsInto")}{" "}
          {river.flowsInto === "sea" ? (
            t("river.sea")
          ) : river.flowsInto === "sink" ? (
            t("river.sink")
          ) : river.flowsInto === "region-edge" ? (
            t("river.regionEdge")
          ) : (
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2 hover:text-(--foreground)"
              onClick={() =>
                select({ kind: "river", id: river.flowsInto }, { fit: true })
              }
            >
              {river.flowsIntoName ?? river.flowsInto}
            </button>
          )}
        </p>
        {!isMouthKind(river.flowsInto) && river.mouthKind === "sink" && (
          <p className="text-muted text-xs">{t("river.endsInSink")}</p>
        )}
        {!isMouthKind(river.flowsInto) && river.mouthKind === "region-edge" && (
          <p className="text-muted text-xs">{t("river.endsAtEdge")}</p>
        )}
        {river.nameConfidence === "weak" && (
          <p className="text-warning text-xs">{t("river.weakName")}</p>
        )}
      </header>

      <Group title={t("groups.course")}>
        <Row label={t("fields.length")}>{f("km", river.lengthKm)}</Row>
        <Row label={t("fields.distanceToSea")}>
          {seaDistance(river.mouth.distanceToSeaKm, river.mouthKind)}
        </Row>
        <Row
          label={
            river.source.kind === "confluence"
              ? t("fields.sourceElevationConfluence")
              : t("fields.sourceElevation")
          }
        >
          {f("m", river.source.elevationM)}
        </Row>
        <Row label={t("fields.mouthElevation")}>
          {f("m", river.mouth.elevationM)}
        </Row>
        <Row label={t("fields.drop")}>{f("m", river.dropM)}</Row>
        <Row label={t("fields.gradient")}>
          {f("mPerKm", river.gradientMPerKm)}
        </Row>
        <Row label={t("fields.strahler")}>{river.mouth.strahler}</Row>
        <Row
          label={t("fields.discharge")}
          modeled={modeled("mouth.dischargeM3s")}
        >
          {f("m3s", river.mouth.dischargeM3s)}
        </Row>
        <Row
          label={t("fields.nonPerennial")}
          modeled={modeled("nonPerennialPct")}
        >
          {f("pct", river.nonPerennialPct)}
          {river.unknownPct > 0 && (
            <span className="text-muted block text-xs font-normal">
              {t("fields.noPrediction", { pct: f("pct", river.unknownPct) })}
            </span>
          )}
        </Row>
      </Group>

      <Group
        title={t("groups.watershed")}
        hint={t("groups.watershedHint", { place: "mouth" })}
      >
        <Row label={t("fields.drainageArea")}>
          {f("km2", river.mouth.uplandKm2)}
        </Row>
        <Row
          label={t("fields.flooded")}
          modeled={modeled("watershed.floodedMaxPct")}
        >
          {t("fields.floodedValue", {
            min: f("pct", river.watershed.floodedMinPct),
            max: f("pct", river.watershed.floodedMaxPct),
          })}
        </Row>
        <Row label={t("fields.lakes")}>
          {f("pct", river.watershed.lakesPct)}
        </Row>
        <Row
          label={t("fields.population")}
          modeled={modeled("watershed.population")}
        >
          {f("count", river.watershed.population)}
        </Row>
        <Row
          label={t("fields.regulation")}
          modeled={modeled("mouth.regulationPct")}
        >
          {f("pct", river.mouth.regulationPct)}
        </Row>
      </Group>

      <Caveats caveats={caveats} />
    </>
  );
}
