"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/Icon";
import type { FlowIndex } from "@/lib/flow/schema";
import { nearestSection, riverHasFlow } from "@/lib/flow/pick";
import { useMapStore } from "@/lib/store";

/** The panels' entry to flow mode: a filled pill under the river name. */
export function FlowButton({
  index,
  slug,
}: {
  index: FlowIndex;
  slug: string;
}) {
  const t = useTranslations("flow");
  const enterFlow = useMapStore((s) => s.enterFlow);
  const lastClick = useMapStore((s) => s.lastClick);
  if (!riverHasFlow(index, slug)) return null;
  return (
    <button
      type="button"
      className="bg-accent text-on-accent inline-flex min-h-10 items-center gap-2 self-start rounded-full px-4 text-sm font-medium hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground)"
      onClick={() => {
        const id = nearestSection(index, slug, lastClick);
        if (id) enterFlow(id, { fit: true });
      }}
    >
      <Icon name="play" />
      {t("view")}
    </button>
  );
}
