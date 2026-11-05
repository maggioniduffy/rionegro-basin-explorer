import { describe, expect, it } from "vitest";
import {
  nameKey,
  selectPieces,
  type PieceRow,
} from "../pipeline/steps/effluent-pieces";

const piece = (
  pieceId: string,
  lineId: string,
  reach: number | null,
  name: string | null,
  lengthM = 100,
): PieceRow => ({ pieceId, lineId, reach, name, lengthM });

describe("selectPieces", () => {
  const net = new Set([1, 2, 3]);
  const names = new Map([[1, ["Río Icho Cruz"]]]);

  it("drops a tributary stub named differently, keeps same-name and unnamed pieces of a named reach", () => {
    const rows = [
      piece("a#0", "a", 1, "Río Icho Cruz"),
      piece("b#0", "b", 1, "Arroyo del Durazno"),
      piece("c#0", "c", 1, null),
      piece("d#0", "d", 1, "ARROYO  Icho  Cruz"),
      piece("e#0", "e", 9, "Arroyo Fuera"),
    ];
    const { pieces, counts } = selectPieces(rows, net, names);
    expect(pieces.get(1)).toEqual(["a#0", "c#0", "d#0"]);
    expect(counts).toEqual({
      total: 4,
      kept: 3,
      droppedByName: 1,
      droppedByLine: 0,
      reachesWithPieces: 1,
    });
  });

  it("decides a piece of an unnamed reach by where most of its line runs", () => {
    const rows = [
      // line L: 800 m on reach 3, 100 m on the unnamed reach 2 -> the piece on 2 is a stub
      piece("L#0", "L", 3, null, 800),
      piece("L#1", "L", 2, null, 100),
      // line M: spread over reaches 2 and 3 with no majority -> kept
      piece("M#0", "M", 2, null, 300),
      piece("M#1", "M", 3, null, 300),
    ];
    const { pieces, counts } = selectPieces(rows, net, new Map());
    expect(pieces.get(2)).toEqual(["M#0"]);
    expect(pieces.get(3)).toEqual(["L#0", "M#1"]);
    expect(counts.droppedByLine).toBe(1);
    expect(counts.reachesWithPieces).toBe(2);
  });

  it("ignores accents, case and a leading Río/Arroyo only", () => {
    expect(nameKey("Río  Saldán")).toBe(nameKey("arroyo SALDAN"));
    expect(nameKey("Brazo Río Carnero")).not.toBe(nameKey("Río Carnero"));
  });
});
