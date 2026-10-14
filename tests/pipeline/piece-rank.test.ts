import { describe, expect, it } from "vitest";
import {
  propagatePieceRanks,
  type RankPiece,
} from "../../pipeline/lib/piece-rank";

// 0.01 deg of longitude at 31 S is about 950 m, so pieces 0.01 deg apart end-to-end touch
// only where they share an end.
const piece = (
  id: string,
  from: number,
  to: number,
  extra: Partial<RankPiece> = {},
): RankPiece => ({
  id,
  river: "quinto",
  ranked: false,
  rank: 1,
  ends: [
    [-64 + from, -31],
    [-64 + to, -31],
  ],
  ...extra,
});

describe("propagatePieceRanks", () => {
  it("takes the largest neighbour rank along a chain, else the nearest ranked piece's", () => {
    const r = propagatePieceRanks(
      [
        piece("a", 0, 0.01, { ranked: true, rank: 5 }),
        piece("fill", 0.01, 0.02),
        piece("b", 0.02, 0.03, { ranked: true, rank: 6 }),
        // A chain of two unranked pieces after b: both get its rank.
        piece("f1", 0.03, 0.04),
        piece("f2", 0.04, 0.05),
        // Another river's piece at the same place does not count.
        piece("x", 0.05, 0.06, { river: "dulce", ranked: true, rank: 9 }),
        piece("far", 0.2, 0.21),
      ],
      100,
    );
    expect(r.ranks.get("fill")).toBe(6);
    expect(r.ranks.get("f1")).toBe(6);
    expect(r.ranks.get("f2")).toBe(6);
    // far touches nothing: it takes the rank of the nearest ranked piece of its river (b)
    expect(r.ranks.get("far")).toBe(6);
    expect(r.unreached.map((u) => u.id)).toEqual(["far"]);
  });
});
