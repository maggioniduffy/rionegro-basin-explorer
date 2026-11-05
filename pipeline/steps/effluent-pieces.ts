/**
 * Which line pieces of an effluent-net reach the plume may paint (phase E1.5, "Nombre + línea",
 * owner decision 2026-11-05). Pure: pipeline:effluent-net feeds it plain rows.
 *
 * pipeline:lines matches a line part to the nearest reach within the buffer by distance only, so
 * the lower pieces of a tributary can carry a main-stem reach's id and the plume would paint them
 * as stubs. For each piece whose reach is in the net:
 *  - the reach has a name (river or stream, with the aliases of both) and the piece shows a
 *    different name -> dropped ("name" rule);
 *  - the reach has no name -> dropped when most of the piece's line (all its pieces) lies on one
 *    other net reach ("line" rule). One reach, not the sum over the net: an unnamed main-stem
 *    line spans many net reaches and must keep its pieces;
 *  - an unnamed piece of a named reach, and a piece with the reach's name, are kept.
 *
 * Name comparison is case-, accent- and whitespace-insensitive and ignores one leading generic
 * type word ("Río", "Arroyo", "R.", "A."): APRHI and IGN spell the same watercourse "Río X" and
 * "Arroyo X" (the type is not part of its identity), while "Cañada", "Canal" or "Brazo" are kept
 * as part of the name, so a "Brazo Río X" piece is not the main stem X.
 */

export interface PieceRow {
  pieceId: string;
  lineId: string;
  /** The reach pipeline:lines matched the piece to; null when none. */
  reach: number | null;
  /** The display name the tiles show (export/piece_name.json); null when none. */
  name: string | null;
  lengthM: number;
}

export interface PieceCounts {
  /** Pieces whose reach is in the net. */
  total: number;
  kept: number;
  droppedByName: number;
  droppedByLine: number;
  /** Net reaches with at least one kept piece. */
  reachesWithPieces: number;
}

const GENERIC_PREFIX = /^(rio|arroyo|r|a)\.?\s+/;

/** Comparison key of a watercourse name; see the file comment for what is ignored. */
export function nameKey(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const bare = base.replace(GENERIC_PREFIX, "").trim();
  return bare === "" ? base : bare;
}

/**
 * Kept piece ids per net reach (ascending reach id, ids in input order) and counts by rule.
 * `reachNames` maps a net reach to the names of its river/stream (and their aliases); a reach
 * absent from it or with an empty list is unnamed.
 */
export function selectPieces(
  rows: readonly PieceRow[],
  net: ReadonlySet<number>,
  reachNames: ReadonlyMap<number, readonly string[]>,
): { pieces: Map<number, string[]>; counts: PieceCounts } {
  const lineTotal = new Map<string, number>();
  const lineOnReach = new Map<string, Map<number, number>>();
  for (const r of rows) {
    lineTotal.set(r.lineId, (lineTotal.get(r.lineId) ?? 0) + r.lengthM);
    if (r.reach === null || !net.has(r.reach)) continue;
    let m = lineOnReach.get(r.lineId);
    if (!m) lineOnReach.set(r.lineId, (m = new Map()));
    m.set(r.reach, (m.get(r.reach) ?? 0) + r.lengthM);
  }
  const keys = new Map<number, Set<string>>();
  for (const id of net)
    keys.set(id, new Set((reachNames.get(id) ?? []).map(nameKey)));

  const pieces = new Map<number, string[]>();
  const counts: PieceCounts = {
    total: 0,
    kept: 0,
    droppedByName: 0,
    droppedByLine: 0,
    reachesWithPieces: 0,
  };
  for (const r of rows) {
    if (r.reach === null || !net.has(r.reach)) continue;
    counts.total++;
    const own = keys.get(r.reach)!;
    if (own.size > 0) {
      if (r.name !== null && !own.has(nameKey(r.name))) {
        counts.droppedByName++;
        continue;
      }
    } else {
      const total = lineTotal.get(r.lineId) ?? 0;
      let other = 0;
      for (const [reach, len] of lineOnReach.get(r.lineId) ?? [])
        if (reach !== r.reach && len > other) other = len;
      if (other > total / 2) {
        counts.droppedByLine++;
        continue;
      }
    }
    counts.kept++;
    const list = pieces.get(r.reach);
    if (list) list.push(r.pieceId);
    else pieces.set(r.reach, [r.pieceId]);
  }
  counts.reachesWithPieces = pieces.size;
  return {
    pieces: new Map([...pieces].sort((a, b) => a[0] - b[0])),
    counts,
  };
}
