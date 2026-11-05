"use client";

import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { Popup } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useRegion } from "@/components/RegionProvider";
import { plumeReachAt } from "@/components/effluent/EffluentController";
import { hasEffluent } from "@/lib/effluent/overlay";
import { formatQuantity } from "@/lib/units";
import type { ReachResult } from "@/lib/effluent/river";
import { useEffluentRun } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";

/** True on devices whose primary pointer cannot hover: a tap there shows the card. */
export const isTouchOnly = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

/**
 * The card on a plume reach: the minimum DO and the BOD and coliforms at the reach's downstream
 * end, with the km from the outfall. Desktop shows it on hover; a touch device on a tap (MapView
 * leaves such a tap to this card instead of moving the outfall). Renders nothing.
 */
export function EffluentHoverCard({ map }: { map: MapLibreMap | null }) {
  const region = useRegion();
  const run = useEffluentRun();
  const t = useTranslations("effluent.card");
  const locale = useLocale();
  const units = useMapStore((s) => s.units);
  const effluentOn = useMapStore((s) => s.effluent !== null);

  useEffect(() => {
    if (!map || !hasEffluent(region) || !effluentOn || run.status !== "ok")
      return;
    const f = (q: "km", v: number) => formatQuantity(locale, q, v, units);
    const num = (n: number) =>
      new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(n);
    const rows = (r: ReachResult): [string, string][] => [
      [t("range", { from: f("km", r.kmStart), to: f("km", r.kmEnd) }), ""],
      [t("minDo"), t("mgL", { n: num(r.doMinMgL) })],
      [t("bodEnd"), t("mgL", { n: num(r.end.bodMgL) })],
      [
        t("coliformsEnd"),
        r.end.coliformsPer100mL === null
          ? t("notSimulated")
          : t("per100mL", { n: num(r.end.coliformsPer100mL) }),
      ],
    ];
    const path = new Map(run.result.path.map((r) => [r.id, r]));
    const tip = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "locality-tip effluent-tip",
    });
    const show = (e: MapMouseEvent) => {
      const id = plumeReachAt(map, e.point.x, e.point.y);
      const reach = id === null ? undefined : path.get(id);
      if (!reach) {
        tip.remove();
        return;
      }
      // Text nodes only: nothing from the data is parsed as markup.
      const root = document.createElement("div");
      for (const [label, value] of rows(reach)) {
        const row = document.createElement("div");
        row.append(label);
        if (value) {
          const v = document.createElement("strong");
          v.textContent = value;
          row.append(": ", v);
        } else {
          row.className = "effluent-tip-head";
        }
        root.append(row);
      }
      tip.setLngLat(map.unproject(e.point)).setDOMContent(root).addTo(map);
    };
    const onMove = (e: MapMouseEvent) => {
      if (!isTouchOnly()) show(e);
    };
    const onClick = (e: MapMouseEvent) => {
      if (isTouchOnly()) show(e);
    };
    const hide = () => tip.remove();
    map.on("mousemove", onMove);
    map.on("click", onClick);
    map.getCanvas().addEventListener("mouseleave", hide);
    return () => {
      map.off("mousemove", onMove);
      map.off("click", onClick);
      try {
        map.getCanvas().removeEventListener("mouseleave", hide);
      } catch {
        // The map was already removed.
      }
      tip.remove();
    };
  }, [map, region, effluentOn, run, t, locale, units]);

  return null;
}
