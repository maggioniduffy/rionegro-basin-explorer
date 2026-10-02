"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FLOW_CLASSES, FLOW_STYLE } from "@/lib/map/style";
import { useMapStore } from "@/lib/store";
import { Icon } from "./Icon";
import { Swatch } from "./Legend";

export function Toggle({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-2 ${disabled ? "text-muted" : ""}`}
    >
      <input
        type="checkbox"
        className="accent-sky-400"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/**
 * Show or hide the water layers: HydroRIVERS reaches (all, or by GIRES flow class) and
 * lakes, natural or artificial; and the OSM localities. A hidden feature can't be
 * clicked either.
 */
export function LayerToggles() {
  const t = useTranslations("options.layers");
  const tLegend = useTranslations("legend");
  const layers = useMapStore((s) => s.layers);
  const setLayers = useMapStore((s) => s.setLayers);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 flex items-center gap-2 font-medium">
        <Icon name="layers" />
        {t("title")}
      </legend>

      <Toggle
        checked={layers.rivers}
        onChange={(rivers) => setLayers({ rivers })}
      >
        <Icon name="river" />
        {t("rivers")}
      </Toggle>
      <div className="flex flex-col gap-1.5 pl-6">
        {FLOW_CLASSES.map((c) => (
          <Toggle
            key={c}
            checked={layers.flow[c]}
            disabled={!layers.rivers}
            onChange={(v) => setLayers({ flow: { ...layers.flow, [c]: v } })}
          >
            <Swatch {...FLOW_STYLE[c]} />
            {tLegend(c)}
          </Toggle>
        ))}
        <p className="text-muted text-xs">{t("flowHint")}</p>
      </div>

      <Toggle
        checked={layers.naturalLakes}
        onChange={(naturalLakes) => setLayers({ naturalLakes })}
      >
        {t("naturalLakes")}
      </Toggle>
      <Toggle
        checked={layers.artificialLakes}
        onChange={(artificialLakes) => setLayers({ artificialLakes })}
      >
        {t("artificialLakes")}
      </Toggle>
      <Toggle
        checked={layers.localities}
        onChange={(localities) => setLayers({ localities })}
      >
        {t("localities")}
      </Toggle>
    </fieldset>
  );
}
