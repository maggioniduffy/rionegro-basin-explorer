"use client";

import { useTranslations } from "next-intl";
import type { SubbasinResponse } from "@/lib/data/queries";
import { SUBBASIN_COLORS } from "@/lib/map/style";
import { useApi } from "@/lib/use-api";

/** The basin whose sub-basins the map colours (pipeline/subbasins.config.json). */
const ROOT_ID = "negro";

function Swatch({ id }: { id: string }) {
  return (
    <span
      aria-hidden
      className="h-3 w-3 shrink-0 rounded-sm border"
      style={{
        backgroundColor: `${SUBBASIN_COLORS[id] ?? "#9aa3ab"}66`,
        borderColor: SUBBASIN_COLORS[id],
      }}
    />
  );
}

/** Sub-basin colours, named from the API; the root's colour is its own area. */
export function SubbasinLegend() {
  const t = useTranslations("legend.subbasins");
  const state = useApi<SubbasinResponse>(`/api/subbasins/${ROOT_ID}`);
  const root = state.status === "ok" ? state.data : null;

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-medium">{t("title")}</h2>
      {root && (
        <ul className="flex flex-col gap-1">
          {root.children.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <Swatch id={c.id} />
              <span>{c.name}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <Swatch id={root._id} />
            <span>{t("own", { name: root.name })}</span>
          </li>
        </ul>
      )}
      <p className="text-muted text-xs">{t("hint")}</p>
    </div>
  );
}
