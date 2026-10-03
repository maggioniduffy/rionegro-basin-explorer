"use client";

import { useTranslations } from "next-intl";
import type { RiverResponse } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import { type Caveat, Caveats, Group, Row, useFormat } from "./parts";

/** Modeled value path (River.modeled) → the caveat that explains it. */
const CAVEAT_BY_PATH: [string, Caveat][] = [
  ["mouth.dischargeM3s", "discharge"],
  ["nonPerennialPct", "nonPerennial"],
  ["watershed.floodedMaxPct", "flooded"],
  ["watershed.population", "population"],
  ["mouth.regulationPct", "regulation"],
];

export function RiverPanel({ river }: { river: RiverResponse }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const select = useMapStore((s) => s.select);
  const modeled = (path: string) => river.modeled.includes(path);
  const caveats = CAVEAT_BY_PATH.filter(([path]) => modeled(path)).map(
    ([, c]) => c,
  );

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-lg leading-tight font-semibold">{river.name}</h2>
        <p className="text-muted text-sm">
          {t("river.flowsInto")}{" "}
          {river.flowsInto === "sea" ? (
            t("river.sea")
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
        {river.nameConfidence === "weak" && (
          <p className="text-warning text-xs">{t("river.weakName")}</p>
        )}
      </header>

      <Group title={t("groups.course")}>
        <Row label={t("fields.length")}>{f("km", river.lengthKm)}</Row>
        <Row label={t("fields.distanceToSea")}>
          {f("km", river.mouth.distanceToSeaKm)}
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
