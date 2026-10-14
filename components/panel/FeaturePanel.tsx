"use client";

import { useTranslations } from "next-intl";
import type { RiverResponse } from "@/lib/data/queries";
import type { Picked } from "@/lib/map/picked";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Group, PanelFrame, Row, useFormat } from "./parts";

/**
 * A lake, dam, locality, IGN detail line or unmatched line piece the user clicked. These features have no API
 * document: the panel shows what the tile carries (name, length or area) and says what
 * is not available, rather than inventing hydrology.
 */
export function FeaturePanel({ picked }: { picked: Picked }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const pick = useMapStore((s) => s.pick);
  // A piece on an approved river's course takes the river's display name as its title.
  const riverId = picked.kind === "line" ? (picked.river ?? null) : null;
  const river = useApi<RiverResponse>(
    riverId ? `/api/rivers/${encodeURIComponent(riverId)}` : null,
  );
  const riverName = river.status === "ok" ? river.data.name : null;
  // The name the source gives a piece that follows the river's channel under another name
  // (tile property srcName, set by pipeline:export), not a comparison with the river's name.
  const sourceName = picked.kind === "line" ? (picked.srcName ?? null) : null;
  const fillForm = picked.kind === "line" ? (picked.form ?? null) : null;

  // ICU select keys can't contain a hyphen.
  const waterKind =
    picked.kind === "water" && picked.waterKind === "controlled-lake"
      ? "controlledLake"
      : picked.kind === "water"
        ? picked.waterKind
        : "";
  const title = (() => {
    switch (picked.kind) {
      case "detail":
        return picked.name ?? t("feature.detail.unnamed");
      case "line":
        return riverName ?? picked.name ?? t("feature.line.unnamed");
      case "water":
        return picked.name ?? t("feature.water.unnamed", { kind: waterKind });
      case "dam":
      case "wall":
        return picked.name ?? t("feature.dam.unnamed");
      case "locality":
        return picked.name;
    }
  })();
  const subtitle =
    picked.kind === "detail"
      ? t("feature.detail.title")
      : picked.kind === "line"
        ? fillForm === "route"
          ? t("feature.line.fillRoute")
          : fillForm === "connector"
            ? t("feature.line.fillConnector")
            : t("feature.line.title")
        : picked.kind === "water"
          ? t("feature.water.kind", { kind: waterKind })
          : picked.kind === "wall"
            ? t("feature.dam.wall")
            : picked.kind === "locality"
              ? t("feature.locality.place", { place: picked.place })
              : t("feature.dam.title");
  const note =
    picked.kind === "detail"
      ? t("feature.detail.note")
      : picked.kind === "line"
        ? fillForm === "route"
          ? t("feature.line.fillRouteNote")
          : fillForm === "connector"
            ? t("feature.line.fillConnectorNote")
            : t("feature.line.note")
        : picked.kind === "water"
          ? t("feature.water.note")
          : picked.kind === "locality"
            ? t("feature.locality.note")
            : t("feature.dam.note");

  return (
    <PanelFrame label={t("feature.label")} onClose={() => pick(null)}>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {title}
        </h2>
        <p className="text-muted text-sm">{subtitle}</p>
        {sourceName && (
          <p className="text-muted text-xs">
            {t("feature.line.sourceName", { name: sourceName })}
          </p>
        )}
        {picked.kind === "line" && picked.review && (
          <p className="text-warning text-xs">{t("feature.line.review")}</p>
        )}
      </header>
      {(picked.kind === "detail" ||
        picked.kind === "line" ||
        (picked.kind === "water" && picked.areaKm2 !== null)) && (
        <Group title={t("feature.group")}>
          {(picked.kind === "detail" || picked.kind === "line") && (
            <Row label={t("feature.fields.length")}>{f("km", picked.km)}</Row>
          )}
          {picked.kind === "water" && picked.areaKm2 !== null && (
            <Row
              label={
                picked.areaSource === "aprhi"
                  ? t("feature.water.areaAprhi")
                  : picked.areaSource === "ign"
                    ? t("feature.water.areaIgn")
                    : t("feature.water.areaHydrolakes")
              }
            >
              {f("km2", picked.areaKm2)}
            </Row>
          )}
        </Group>
      )}
      <footer className="text-muted flex flex-col gap-1 border-t border-(--border) pt-3 text-xs">
        <p>{note}</p>
        {fillForm !== "connector" && (
          <p>
            {picked.kind === "locality"
              ? t("feature.locality.source")
              : picked.kind === "line" && picked.source === "hydrorivers"
                ? t("feature.sourceHydrorivers")
                : (picked.kind === "water" && picked.areaSource === "aprhi") ||
                    (picked.kind === "line" && picked.source === "aprhi")
                  ? t("feature.sourceAprhi")
                  : t("feature.source")}
          </p>
        )}
      </footer>
    </PanelFrame>
  );
}
