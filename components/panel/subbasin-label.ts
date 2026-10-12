"use client";

import { useTranslations } from "next-intl";
import type { SubbasinRef } from "@/lib/data/queries";

/**
 * Display name of a sub-basin: "<river> basin", the locale's name for endorheic land, or the
 * name itself for a management area ("area" nodes of a reference agency, e.g. APRHI).
 */
export function useSubbasinLabel() {
  const t = useTranslations("panel.subbasin");
  return (ref: Pick<SubbasinRef, "kind" | "name">) =>
    ref.kind === "endorheic" || ref.name === null
      ? t("endorheicTitle")
      : ref.kind === "area"
        ? ref.name
        : t("title", { name: ref.name });
}
