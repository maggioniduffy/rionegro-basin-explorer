"use client";

import { useTranslations } from "next-intl";
import { legendGradient } from "@/lib/flow/color";

/** The speed colour ramp, slow to fast; its caption says it is relative and illustrative. */
export function FlowLegend() {
  const t = useTranslations("flow.legend");
  return (
    <div className="flex flex-col gap-0.5">
      <div
        role="img"
        aria-label={t("caption")}
        title={t("caption")}
        className="h-1.5 w-full rounded-full"
        style={{ background: legendGradient() }}
      />
      <div className="text-secondary flex items-center justify-between gap-3 text-[11px] leading-none">
        <span>{t("slow")}</span>
        <span>{t("fast")}</span>
      </div>
    </div>
  );
}
