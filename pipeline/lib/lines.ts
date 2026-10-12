/**
 * Pure helpers of pipeline:lines: status mapping, ids and the run logic that ties the parts
 * of a line to the reaches it runs along. No file or database access.
 */
import { normalizeLabel } from "./lines-gate";

export interface StatusRules {
  /** APRHI status values (compared after normalizeLabel) whose lines are dropped. */
  drop: string[];
  /** APRHI status value (normalizeLabel form) → status kept on the piece. */
  map: Record<string, string>;
}

export type StatusResult =
  | { kind: "drop" }
  | { kind: "keep"; status: string | null }
  | { kind: "unknown"; label: string };

/**
 * Status of an APRHI line. An empty status is kept as null (not guessed); a value that is
 * neither dropped nor mapped is "unknown" so the step can stop instead of inventing one.
 */
export function mapStatus(
  raw: string | null | undefined,
  rules: StatusRules,
): StatusResult {
  const label = normalizeLabel(raw);
  if (label === "(none)") return { kind: "keep", status: null };
  if (rules.drop.map(normalizeLabel).includes(label)) return { kind: "drop" };
  const mapped = Object.entries(rules.map).find(
    ([k]) => normalizeLabel(k) === label,
  );
  return mapped
    ? { kind: "keep", status: mapped[1] }
    : { kind: "unknown", label };
}

export interface Run {
  /** First part (inclusive) and last part (exclusive) of the piece. */
  from: number;
  to: number;
  reach: number | null;
}

/** Consecutive parts with the same reach (null counts as a value of its own) become one run. */
export function mergeRuns(reaches: readonly (number | null)[]): Run[] {
  const runs: Run[] = [];
  reaches.forEach((reach, i) => {
    const last = runs[runs.length - 1];
    if (last && last.reach === reach) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, reach });
  });
  return runs;
}

/**
 * Pieces of one line. `reaches[i]` is the reach given to part i (null: none within the
 * buffer); every part is `lengthM / reaches.length` long. Consecutive parts with the same
 * reach merge; a run shorter than `minPieceM` between two runs of the same matched reach
 * takes that reach (a short wobble to a neighbour or a gap), repeated until stable.
 */
export function pieceRuns(
  reaches: readonly (number | null)[],
  lengthM: number,
  minPieceM: number,
): Run[] {
  const partM = reaches.length > 0 ? lengthM / reaches.length : 0;
  const current = reaches.slice();
  for (;;) {
    const runs = mergeRuns(current);
    let changed = false;
    for (let i = 1; i < runs.length - 1; i++) {
      const [prev, run, next] = [runs[i - 1], runs[i], runs[i + 1]] as [
        Run,
        Run,
        Run,
      ];
      if (
        prev.reach !== null &&
        prev.reach === next.reach &&
        run.reach !== prev.reach &&
        (run.to - run.from) * partM < minPieceM
      ) {
        for (let p = run.from; p < run.to; p++) current[p] = prev.reach;
        changed = true;
      }
    }
    if (!changed) return runs;
  }
}
