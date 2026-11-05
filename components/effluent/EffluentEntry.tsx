"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/Icon";
import { useRegion } from "@/components/RegionProvider";
import { hasEffluent } from "@/lib/effluent/overlay";
import { getEffluentRegion } from "@/lib/effluent/registry";
import { useMapStore } from "@/lib/store";

/**
 * The Map tab's entry to effluent mode with nothing selected: one button per configured outfall,
 * pressed while the simulation sits on that outfall's reach. Absent for a region without a simulator.
 */
export function EffluentEntry() {
  const t = useTranslations("effluent");
  const region = useRegion();
  const effluentReach = useMapStore((s) => s.effluent?.reach ?? null);
  const enterEffluent = useMapStore((s) => s.enterEffluent);
  if (!hasEffluent(region)) return null;
  const outfalls = getEffluentRegion(region)?.config.outfalls ?? [];
  if (outfalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-2 font-medium">
        <Icon name="downstream" />
        {t("title")}
      </h3>
      {outfalls.map((o) => {
        const active = effluentReach === o.reach;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) enterEffluent(o.reach);
            }}
            className={`flex min-h-10 items-center rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground) ${
              active
                ? "bg-accent text-on-accent font-medium"
                : "border-line border hover:bg-(--panel-hover)"
            }`}
          >
            {t("simulateAt", { name: o.name })}
          </button>
        );
      })}
      <p className="text-secondary text-xs">{t("entryHint")}</p>
    </div>
  );
}
