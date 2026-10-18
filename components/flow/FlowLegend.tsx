"use client";

import { useTranslations } from "next-intl";
import { legendGradient } from "@/lib/flow/color";

/** The speed colour ramp, slow to fast; the caption says it is relative and illustrative. */
export function FlowLegend() {
  const t = useTranslations("flow.legend");
  return (
    <div className="flex flex-col gap-1">
      <div
        aria-hidden
        className="h-2 w-full rounded-full"
        style={{ background: legendGradient() }}
      />
      <div className="text-secondary flex items-center justify-between gap-3 text-xs">
        <span>{t("slow")}</span>
        <span className="text-muted">{t("caption")}</span>
        <span>{t("fast")}</span>
      </div>
    </div>
  );
}
