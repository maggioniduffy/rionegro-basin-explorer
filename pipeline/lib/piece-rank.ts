/**
 * The rank a river's piece with no Strahler order is drawn at (pipeline:tiles, mapLines "pieces",
 * regions with a river-lines.config.json).
 *
 * A fill piece, or a course piece no HydroRIVERS reach matched, has no `strahler`, so its own
 * rank is the one of its class (pieceOrderByClass, often 1) and the river would break where
 * it crosses one. Such a piece instead takes the largest rank among the pieces of its river
 * it touches at an endpoint (endpoints within `snapM` metres), and the rank spreads along a
 * chain of such pieces, layer by layer from the pieces that have a Strahler order. It is never
 * lower than its own class rank. A piece no chain reaches takes the rank of the nearest ranked
 * piece of its river and is listed in `unreached` with that distance.
 */

export interface RankPiece {
  id: string;
  /** Slug of the river the piece belongs to; null for a piece of no river (never re-ranked). */
  river: string | null;
  /** True when the piece has a Strahler order of its own (its `rank` is that order). */
  ranked: boolean;
  /** The rank pieceOrder gives it: the Strahler order, else its class rank. */
  rank: number;
  /** Every part's first and last vertex, [lon, lat]. */
  ends: readonly (readonly [number, number])[];
}

export interface PieceRanks {
  /** Final rank per piece id (all pieces, re-ranked or not). */
  ranks: Map<string, number>;
  /** Ids of pieces that took a rank from a neighbour (they have a river and no Strahler order). */
  reached: string[];
  /** Subset of `reached` whose rank rose above their class rank. */
  raised: string[];
  /**
   * Pieces with a river and no Strahler order that no chain reaches; each took the rank of the
   * nearest ranked piece of its river (end to end, `nearestM`; Infinity when the river has none).
   */
  unreached: { id: string; nearestM: number }[];
}

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;

/** Great-circle distance in metres between two [lon, lat] points. */
export function distanceM(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Indexes of the pieces (of one river) with an endpoint within snapM of an endpoint of each piece. */
function adjacency(pieces: readonly RankPiece[], snapM: number): number[][] {
  // One longitude scale for the whole river, so a cell is the same width everywhere; the cell is
  // 10 % wider than snapM, which tolerates the few percent it differs from the true width.
  const lat0 = pieces.find((p) => p.ends.length > 0)?.ends[0]?.[1] ?? 0;
  const lonScale = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const size = snapM * 1.1;
  const cell = (p: readonly [number, number]) =>
    [
      Math.floor((p[0] * lonScale) / size),
      Math.floor((p[1] * M_PER_DEG) / size),
    ] as const;
  const grid = new Map<string, { piece: number; at: [number, number] }[]>();
  pieces.forEach((p, i) => {
    for (const at of p.ends) {
      const [cx, cy] = cell(at);
      const key = `${cx}|${cy}`;
      const list = grid.get(key) ?? [];
      list.push({ piece: i, at: [at[0], at[1]] });
      grid.set(key, list);
    }
  });
  const near: Set<number>[] = pieces.map(() => new Set<number>());
  pieces.forEach((p, i) => {
    for (const at of p.ends) {
      const [cx, cy] = cell(at);
      // The cell width is in metres at the point's own latitude, so a neighbour a few
      // metres across a cell edge is found in the 3 x 3 block.
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const o of grid.get(`${cx + dx}|${cy + dy}`) ?? [])
            if (o.piece !== i && distanceM(at, o.at) <= snapM)
              near[i]!.add(o.piece);
    }
  });
  return near.map((s) => [...s].sort((a, b) => a - b));
}

export function propagatePieceRanks(
  pieces: readonly RankPiece[],
  snapM: number,
): PieceRanks {
  const ranks = new Map<string, number>(pieces.map((p) => [p.id, p.rank]));
  const reached: string[] = [];
  const raised: string[] = [];
  const unreached: { id: string; nearestM: number }[] = [];
  const byRiver = new Map<string, RankPiece[]>();
  for (const p of pieces)
    if (p.river !== null) {
      const list = byRiver.get(p.river) ?? [];
      list.push(p);
      byRiver.set(p.river, list);
    }
  for (const [, mine] of [...byRiver].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const near = adjacency(mine, snapM);
    // done[i]: the piece's rank is final (it has a Strahler order, or was reached).
    const done = mine.map((p) => p.ranked);
    const rank = mine.map((p) => p.rank);
    for (;;) {
      const layer: { i: number; rank: number }[] = [];
      mine.forEach((p, i) => {
        if (done[i]) return;
        const around = near[i]!.filter((j) => done[j]).map((j) => rank[j]!);
        if (around.length > 0)
          layer.push({ i, rank: Math.max(p.rank, ...around) });
      });
      if (layer.length === 0) break;
      // A layer reads only earlier layers, so the result does not depend on piece order.
      for (const l of layer) {
        done[l.i] = true;
        rank[l.i] = l.rank;
        const p = mine[l.i]!;
        ranks.set(p.id, l.rank);
        reached.push(p.id);
        if (l.rank > p.rank) raised.push(p.id);
      }
    }
    // A piece no chain reaches (its end lies off every ranked piece's end, e.g. it attaches
    // to a piece's interior) takes the rank of the ranked piece of its river whose end is
    // nearest to one of its ends, never lower than its own class rank.
    const settled = mine.flatMap((_, j) => (done[j] ? [j] : []));
    mine.forEach((p, i) => {
      if (done[i]) return;
      let best = -1;
      let bestM = Infinity;
      for (const j of settled)
        for (const a of p.ends)
          for (const b of mine[j]!.ends) {
            const d = distanceM(a, b);
            if (d < bestM) [best, bestM] = [j, d];
          }
      if (best >= 0 && rank[best]! > p.rank) {
        ranks.set(p.id, rank[best]!);
        raised.push(p.id);
      }
      unreached.push({ id: p.id, nearestM: Math.round(bestM) });
    });
  }
  return {
    ranks,
    reached: reached.sort(),
    raised: raised.sort(),
    unreached: unreached.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/** [lon, lat] first and last vertex of every part of a LineString or MultiLineString. */
export function lineEnds(geometry: unknown): [number, number][] {
  const g = geometry as { type: string; coordinates: unknown };
  const lines = (
    g.type === "LineString" ? [g.coordinates] : g.coordinates
  ) as number[][][];
  return lines.flatMap((l) => {
    const [a, b] = [l[0], l.at(-1)];
    return a && b
      ? [[a[0]!, a[1]!] as [number, number], [b[0]!, b[1]!] as [number, number]]
      : [];
  });
}
