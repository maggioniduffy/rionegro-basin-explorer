import "server-only";
import type { Catalog } from "@/lib/ask/catalog";
import type { AnswerItem, AskAnswer } from "@/lib/ask/contract";
import type { Intent } from "@/lib/ask/intent";
import { metricPath } from "@/lib/ask/metrics";
import { getMetricDocs } from "@/lib/data/queries";

export type AnswerIntent = Extract<
  Intent,
  { action: "compare" | "rank" | "fact" }
>;

/** Most items a ranking shows. */
export const RANK_LIMIT = 5;

/** The ids the intent asks about, from the catalog (the LLM only names slugs). */
function idsOf(intent: AnswerIntent, catalog: Catalog): string[] {
  if (intent.action === "compare") return intent.slugs;
  if (intent.action === "fact") return [intent.slug];
  if (intent.kind === "river") {
    return catalog.docs.rivers
      .filter((r) => intent.scope === "all" || r.flowsInto === intent.slug)
      .map((r) => r._id);
  }
  // The root sub-basin is the whole basin, not a part to rank.
  return catalog.docs.subbasins
    .filter((s) =>
      intent.scope === "all" ? s.parentId !== null : s.parentId === intent.slug,
    )
    .map((s) => s._id);
}

function parentOf(intent: AnswerIntent, catalog: Catalog): AskAnswer["parent"] {
  if (intent.action !== "rank" || intent.scope !== "tributaries") return null;
  const docs: Array<{ _id: string; name: string | null }> =
    intent.kind === "river" ? catalog.docs.rivers : catalog.docs.subbasins;
  const doc = docs.find((d) => d._id === intent.slug);
  return doc ? { id: doc._id, name: doc.name } : null;
}

/**
 * Reads the metric of the named rivers or sub-basins from Mongo and orders them. Every
 * number comes from a document field; the intent only carries ids and a metric name.
 */
export async function computeAnswer(
  intent: AnswerIntent,
  catalog: Catalog,
): Promise<AskAnswer> {
  const path = metricPath(intent.metric, intent.kind);
  if (path === null) throw new Error("metric not available for this kind");
  const order = intent.action === "fact" ? null : intent.order;
  const parent = parentOf(intent, catalog);
  const ids = idsOf(intent, catalog);

  const docs =
    ids.length === 0 ? [] : await getMetricDocs(intent.kind, ids, path);
  const direction = order === "min" ? 1 : -1;
  const sorted = [...docs].sort((a, b) => {
    if (a.value === null || b.value === null) {
      return Number(a.value === null) - Number(b.value === null);
    }
    return direction * (a.value - b.value);
  });
  const shown = intent.action === "rank" ? sorted.slice(0, RANK_LIMIT) : sorted;
  const items: AnswerItem[] = shown.map(({ id, name, value, modeled }) => ({
    id,
    name,
    value,
    modeled,
  }));

  const best = items[0]?.value ?? null;
  const winnerIds =
    best === null
      ? []
      : intent.action === "fact"
        ? items.slice(0, 1).map((i) => i.id)
        : items.filter((i) => i.value === best).map((i) => i.id);
  const provenance =
    shown.map((d) => d.provenance).find((p) => p !== null) ?? null;

  return {
    type: intent.action,
    kind: intent.kind,
    metric: intent.metric,
    order,
    parent,
    items,
    winnerIds,
    provenance,
    // Filters are applied in the next step.
    filters: [],
    total: null,
    filterCaveats: [],
  };
}
