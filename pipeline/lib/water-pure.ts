/**
 * Pure helpers for the water polygons of a region in reference mode (R3.6, Córdoba): the
 * settings file, name expansion, ids, kinds and the small decisions that
 * pipeline:lakes / pipeline:ign-layers take on them. DuckDB-free, so they are unit-tested.
 */
import { cleanName } from "./names";

export type WaterSource = "aprhi" | "ign" | "hydrolakes";
export type WaterKind = "lake" | "reservoir" | "controlled-lake";
/** The source layer a polygon comes from. */
export type WaterLayer = "nat" | "emb" | "bh130" | "perenne" | "hydrolakes";

/** One APRHI polygon layer (read as pipeline:basin reads its layers, always_xy, UTF-8). */
export interface AprhiLayerConfig {
  path: string;
  srs: string;
  idField: string;
  nameField: string;
  globalIdField: string;
}

export interface AprhiReservoirConfig extends AprhiLayerConfig {
  /** Field with the structure type ("Presa", "Azud"). */
  typeField: string;
  /** Types that count as a dam in the regulated-rivers caveat. */
  damTypes: string[];
  /** Field with the year the works started (a double). */
  yearField: string;
  /** Values of `yearField` that mean "no value". */
  yearNoValue: number[];
  /** Field with the area in hectares (compared with the polygon, never used as the area). */
  areaHaField: string;
}

export interface NameRules {
  /** Dotted word (lower case, without the dot) -> the full word it stands for. */
  abbreviations: Record<string, string>;
  /** Dotted words left as written (titles, initials). Any other dotted word stops the step. */
  keepDotted: string[];
  /** A name containing this text is blank: the source marks it as unknown. */
  blankMarker: string;
}

/** regions/<id>/lakes.config.json */
export interface LakesConfig extends NameRules {
  mode: "reference";
  aprhi: {
    natural: AprhiLayerConfig;
    reservoirs: AprhiReservoirConfig;
  };
  ign: {
    /** An IGN polygon covered at least this share by APRHI is the same water body: dropped. */
    dropCoveredShare: number;
    /** Smallest IGN piece kept (km²). */
    minKm2: number;
  };
  hydroLakes: {
    /** A HydroLAKES polygon is added only if APRHI and IGN polygons cover less than this. */
    maxCoveredShare: number;
    /** Smallest HydroLAKES piece kept (km²). */
    minKm2: number;
  };
  /** An IGN name names an unnamed lake when it covers at least this share of it. */
  nameMinOverlap: number;
  /** Parts left by clipping a polygon under a higher-precedence one, smaller than this (km²), are dropped. */
  minPartKm2: number;
  /** Largest overlap (km²) allowed between kept polygons. */
  overlapMaxKm2: number;
  /** Largest area (km²) of kept polygons outside the region outline. */
  outsideOutlineMaxKm2: number;
  /** Line pieces shorter than this (m) left by clipping a lake are slivers and dropped. */
  minPieceM: number;
  /** Allowed difference (%) between input km and kept + removed km of the clipped lines. */
  conservationPct: number;
  /** IGN dam point or wall within this distance (m) of an APRHI dam reservoir counts as marking it. */
  damMatchM: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Read and validate the settings file; throws one error naming every problem. */
export function parseLakesConfig(raw: unknown): LakesConfig {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new Error("lakes.config.json: not an object");
  const str = (o: unknown, path: string) => {
    if (!isRecord(o)) return;
    const [key] = path.split(".").slice(-1);
    if (typeof o[key ?? ""] !== "string" || o[key ?? ""] === "")
      problems.push(`${path} must be a non-empty string`);
  };
  const num = (v: unknown, path: string, min = 0) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min)
      problems.push(`${path} must be a number >= ${min}`);
  };
  if (raw.mode !== "reference") problems.push('mode must be "reference"');
  const aprhi = isRecord(raw.aprhi) ? raw.aprhi : {};
  const layers: [string, string[]][] = [
    ["natural", ["path", "srs", "idField", "nameField", "globalIdField"]],
    [
      "reservoirs",
      [
        "path",
        "srs",
        "idField",
        "nameField",
        "globalIdField",
        "typeField",
        "yearField",
        "areaHaField",
      ],
    ],
  ];
  for (const [layer, fields] of layers) {
    const o = aprhi[layer];
    if (!isRecord(o)) problems.push(`aprhi.${layer} missing`);
    else for (const f of fields) str(o, `aprhi.${layer}.${f}`);
  }
  const res = isRecord(aprhi.reservoirs) ? aprhi.reservoirs : {};
  if (!Array.isArray(res.damTypes) || res.damTypes.length === 0)
    problems.push("aprhi.reservoirs.damTypes must be a non-empty list");
  if (!Array.isArray(res.yearNoValue))
    problems.push("aprhi.reservoirs.yearNoValue must be a list");
  const ign = isRecord(raw.ign) ? raw.ign : {};
  num(ign.dropCoveredShare, "ign.dropCoveredShare");
  num(ign.minKm2, "ign.minKm2");
  const hl = isRecord(raw.hydroLakes) ? raw.hydroLakes : {};
  num(hl.maxCoveredShare, "hydroLakes.maxCoveredShare");
  num(hl.minKm2, "hydroLakes.minKm2");
  for (const k of [
    "nameMinOverlap",
    "minPartKm2",
    "overlapMaxKm2",
    "outsideOutlineMaxKm2",
    "minPieceM",
    "conservationPct",
    "damMatchM",
  ])
    num(raw[k], k);
  if (!isRecord(raw.abbreviations)) problems.push("abbreviations missing");
  if (!Array.isArray(raw.keepDotted)) problems.push("keepDotted missing");
  if (typeof raw.blankMarker !== "string" || raw.blankMarker === "")
    problems.push("blankMarker must be a non-empty string");
  if (problems.length > 0)
    throw new Error(`lakes.config.json: ${problems.join("; ")}`);
  return raw as unknown as LakesConfig;
}

export interface ExpandedName {
  /** The name to show; null if the source value is empty or blank. */
  name: string | null;
  /** The source marks the name as unknown (contains the blank marker). */
  blank: boolean;
  /** Dotted words (lower case, no dot) that are neither expanded nor kept as written. */
  unknown: string[];
  /** Dotted words that were expanded. */
  expanded: string[];
}

/**
 * An APRHI water name as shown: dotted words expanded through the table ("Lag. Avila" ->
 * "Laguna Avila", also without a space after the dot, "Lag.La Chanchera"), whitespace
 * collapsed. Case of the rest is left as the source has it. A dotted word that is not in
 * `abbreviations` or `keepDotted` is listed in `unknown` (the step stops on it, so a new
 * form is looked at before it is displayed).
 */
export function expandWaterName(
  raw: string | null | undefined,
  rules: NameRules,
): ExpandedName {
  const cleaned = cleanName(raw);
  if (cleaned === null)
    return { name: null, blank: false, unknown: [], expanded: [] };
  if (cleaned.includes(rules.blankMarker))
    return { name: null, blank: true, unknown: [], expanded: [] };
  const unknown: string[] = [];
  const expanded: string[] = [];
  const keep = new Set(rules.keepDotted.map((w) => w.toLowerCase()));
  const text = cleaned.replace(
    /(\p{L}+)\.(?=(\p{L})|\s|$)/gu,
    (match, word: string, next: string | undefined) => {
      const key = word.toLowerCase();
      const full = rules.abbreviations[key];
      if (full !== undefined) {
        expanded.push(key);
        return next ? `${full} ` : full;
      }
      if (!keep.has(key)) unknown.push(key);
      return match;
    },
  );
  return {
    name: cleanName(text),
    blank: false,
    unknown: [...new Set(unknown)].sort(),
    expanded: [...new Set(expanded)].sort(),
  };
}

/** Stable id of a water polygon: source layer and the source's own id. */
export function waterId(layer: WaterLayer, sourceId: number | string): string {
  const id = String(sourceId);
  if (!/^\d+$/.test(id))
    throw new Error(`water source id is not an integer: ${id}`);
  return layer === "hydrolakes"
    ? `hydrolakes-${id}`
    : `${layer === "nat" || layer === "emb" ? "aprhi" : "ign"}-${layer}-${id}`;
}

export const sourceOf = (layer: WaterLayer): WaterSource =>
  layer === "nat" || layer === "emb"
    ? "aprhi"
    : layer === "hydrolakes"
      ? "hydrolakes"
      : "ign";

/**
 * Kind of a water polygon: reservoirs are APRHI Embalses, IGN BH130 and HydroLAKES
 * Lake_type 2; HydroLAKES type 3 keeps the "controlled-lake" kind of the app; the rest are lakes.
 */
export function waterKind(
  layer: WaterLayer,
  hydroLakesType?: number | null,
): WaterKind {
  if (layer === "emb" || layer === "bh130") return "reservoir";
  if (layer === "hydrolakes") {
    if (hydroLakesType === 2) return "reservoir";
    if (hydroLakesType === 3) return "controlled-lake";
  }
  return "lake";
}

/** Precedence tier of a layer: lower wins where polygons overlap (APRHI > IGN > HydroLAKES). */
export const TIER: Record<WaterLayer, number> = {
  emb: 0,
  nat: 1,
  bh130: 2,
  perenne: 3,
  hydrolakes: 4,
};

/** Share of a polygon covered by higher-precedence ones reaches the limit: it is the same water. */
export const isCovered = (share: number, limit: number) => share >= limit;

/** A year from APRHI's Ano_inicio: the sentinels (0, -999) and non-finite values are null. */
export function yearOrNull(
  v: number | string | null | undefined,
  noValue: readonly number[],
): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || noValue.includes(n)) return null;
  return Math.round(n);
}

export interface DamCaveatRow {
  name: string | null;
  areaKm2: number;
  yearStart: number | null;
}

/** The dam list for the regulated-rivers caveat: largest reservoir first, ties by name. */
export function sortDamCaveat<T extends DamCaveatRow>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      b.areaKm2 - a.areaKm2 || (a.name ?? "").localeCompare(b.name ?? "", "es"),
  );
}
