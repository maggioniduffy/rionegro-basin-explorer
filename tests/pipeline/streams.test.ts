import { describe, expect, it } from "vitest";
import {
  type LineReach,
  type StreamReach,
  detectStreams,
  followIgnLines,
  resolveGapClaims,
  streamDrainage,
  streamId,
  subbasinMouths,
} from "../../pipeline/lib/streams";

const A = "arroyo blanco";
const B = "arroyo negro";

/** Reach helper: id, next down, IGN name key (or null), approved river. */
const r = (
  id: number,
  nextDown: number,
  key: string | null = null,
  river = false,
): StreamReach => ({ id, nextDown, key, river });

const ids = (reaches: StreamReach[], maxGap = 2, excluded: string[] = []) =>
  detectStreams(reaches, { maxGap, excludedKeys: new Set(excluded) });

describe("detectStreams", () => {
  it("keeps a connected same-name chain as one stream with its mouth", () => {
    // 3 → 2 → 1 → 0 (sea), all "arroyo blanco"
    const { streams } = ids([r(1, 0, A), r(2, 1, A), r(3, 2, A)]);
    expect(streams).toEqual([
      {
        id: "arroyo-blanco-1",
        key: A,
        mouth: 1,
        reachIds: [1, 2, 3],
        namedReachIds: [1, 2, 3],
        absorbedReachIds: [],
      },
    ]);
  });

  it("splits the same name in two disconnected places", () => {
    const { streams } = ids([r(1, 0, A), r(2, 1, A), r(10, 0, A)]);
    expect(streams.map((s) => s.id)).toEqual([
      "arroyo-blanco-1",
      "arroyo-blanco-10",
    ]);
  });

  it("joins across 1 and 2 unnamed reaches and absorbs them", () => {
    // gap of 1: 3 → (2) → 1
    const one = ids([r(1, 0, A), r(2, 1), r(3, 2, A)]).streams;
    expect(one).toHaveLength(1);
    expect(one[0]!.absorbedReachIds).toEqual([2]);
    // gap of 2: 4 → (3) → (2) → 1
    const two = ids([r(1, 0, A), r(2, 1), r(3, 2), r(4, 3, A)]).streams;
    expect(two).toHaveLength(1);
    expect(two[0]!.reachIds).toEqual([1, 2, 3, 4]);
    expect(two[0]!.absorbedReachIds).toEqual([2, 3]);
  });

  it("does not join across 3 unnamed reaches", () => {
    const { streams } = ids([
      r(1, 0, A),
      r(2, 1),
      r(3, 2),
      r(4, 3),
      r(5, 4, A),
    ]);
    expect(streams.map((s) => s.reachIds)).toEqual([[1], [5]]);
    expect(streams.every((s) => s.absorbedReachIds.length === 0)).toBe(true);
  });

  it("respects the gap tolerance: N = 0 needs adjacent reaches", () => {
    const reaches = [r(1, 0, A), r(2, 1), r(3, 2, A)];
    expect(ids(reaches, 0).streams).toHaveLength(2);
    expect(ids(reaches, 1).streams).toHaveLength(1);
  });

  it("does not join through a reach with another IGN name", () => {
    const { streams } = ids([r(1, 0, A), r(2, 1, B), r(3, 2, A)]);
    expect(streams.map((s) => s.id)).toEqual([
      "arroyo-blanco-1",
      "arroyo-blanco-3",
      "arroyo-negro-2",
    ]);
  });

  it("does not join through or absorb an approved-river reach", () => {
    const { streams } = ids([r(1, 0, A), r(2, 1, null, true), r(3, 2, A)]);
    expect(streams).toHaveLength(2);
    expect(streams.flatMap((s) => s.reachIds)).not.toContain(2);
  });

  it("leaves out approved-river names, which still break paths", () => {
    const { streams } = ids([r(1, 0, A), r(2, 1, "rio limay"), r(3, 2, A)], 2, [
      "rio limay",
    ]);
    expect(streams.map((s) => s.id)).toEqual([
      "arroyo-blanco-1",
      "arroyo-blanco-3",
    ]);
  });

  it("merges two same-name tributaries meeting at a same-name reach", () => {
    //  4 (A)   5 (A)
    //      \   /
    //       3 (unnamed)   6 (A) → (7) → 3
    //       |
    //       2 (A) → 1 (B) → 0
    const { streams } = ids([
      r(1, 0, B),
      r(2, 1, A),
      r(3, 2),
      r(4, 3, A),
      r(5, 3, A),
      r(6, 7, A),
      r(7, 3),
    ]);
    const blanco = streams.filter((s) => s.key === A);
    expect(blanco).toHaveLength(1);
    expect(blanco[0]).toMatchObject({
      id: "arroyo-blanco-2",
      mouth: 2,
      reachIds: [2, 3, 4, 5, 6, 7],
      namedReachIds: [2, 4, 5, 6],
      absorbedReachIds: [3, 7],
    });
  });

  it("keeps a confluence gap reach with the name that encloses it", () => {
    // 4 (A) and 5 (B) meet at gap 3, which flows into 2 (A): 3 is enclosed by A.
    const { streams, ambiguousGaps } = ids([
      r(2, 0, A),
      r(3, 2),
      r(4, 3, A),
      r(5, 3, B),
    ]);
    expect(ambiguousGaps).toEqual([]);
    expect(streams.find((s) => s.key === A)?.absorbedReachIds).toEqual([3]);
    expect(streams.find((s) => s.key === B)?.reachIds).toEqual([5]);
  });

  it("puts every named reach in exactly one stream", () => {
    const reaches = [r(1, 0, A), r(2, 1), r(3, 2, A), r(4, 0, B), r(5, 4, B)];
    const all = ids(reaches).streams.flatMap((s) => s.namedReachIds);
    expect(all.sort()).toEqual([1, 3, 4, 5]);
  });
});

describe("resolveGapClaims", () => {
  it("flags a gap reach claimed by two different streams", () => {
    const claims = new Map([
      [7, new Set(["arroyo-blanco-1"])],
      [8, new Set(["arroyo-blanco-1", "arroyo-negro-2"])],
    ]);
    expect([...resolveGapClaims(claims).contested]).toEqual([8]);
  });
});

describe("streamId", () => {
  it("slugs the name key and appends the mouth reach", () => {
    expect(streamId("arroyo ñirihuau", 60123456)).toBe(
      "arroyo-nirihuau-60123456",
    );
  });
});

describe("subbasinMouths", () => {
  const rivers = [
    { _id: "negro", mouthReach: 10 },
    { _id: "limay", mouthReach: 20 },
  ];
  it("maps the mouth reach of each river node, skipping endorheic nodes", () => {
    const nodes = [
      { id: "negro", kind: "river", river: "negro" },
      { id: "limay", kind: "river", river: "limay" },
      { id: "endorheic", kind: "endorheic" },
    ] as const;
    expect([...subbasinMouths(nodes, rivers)]).toEqual([
      [10, "negro"],
      [20, "limay"],
    ]);
  });
  it("fails when a node's river is unknown", () => {
    expect(() =>
      subbasinMouths([{ id: "x", kind: "river", river: "x" }], rivers),
    ).toThrow(/sub-basin x/);
  });
});

describe("streamDrainage", () => {
  // 1 → 2 → 3 → 4 → 0; 3 is on river "limay" (node mouth 4); 5 → 6 → 0 is endorheic.
  const net = {
    nextDown: new Map([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [5, 6],
      [6, 0],
    ]),
    river: new Map([[3, "limay"]]),
    endorheic: new Set([5, 6]),
    nodeByMouth: new Map([[4, "limay"]]),
    endorheicNode: "endorheic",
  };
  it("finds the sub-basin and the receiving river downstream of the mouth", () => {
    expect(streamDrainage(1, net)).toEqual({
      subbasin: "limay",
      receivingRiver: "limay",
    });
  });
  it("counts the mouth reach itself for the sub-basin, not for the receiving river", () => {
    expect(streamDrainage(3, net)).toEqual({
      subbasin: "limay",
      receivingRiver: null,
    });
  });
  it("puts an endorheic mouth in the endorheic node", () => {
    expect(streamDrainage(5, net)).toEqual({
      subbasin: "endorheic",
      receivingRiver: null,
    });
  });
  it("gives null for a mouth that reaches no node and is not endorheic", () => {
    expect(streamDrainage(1, { ...net, nodeByMouth: new Map() }).subbasin).toBe(
      null,
    );
  });
  it("stops on a cycle", () => {
    const cyc = {
      ...net,
      nextDown: new Map([
        [1, 2],
        [2, 1],
      ]),
    };
    expect(streamDrainage(1, cyc)).toEqual({
      subbasin: null,
      receivingRiver: null,
    });
  });
});

describe("followIgnLines", () => {
  const C = "rio currhue";
  /** Detect with gap 2, then keep the reaches on the IGN line (coverage ≥ 0.5). */
  const lines = (reaches: (StreamReach & { coverage?: number })[]) => {
    const groups = detectStreams(reaches, { maxGap: 2 }).streams;
    const byId = new Map<number, LineReach>(
      reaches.map((x) => [
        x.id,
        { id: x.id, nextDown: x.nextDown, coverage: x.coverage ?? 0 },
      ]),
    );
    return followIgnLines(groups, byId, { minCoverage: 0.5 });
  };
  const rc = (
    id: number,
    nextDown: number,
    key: string | null,
    coverage: number,
  ) => ({ ...r(id, nextDown, key), coverage });

  it("drops low spurs and an off-line upper reach (Río Currhué)", () => {
    // Line 1 ← 2 ← 3 ← 4 (coverage ≥ 0.5). Spurs 5 → 2 (0.25) and 6 → 3 (0.23);
    // 7 → 4 climbs away from the line (0.37).
    const { streams, droppedReachIds } = lines([
      rc(1, 0, C, 0.54),
      rc(2, 1, C, 0.89),
      rc(3, 2, C, 0.94),
      rc(4, 3, C, 0.98),
      rc(5, 2, C, 0.25),
      rc(6, 3, C, 0.23),
      rc(7, 4, C, 0.37),
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.id).toBe("rio-currhue-1");
    expect(streams[0]!.reachIds).toEqual([1, 2, 3, 4]);
    expect(droppedReachIds).toEqual([5, 6, 7]);
  });

  it("keeps low and unnamed reaches between two reaches on the line", () => {
    // 1 (0.9) ← 2 (0.3) ← 3 (unnamed) ← 4 (0.8)
    const { streams } = lines([
      rc(1, 0, A, 0.9),
      rc(2, 1, A, 0.3),
      rc(3, 2, null, 0),
      rc(4, 3, A, 0.8),
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.reachIds).toEqual([1, 2, 3, 4]);
    expect(streams[0]!.absorbedReachIds).toEqual([3]);
  });

  it("prunes a low mouth, and the stream starts at the first reach on the line", () => {
    const { streams, droppedReachIds } = lines([
      rc(1, 0, A, 0.2),
      rc(2, 1, A, 0.4),
      rc(3, 2, A, 0.9),
    ]);
    expect(streams.map((s) => s.id)).toEqual(["arroyo-blanco-3"]);
    expect(droppedReachIds).toEqual([1, 2]);
  });

  it("keeps both branches at a fork when the line runs along both", () => {
    const { streams } = lines([
      rc(1, 0, A, 0.9),
      rc(2, 1, A, 0.9),
      rc(3, 1, A, 0.7),
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.reachIds).toEqual([1, 2, 3]);
  });

  it("splits into two streams when a low mouth joined two branches on the line", () => {
    const { streams } = lines([
      rc(1, 0, A, 0.3),
      rc(2, 1, A, 0.9),
      rc(3, 1, A, 0.7),
    ]);
    expect(streams.map((s) => s.id)).toEqual([
      "arroyo-blanco-2",
      "arroyo-blanco-3",
    ]);
  });

  it("drops a group with no reach on the line", () => {
    const { streams, droppedReachIds } = lines([
      rc(1, 0, A, 0.45),
      rc(2, 1, A, 0.4),
    ]);
    expect(streams).toEqual([]);
    expect(droppedReachIds).toEqual([1, 2]);
  });

  it("leaves other names alone", () => {
    const { streams } = lines([rc(1, 0, A, 0.9), rc(2, 1, B, 0.3)]);
    expect(streams.map((s) => s.id)).toEqual(["arroyo-blanco-1"]);
  });
});
