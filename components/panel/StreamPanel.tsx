"use client";

import { useTranslations } from "next-intl";
import type { StreamResponse } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import {
  CAVEAT_BY_PATH,
  Caveats,
  Group,
  Row,
  useFormat,
  useSeaDistance,
} from "./parts";
import { useSubbasinLabel } from "./subbasin-label";

/**
 * An IGN stream (pipeline:ign-streams): the name is IGN's; the values are those of its
 * mouth reach, as for a river. Same parts as the river panel.
 */
export function StreamPanel({ stream }: { stream: StreamResponse }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const seaDistance = useSeaDistance();
  const label = useSubbasinLabel();
  const select = useMapStore((s) => s.select);
  const modeled = (path: string) => stream.modeled.includes(path);
  const caveats = CAVEAT_BY_PATH.filter(([path]) => modeled(path)).map(
    ([, c]) => c,
  );
  const link =
    "underline decoration-dotted underline-offset-2 hover:text-(--foreground)";

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-base leading-tight font-semibold">{stream.name}</h2>
        <p className="text-muted text-sm">{t("stream.title")}</p>
        {stream.receivingRiverRef && (
          <p className="text-muted text-sm">
            {t("river.flowsInto")}{" "}
            <button
              type="button"
              className={link}
              onClick={() =>
                select(
                  { kind: "river", id: stream.receivingRiverRef!.id },
                  { fit: true },
                )
              }
            >
              {stream.receivingRiverRef.name}
            </button>
          </p>
        )}
        {stream.subbasinRef && (
          <p className="text-muted text-sm">
            {t("stream.inSubbasin")}{" "}
            <button
              type="button"
              className={link}
              onClick={() =>
                select(
                  { kind: "subbasin", id: stream.subbasinRef!.id },
                  { fit: true },
                )
              }
            >
              {label(stream.subbasinRef)}
            </button>
          </p>
        )}
        <p className="text-muted text-xs">{t("stream.nameNote")}</p>
      </header>

      <Group title={t("groups.course")}>
        <Row label={t("fields.length")}>{f("km", stream.lengthKm)}</Row>
        <Row label={t("fields.reachCount")}>{stream.reachCount}</Row>
        <Row label={t("fields.distanceToSea")}>
          {seaDistance(stream.mouth.distanceToSeaKm, stream.mouthKind)}
        </Row>
        <Row label={t("fields.mouthElevation")}>
          {f("m", stream.mouth.elevationM)}
        </Row>
        <Row label={t("fields.strahler")}>{stream.mouth.strahler}</Row>
        <Row
          label={t("fields.discharge")}
          modeled={modeled("mouth.dischargeM3s")}
        >
          {f("m3s", stream.mouth.dischargeM3s)}
        </Row>
      </Group>

      <Group
        title={t("groups.watershed")}
        hint={t("groups.watershedHint", { place: "mouth" })}
      >
        <Row label={t("fields.drainageArea")}>
          {f("km2", stream.mouth.uplandKm2)}
        </Row>
        <Row
          label={t("fields.flooded")}
          modeled={modeled("watershed.floodedMaxPct")}
        >
          {t("fields.floodedValue", {
            min: f("pct", stream.watershed.floodedMinPct),
            max: f("pct", stream.watershed.floodedMaxPct),
          })}
        </Row>
        <Row label={t("fields.lakes")}>
          {f("pct", stream.watershed.lakesPct)}
        </Row>
        <Row
          label={t("fields.population")}
          modeled={modeled("watershed.population")}
        >
          {f("count", stream.watershed.population)}
        </Row>
        <Row
          label={t("fields.regulation")}
          modeled={modeled("mouth.regulationPct")}
        >
          {f("pct", stream.mouth.regulationPct)}
        </Row>
      </Group>

      <Caveats caveats={caveats} />
    </>
  );
}
