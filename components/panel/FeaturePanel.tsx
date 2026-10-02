"use client";

import { useTranslations } from "next-intl";
import type { Picked } from "@/lib/map/picked";
import { useMapStore } from "@/lib/store";
import { Group, PanelFrame, Row, useFormat } from "./parts";

/**
 * A lake, dam or IGN detail line the user clicked. These features have no API document:
 * the panel shows what the tile carries (name, length or area) and says what is not
 * available, rather than inventing hydrology.
 */
export function FeaturePanel({ picked }: { picked: Picked }) {
  const t = useTranslations("panel");
  const f = useFormat();
  const pick = useMapStore((s) => s.pick);

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
      case "water":
        return picked.name ?? t("feature.water.unnamed", { kind: waterKind });
      case "dam":
      case "wall":
        return picked.name ?? t("feature.dam.unnamed");
    }
  })();
  const subtitle =
    picked.kind === "detail"
      ? t("feature.detail.title")
      : picked.kind === "water"
        ? t("feature.water.kind", { kind: waterKind })
        : picked.kind === "wall"
          ? t("feature.dam.wall")
          : t("feature.dam.title");
  const note =
    picked.kind === "detail"
      ? t("feature.detail.note")
      : picked.kind === "water"
        ? t("feature.water.note")
        : t("feature.dam.note");

  return (
    <PanelFrame label={t("feature.label")} onClose={() => pick(null)}>
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-lg leading-tight font-semibold">{title}</h2>
        <p className="text-muted text-sm">{subtitle}</p>
      </header>
      {(picked.kind === "detail" ||
        (picked.kind === "water" && picked.areaKm2 !== null)) && (
        <Group title={t("feature.group")}>
          {picked.kind === "detail" && (
            <Row label={t("feature.fields.length")}>{f("km", picked.km)}</Row>
          )}
          {picked.kind === "water" && picked.areaKm2 !== null && (
            <Row
              label={
                picked.areaSource === "ign"
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
        <p>{t("feature.source")}</p>
      </footer>
    </PanelFrame>
  );
}
