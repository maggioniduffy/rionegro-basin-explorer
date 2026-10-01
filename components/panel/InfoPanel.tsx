"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type {
  ReachResponse,
  RiverResponse,
  SubbasinResponse,
} from "@/lib/data/queries";
import { useMapStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Icon } from "../Icon";
import type { Selection } from "@/lib/url-state";
import { ReachPanel } from "./ReachPanel";
import { RiverPanel } from "./RiverPanel";
import { SubbasinPanel } from "./SubbasinPanel";

const apiPath = (s: Selection) => {
  switch (s.kind) {
    case "river":
      return `/api/rivers/${encodeURIComponent(s.id)}`;
    case "reach":
      return `/api/reaches/${s.id}`;
    case "subbasin":
      return `/api/subbasins/${encodeURIComponent(s.id)}`;
  }
};

const LABEL_KEY = {
  river: "river.label",
  reach: "reach.label",
  subbasin: "subbasin.label",
} as const;

/** Details of the selected river, reach or sub-basin, on the right of the map. */
export function InfoPanel() {
  const selection = useMapStore((s) => s.selection);
  if (!selection) return null;
  // Remount per selection so scroll position and state start fresh.
  return (
    <Panel key={`${selection.kind}:${selection.id}`} selection={selection} />
  );
}

function Panel({ selection }: { selection: Selection }) {
  const t = useTranslations("panel");
  const select = useMapStore((s) => s.select);
  const fitPending = useMapStore((s) => s.fitPending);
  const focusOn = useMapStore((s) => s.focusOn);
  const state = useApi<RiverResponse | ReachResponse | SubbasinResponse>(
    apiPath(selection),
  );

  // Selections from search, links or panel buttons fit the map once the bbox is known.
  useEffect(() => {
    if (fitPending && state.status === "ok") focusOn(state.data.bbox);
  }, [fitPending, state, focusOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  return (
    <aside
      aria-label={t(LABEL_KEY[selection.kind])}
      aria-busy={state.status === "loading"}
      data-testid="info-panel"
      className="absolute top-16 right-14 left-3 flex max-h-[calc(100dvh-9rem)] flex-col gap-4 overflow-y-auto rounded-lg border border-(--border) bg-(--panel) p-4 text-sm shadow-lg backdrop-blur md:left-auto md:w-88"
    >
      <button
        type="button"
        onClick={() => select(null)}
        aria-label={t("close")}
        title={t("close")}
        className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md hover:bg-(--panel-hover)"
      >
        <Icon name="close" />
      </button>
      {state.status === "loading" && (
        <p className="text-muted pr-8">{t("loading")}</p>
      )}
      {state.status === "notFound" && <p className="pr-8">{t("notFound")}</p>}
      {state.status === "error" && <p className="pr-8">{t("error")}</p>}
      {state.status === "ok" && selection.kind === "river" && (
        <RiverPanel river={state.data as RiverResponse} />
      )}
      {state.status === "ok" && selection.kind === "reach" && (
        <ReachPanel reach={state.data as ReachResponse} />
      )}
      {state.status === "ok" && selection.kind === "subbasin" && (
        <SubbasinPanel subbasin={state.data as SubbasinResponse} />
      )}
    </aside>
  );
}
