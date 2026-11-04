"use client";

import { useTranslations } from "next-intl";
import { useRegion } from "@/components/RegionProvider";
import { Icon } from "@/components/Icon";
import { hasEffluent, netReachIds } from "@/lib/effluent/overlay";
import { useMapStore } from "@/lib/store";

/**
 * The panels' entry to effluent mode: a filled pill like "View flow". For a reach outside the net
 * of a region that has one, a note instead; nothing for a region without a simulator or without a
 * known reach.
 */
export function SimulateButton({ reachId }: { reachId: number | null }) {
  const t = useTranslations("effluent");
  const region = useRegion();
  const enterEffluent = useMapStore((s) => s.enterEffluent);
  if (reachId === null || !hasEffluent(region)) return null;
  if (!netReachIds(region)?.has(reachId))
    return <p className="text-muted text-xs">{t("coverage")}</p>;
  return (
    <button
      type="button"
      className="bg-accent text-on-accent inline-flex min-h-10 items-center gap-2 self-start rounded-full px-4 text-sm font-medium hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground)"
      onClick={() => enterEffluent(reachId)}
    >
      <Icon name="downstream" />
      {t("simulate")}
    </button>
  );
}
