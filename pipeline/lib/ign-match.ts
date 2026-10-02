/**
 * Pure rules for matching IGN names to HydroRIVERS reaches (pipeline:ign-match).
 * The SQL side measures, for each reach and each IGN name, the fraction of the reach lying
 * within the buffer of that name's lines (`coverage`, 0..1). The rules here turn the
 * ranked coverages into a confidence tier and apply the hand-made overrides.
 */

/** Thresholds live in pipeline/ign.config.json. */
export interface MatchConfig {
  /** A reach and an IGN line match when they are within this many metres (Albers). */
  bufferM: number;
  /** Tier thresholds: coverage of the best name and its lead over the second name. */
  high: { minCoverage: number; minMargin: number };
  medium: { minCoverage: number; minMargin: number };
  /** Below this coverage a reach gets no candidate at all. */
  low: { minCoverage: number };
  /** An approved river takes the IGN name covering at least this share of its stem km that has a candidate */
  riverNameMinShare: number;
  /** ...provided at least this many stem km have an IGN candidate (reservoirs have none). */
  riverNameMinEvidenceKm: number;
  /** Unmatched IGN pieces shorter than this (metres) are not kept in the detail layer. */
  minDetailPieceM: number;
}

export interface Candidate {
  /** Comparison key of the name (nameKey), not its display spelling. */
  key: string;
  coverage: number;
}

export type Confidence = "high" | "medium" | "low" | "none";

export interface Classified {
  best: Candidate | null;
  /** Coverage of the best name minus that of the runner-up (0 when there is none). */
  margin: number;
  confidence: Confidence;
  /** The runner-up is close enough to the best to make the choice doubtful. */
  ambiguous: boolean;
}

/** Candidates must be sorted by coverage, highest first. */
export function classify(
  candidates: readonly Candidate[],
  cfg: MatchConfig,
): Classified {
  const best = candidates[0] ?? null;
  if (!best || best.coverage < cfg.low.minCoverage)
    return { best: null, margin: 0, confidence: "none", ambiguous: false };
  const second = candidates[1];
  const margin = best.coverage - (second?.coverage ?? 0);
  const ambiguous = second !== undefined && margin < cfg.medium.minMargin;
  let confidence: Confidence = "low";
  if (best.coverage >= cfg.high.minCoverage && margin >= cfg.high.minMargin)
    confidence = "high";
  else if (
    best.coverage >= cfg.medium.minCoverage &&
    margin >= cfg.medium.minMargin
  )
    confidence = "medium";
  return { best, margin, confidence, ambiguous };
}

/** Decisions recorded while triaging pipeline/ign-overrides.json. */
export type ReachOverride =
  | { id: number; action: "accept" | "reject"; note: string }
  | { id: number; action: "name"; name: string; note: string };

export interface Matched {
  name: string | null;
  confidence: Confidence;
  /** True when a reviewer decided this reach (an override applies). */
  reviewed: boolean;
  /** Whether the app shows the IGN name for this reach. */
  display: boolean;
}

/** Auto rule: high and medium matches are shown; low and none are not. */
export function autoDisplay(confidence: Confidence): boolean {
  return confidence === "high" || confidence === "medium";
}

/**
 * Apply a reviewer's decision. "accept" shows the best candidate even if low, "reject"
 * hides the name, "name" shows the given name (it replaces the candidate).
 */
export function applyOverride(
  auto: Pick<Matched, "name" | "confidence">,
  override: ReachOverride | undefined,
): Matched {
  if (!override)
    return {
      ...auto,
      reviewed: false,
      display: auto.name !== null && autoDisplay(auto.confidence),
    };
  switch (override.action) {
    case "reject":
      return { ...auto, reviewed: true, display: false };
    case "accept":
      return { ...auto, reviewed: true, display: auto.name !== null };
    case "name":
      return {
        name: override.name,
        confidence: auto.confidence,
        reviewed: true,
        display: true,
      };
  }
}
