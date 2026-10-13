"use client";

import { useTranslations } from "next-intl";
import {
  BASE_LAYER_STORAGE_KEY,
  BASE_LAYERS,
  type BaseLayer,
  useMapStore,
} from "@/lib/store";
import { Icon } from "./Icon";

/** Satellite or the OpenStreetMap map under the mask; remembered in localStorage. */
export function BaseLayerToggle() {
  const t = useTranslations("options.baseLayer");
  const baseLayer = useMapStore((s) => s.baseLayer);
  const setBaseLayer = useMapStore((s) => s.setBaseLayer);

  function choose(next: BaseLayer) {
    setBaseLayer(next);
    try {
      localStorage.setItem(BASE_LAYER_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 flex items-center gap-2 font-medium">
        <Icon name="layers" />
        {t("label")}
      </legend>
      <div className="flex rounded-md border border-(--border) p-0.5">
        {BASE_LAYERS.map((b) => (
          <label
            key={b}
            className={`flex-1 cursor-pointer rounded px-2 py-1 text-center has-focus-visible:outline-2 has-focus-visible:outline-(--accent) ${
              baseLayer === b ? "bg-(--panel-hover) font-medium" : "text-muted"
            }`}
          >
            <input
              type="radio"
              name="base-layer"
              value={b}
              checked={baseLayer === b}
              onChange={() => choose(b)}
              className="sr-only"
            />
            {t(b)}
          </label>
        ))}
      </div>
      {baseLayer === "map" && <p className="text-muted text-xs">{t("note")}</p>}
    </fieldset>
  );
}
