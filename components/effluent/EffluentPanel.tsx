"use client";

import { useTranslations } from "next-intl";
import { useRegion } from "@/components/RegionProvider";
import { PanelFrame } from "@/components/panel/parts";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useEffluentRun } from "@/lib/effluent/use-run";
import { useMapStore } from "@/lib/store";

/**
 * The panel of the discharge being simulated, in place of the info panel while effluent mode is
 * on. A shell for now: the outfall picker and the run's status; inputs and results come later.
 */
export function EffluentPanel() {
  const t = useTranslations("effluent");
  const region = useRegion();
  const reach = useMapStore((s) => s.effluent?.reach ?? null);
  const moveOutfall = useMapStore((s) => s.moveOutfall);
  const exitEffluent = useMapStore((s) => s.exitEffluent);
  const run = useEffluentRun();
  const data = getEffluentRegion(region);
  if (!data || reach === null) return null;
  const outfalls = data.config.outfalls;
  const configured = outfalls.some((o) => o.reach === reach);

  return (
    <PanelFrame
      label={t("title")}
      busy={run.status === "loading"}
      onClose={exitEffluent}
    >
      <header className="flex flex-col gap-2 pr-8">
        <h2 className="font-display text-[26px] leading-tight font-normal">
          {t("title")}
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">{t("outfall")}</span>
          <select
            className="border-line bg-panel-glass min-h-10 rounded-md border px-2 text-sm"
            value={reach}
            onChange={(e) => moveOutfall(Number(e.target.value))}
          >
            {outfalls.map((o) => (
              <option key={o.id} value={o.reach}>
                {o.name}
              </option>
            ))}
            {!configured && (
              <option value={reach}>{t("customReach", { id: reach })}</option>
            )}
          </select>
        </label>
      </header>
      {run.status === "loading" && <p className="text-muted">{t("loading")}</p>}
      {run.status === "unavailable" && (
        <p className="text-warning">{t("unavailable")}</p>
      )}
      {run.status === "ok" && run.result.summary.entersLake && (
        <p className="text-muted">
          {t("entersLake", { lake: data.net.lake.name })}
        </p>
      )}
    </PanelFrame>
  );
}
