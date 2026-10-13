/**
 * Flow class of a display line piece from IGN's mapped classes (pipeline:line-flow, cba;
 * owner, 2026-10-12): IGN's cartography is the authority over GIRES's model. Pure, so it is
 * unit-tested without DuckDB.
 */

export const LINE_FLOWS = ["perennial", "intermittent"] as const;
export type LineFlow = (typeof LINE_FLOWS)[number];

export const isLineFlow = (v: unknown): v is LineFlow =>
  LINE_FLOWS.includes(v as LineFlow);

/**
 * The class of a piece sampled at `points` evenly spaced points, of which `perennial` and
 * `intermittent` lie within the buffer of an IGN line of that class (each point counts
 * for its nearest IGN line only). Null when fewer than `minShare` of the points lie by an
 * IGN line: the piece runs apart from IGN's lines and keeps GIRES. Otherwise the class with
 * more points; a tie goes to perennial (where a perennial river meets an intermittent
 * tributary both lie within the buffer).
 */
export function pieceFlow(
  points: number,
  perennial: number,
  intermittent: number,
  minShare: number,
): LineFlow | null {
  if (points <= 0 || perennial + intermittent < minShare * points) return null;
  return perennial >= intermittent ? "perennial" : "intermittent";
}

/** Tile value of the class, as GIRES's `nonPerennial1d`: 0 perennial, 1 not. */
export const flowCode = (f: LineFlow): 0 | 1 => (f === "perennial" ? 0 : 1);
