import type { Quantity } from "@/lib/units";

export type MetricKind = "river" | "subbasin";

export const METRIC_IDS = [
  "length",
  "discharge",
  "upstreamArea",
  "area",
  "sourceElevation",
  "mouthElevation",
  "drop",
  "gradient",
  "distanceToSea",
  "elevationMax",
  "elevationMin",
  "population",
  "lakesPct",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface Metric {
  /** Document field per kind (a key of that document's `provenance`); absent = not offered. */
  path: Partial<Record<MetricKind, string>>;
  quantity: Quantity;
  /** Comparative wording of the answer templates (messages ask.answer.*). */
  word: "longer" | "higher" | "larger" | "more" | "steeper" | "farther";
  /** Caveat shown when the document lists the path as modeled (messages panel.caveat.*). */
  caveat: "discharge" | "population" | null;
  /** Plain meaning, for the LLM prompt only (never shown). */
  meaning: string;
}

/**
 * The values the ask box may answer with: each one is a seeded field with a provenance
 * entry (rule 2). Nothing else can be asked for.
 */
export const METRICS: Record<MetricId, Metric> = {
  length: {
    path: { river: "lengthKm", subbasin: "lengthKm" },
    quantity: "km",
    word: "longer",
    caveat: null,
    meaning:
      "length of a river; for a sub-basin, total length of its river network",
  },
  discharge: {
    path: { river: "mouth.dischargeM3s", subbasin: "outlet.dischargeM3s" },
    quantity: "m3s",
    word: "more",
    caveat: "discharge",
    meaning: "average discharge / flow / caudal at the mouth or outlet",
  },
  upstreamArea: {
    path: { river: "mouth.uplandKm2" },
    quantity: "km2",
    word: "larger",
    caveat: null,
    meaning:
      "area drained upstream of a river's mouth (how big a river's basin is)",
  },
  area: {
    path: { subbasin: "areaKm2" },
    quantity: "km2",
    word: "larger",
    caveat: null,
    meaning: "area of a sub-basin",
  },
  sourceElevation: {
    path: { river: "source.elevationM" },
    quantity: "m",
    word: "higher",
    caveat: null,
    meaning: "elevation where a river starts",
  },
  mouthElevation: {
    path: { river: "mouth.elevationM" },
    quantity: "m",
    word: "higher",
    caveat: null,
    meaning: "elevation of a river's mouth",
  },
  drop: {
    path: { river: "dropM" },
    quantity: "m",
    word: "more",
    caveat: null,
    meaning: "elevation drop from source to mouth",
  },
  gradient: {
    path: { river: "gradientMPerKm" },
    quantity: "mPerKm",
    word: "steeper",
    caveat: null,
    meaning: "average slope / gradient / pendiente",
  },
  distanceToSea: {
    path: { river: "mouth.distanceToSeaKm" },
    quantity: "km",
    word: "farther",
    caveat: null,
    meaning: "distance from the river's mouth to the sea",
  },
  elevationMax: {
    path: { subbasin: "elevationMaxM" },
    quantity: "m",
    word: "higher",
    caveat: null,
    meaning: "highest elevation in a sub-basin",
  },
  elevationMin: {
    path: { subbasin: "elevationMinM" },
    quantity: "m",
    word: "higher",
    caveat: null,
    meaning: "lowest elevation in a sub-basin",
  },
  population: {
    path: { river: "watershed.population", subbasin: "population" },
    quantity: "count",
    word: "more",
    caveat: "population",
    meaning: "people living in the watershed / sub-basin (habitantes)",
  },
  lakesPct: {
    path: { river: "watershed.lakesPct", subbasin: "lakesPct" },
    quantity: "pct",
    word: "more",
    caveat: null,
    meaning: "share of the watershed covered by lakes",
  },
};

/** The document field of `metric` for `kind`, or null when that kind doesn't have it. */
export function metricPath(metric: MetricId, kind: MetricKind): string | null {
  return METRICS[metric].path[kind] ?? null;
}
