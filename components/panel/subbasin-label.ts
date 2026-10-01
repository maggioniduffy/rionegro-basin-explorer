"use client";

import { useTranslations } from "next-intl";
import type { SubbasinRef } from "@/lib/data/queries";

/** Display name of a sub-basin: "<river> basin", or the locale's name for endorheic land. */
export function useSubbasinLabel() {
  const t = useTranslations("panel.subbasin");
  return (ref: Pick<SubbasinRef, "kind" | "name">) =>
    ref.kind === "endorheic" || ref.name === null
      ? t("endorheicTitle")
      : t("title", { name: ref.name });
}
