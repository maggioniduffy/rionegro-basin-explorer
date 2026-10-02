"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { SubbasinTreeNode } from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import { initiallyExpanded } from "@/lib/subbasin-tree";
import { useApi } from "@/lib/use-api";
import { Icon } from "./Icon";
import { useFormat } from "./panel/parts";

/**
 * The sub-basin hierarchy (Río Negro > Limay > Collón Curá …) as nested disclosure
 * lists. A row selects its node, whose land includes every row below it; the map tints
 * the whole subtree. Replaces the flat legend in the sub-basin view.
 */
export function SubbasinTree() {
  const t = useTranslations("legend.subbasins");
  const f = useFormat();
  const state = useApi<SubbasinTreeNode[]>("/api/subbasins");
  const selection = useMapStore((s) => s.selection);
  const select = useMapStore((s) => s.select);
  const selectedId = selection?.kind === "subbasin" ? selection.id : null;
  // Rows the viewer opened or closed; the rest follow the default (top levels and the
  // path to the selection), so a map click reveals its row.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());

  const nodes = useMemo(
    () => (state.status === "ok" ? state.data : []),
    [state],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const defaults = useMemo(
    () => initiallyExpanded(nodes, selectedId),
    [nodes, selectedId],
  );
  const isOpen = (id: string) => toggled.get(id) ?? defaults.has(id);
  const label = (n: SubbasinTreeNode) =>
    n.kind === "endorheic" || n.name === null ? t("endorheic") : n.name;

  const renderNode = (n: SubbasinTreeNode) => {
    const open = isOpen(n.id);
    const children = n.childIds.flatMap((id) => byId.get(id) ?? []);
    const selected = n.id === selectedId;
    return (
      <li key={n.id}>
        <div className="flex items-center gap-1">
          {children.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={t(open ? "collapse" : "expand", { name: label(n) })}
              onClick={() => setToggled((m) => new Map(m).set(n.id, !open))}
              className="text-muted rounded p-0.5 hover:bg-(--panel-hover)"
            >
              <Icon
                name="chevron"
                className={`transition-transform ${open ? "rotate-90" : ""}`}
              />
            </button>
          ) : (
            <span className="w-5" aria-hidden />
          )}
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() =>
              select({ kind: "subbasin", id: n.id }, { fit: true })
            }
            className={`flex flex-1 items-baseline justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-(--panel-hover) ${
              selected ? "bg-(--panel-hover) font-medium" : ""
            }`}
          >
            <span>{label(n)}</span>
            <span className="text-muted text-xs tabular-nums">
              {f("km2", n.areaKm2)}
            </span>
          </button>
        </div>
        {children.length > 0 && open && (
          <ul className="ml-2.5 border-l border-(--border) pl-1.5">
            {children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  const root = nodes.find((n) => n.parentId === null);
  return (
    <nav aria-label={t("title")} className="flex flex-col gap-1.5">
      <h2 className="font-medium">{t("title")}</h2>
      {state.status === "error" && (
        <p className="text-muted text-xs">{t("error")}</p>
      )}
      {root && <ul>{renderNode(root)}</ul>}
      <p className="text-muted text-xs">{t("hint")}</p>
    </nav>
  );
}
