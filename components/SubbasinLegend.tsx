"use client";

import { useTranslations } from "next-intl";
import type { SubbasinResponse } from "@/lib/data/queries";
import { useApi } from "@/lib/use-api";
import { useSubbasinLabel } from "./panel/subbasin-label";

/** The basin whose sub-basins the map outlines (pipeline/subbasins.config.json). */
const ROOT_ID = "negro";

/**
 * The parts the map outlines, named from the API; the root's own area is the land
 * that drains straight to its river.
 */
export function SubbasinLegend() {
  const t = useTranslations("legend.subbasins");
  const label = useSubbasinLabel();
  const state = useApi<SubbasinResponse>(`/api/subbasins/${ROOT_ID}`);
  const root = state.status === "ok" ? state.data : null;

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-medium">{t("title")}</h2>
      {root && (
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {root.children.map((c) => (
            <li key={c.id}>
              <span>{c.kind === "endorheic" ? t("endorheic") : label(c)}</span>
            </li>
          ))}
          <li>
            <span>{t("own", { name: root.name ?? "" })}</span>
          </li>
        </ul>
      )}
      <p className="text-muted text-xs">{t("hint")}</p>
    </div>
  );
}
