import "server-only";
import type { Catalog } from "@/lib/ask/catalog";
import type { AnswerItem, AskAnswer } from "@/lib/ask/contract";
import type { Filter, Intent } from "@/lib/ask/intent";
import { metricPath } from "@/lib/ask/metrics";
import { getMetricDocs, type MetricDoc } from "@/lib/data/queries";

export type AnswerIntent = Extract<
  Intent,
  { action: "compare" | "rank" | "fact" }
>;

/** Most items a ranking shows. */
export const RANK_LIMIT = 5;
/** Most items a ranking with filters shows (the card also says how many matched). */
export const FILTERED_RANK_LIMIT = 10;

const NON_PERENNIAL = "nonPerennialPct";
const UNKNOWN = "unknownPct";
const REGULATION: Record<AnswerIntent["kind"], string> = {
  river: "mouth.regulationPct",
  subbasin: "outlet.regulationPct",
};

/** Document fields the filters read, besides the metric. */
function filterPaths(filters: Filter[], kind: AnswerIntent["kind"]): string[] {
  return filters.flatMap((f) => {
    switch (f.type) {
      case "regime":
        return f.value === "perennial"
          ? [NON_PERENNIAL, UNKNOWN]
          : [NON_PERENNIAL];
      case "regulated":
        return [REGULATION[kind]];
      case "threshold": {
        const path = metricPath(f.metric, kind);
        return path === null ? [] : [path];
      }
      case "within":
        return [];
    }
  });
}

/**
 * Ids of the rivers inside each sub-basin named by a `within` filter, read from the
 * sub-basin documents. Sub-basins use their own lineage instead (no extra read).
 */
async function riversWithin(
  catalog: Catalog,
  filters: Filter[],
  kind: AnswerIntent["kind"],
): Promise<Map<string, Set<string>>> {
  const slugs = filters.flatMap((f) => (f.type === "within" ? [f.slug] : []));
  const members = new Map<string, Set<string>>();
  if (kind !== "river" || slugs.length === 0) return members;
  const docs = await getMetricDocs(
    catalog.region,
    "subbasin",
    [...new Set(slugs)],
    [],
  );
  for (const doc of docs) members.set(doc.id, new Set(doc.rivers ?? []));
  return members;
}

/** Whether a document meets one filter; missing fields never match (rule 2). */
function matches(
  doc: MetricDoc,
  filter: Filter,
  kind: AnswerIntent["kind"],
  within: Map<string, Set<string>>,
): boolean {
  switch (filter.type) {
    case "regime": {
      const nonPerennial = doc.values[NON_PERENNIAL] ?? null;
      if (nonPerennial === null) return false;
      if (filter.value === "nonPerennial") return nonPerennial > 0;
      // Same rule as the map's blue line: no orange and no unknown share.
      return nonPerennial === 0 && doc.values[UNKNOWN] === 0;
    }
    case "regulated": {
      const regulation = doc.values[REGULATION[kind]] ?? null;
      if (regulation === null) return false;
      return filter.value === "yes" ? regulation > 0 : regulation === 0;
    }
    case "within":
      return kind === "river"
        ? (within.get(filter.slug)?.has(doc.id) ?? false)
        : doc.id !== filter.slug &&
            (doc.lineage?.includes(filter.slug) ?? false);
    case "threshold": {
      const path = metricPath(filter.metric, kind);
      const value = path === null ? null : (doc.values[path] ?? null);
      if (value === null) return false;
      return filter.op === "gt" ? value > filter.number : value < filter.number;
    }
  }
}

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

  const filters = intent.action === "rank" ? (intent.filters ?? []) : [];
  const paths = [...new Set([path, ...filterPaths(filters, intent.kind)])];
  const all =
    ids.length === 0
      ? []
      : await getMetricDocs(catalog.region, intent.kind, ids, paths);
  const within = await riversWithin(catalog, filters, intent.kind);
  const docs = all.filter((d) =>
    filters.every((f) => matches(d, f, intent.kind, within)),
  );
  const direction = order === "min" ? 1 : -1;
  const sorted = [...docs].sort((a, b) => {
    if (a.value === null || b.value === null) {
      return Number(a.value === null) - Number(b.value === null);
    }
    return direction * (a.value - b.value);
  });
  const limit = filters.length > 0 ? FILTERED_RANK_LIMIT : RANK_LIMIT;
  const shown = intent.action === "rank" ? sorted.slice(0, limit) : sorted;
  const byRegime = filters.some((f) => f.type === "regime");
  const items: AnswerItem[] = shown.map((d) => ({
    id: d.id,
    name: d.name,
    value: d.value,
    modeled: d.modeled,
    ...(byRegime ? { nonPerennialPct: d.values[NON_PERENNIAL] ?? null } : {}),
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
    filters,
    total: intent.action === "rank" ? docs.length : null,
    filterCaveats: [
      ...(byRegime ? (["nonPerennial"] as const) : []),
      ...(filters.some((f) => f.type === "regulated")
        ? (["regulation"] as const)
        : []),
    ],
  };
}
