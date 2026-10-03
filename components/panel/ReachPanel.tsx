"use client";

import { useTranslations } from "next-intl";
import type { ReachResponse } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import { Caveats, Group, Row, useFormat } from "./parts";

function flowRegime(r: ReachResponse) {
  if (r.nonPerennial1d === null) return "unknown";
  return r.nonPerennial1d === 1 ? "nonPerennial" : "perennial";
}

export function ReachPanel({ reach }: { reach: ReachResponse }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const select = useMapStore((s) => s.select);
  const river = reach.river;

  return (
    <>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-lg leading-tight font-semibold">
          {river && reach.riverName
            ? t("reach.titleOf", { river: reach.riverName })
            : (reach.ign?.name ?? t("reach.title"))}
        </h2>
        <p className="text-muted text-sm">{t("reach.id", { id: reach._id })}</p>
        {reach.ign && (
          <p className="text-muted text-xs">
            {reach.ign.reviewed
              ? t("reach.ignNameReviewed")
              : t("reach.ignName", { confidence: reach.ign.confidence })}
          </p>
        )}
        {river && reach.riverName && (
          <button
            type="button"
            className="self-start text-sm underline decoration-dotted underline-offset-2"
            onClick={() => select({ kind: "river", id: river }, { fit: true })}
          >
            {t("reach.showRiver", { river: reach.riverName })}
          </button>
        )}
        {reach.network === "endorheic" && (
          <p className="text-warning text-xs">{t("reach.endorheic")}</p>
        )}
      </header>

      <Group title={t("groups.reach")}>
        <Row label={t("fields.length")}>{f("km", reach.lengthKm)}</Row>
        <Row label={t("fields.distanceToSea")}>
          {f("km", reach.distanceToSeaKm)}
        </Row>
        <Row label={t("fields.catchmentMinElevation")}>
          {f("m", reach.catchmentMinElevationM)}
        </Row>
        <Row label={t("fields.gradient")}>
          {f("mPerKm", reach.gradientMPerKm)}
        </Row>
        <Row label={t("fields.strahler")}>{reach.strahler}</Row>
        <Row label={t("fields.discharge")} modeled>
          {f("m3s", reach.dischargeM3s)}
        </Row>
        <Row label={t("fields.flowRegime")} modeled>
          {t("fields.flowRegimeValue", { regime: flowRegime(reach) })}
          {reach.nonPerennialProb1d !== null && (
            <span className="text-muted block text-xs font-normal">
              {t("fields.probability", {
                pct: f("pct", reach.nonPerennialProb1d * 100),
              })}
            </span>
          )}
        </Row>
      </Group>

      <Group
        title={t("groups.watershed")}
        hint={t("groups.watershedHint", { place: "reach" })}
      >
        <Row label={t("fields.drainageArea")}>{f("km2", reach.uplandKm2)}</Row>
        <Row label={t("fields.flooded")} modeled>
          {t("fields.floodedValue", {
            min: f("pct", reach.upstreamFloodedMinPct),
            max: f("pct", reach.upstreamFloodedMaxPct),
          })}
        </Row>
        <Row label={t("fields.lakes")}>{f("pct", reach.upstreamLakesPct)}</Row>
        <Row label={t("fields.population")} modeled>
          {f("count", reach.upstreamPopulation)}
        </Row>
        <Row label={t("fields.regulation")} modeled>
          {f("pct", reach.regulationPct)}
        </Row>
      </Group>

      <Caveats
        caveats={[
          "discharge",
          "nonPerennial",
          "flooded",
          "population",
          "regulation",
        ]}
      />
    </>
  );
}
