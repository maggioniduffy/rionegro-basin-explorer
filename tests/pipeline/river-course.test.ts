import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CourseInput,
  type CoursePiece,
  type Endpoint,
  type PieceKind,
  type RiverLinesConfig,
  buildCourse,
  endKey,
  findReceiver,
  processingOrder,
  type NearPiece,
  classExcluded,
  ownNameKeys,
  parseRiverLinesConfig,
  pieceKind,
  planGapFill,
  receiverPieces,
  snapClusters,
  type FillEdge,
} from "../../pipeline/lib/river-course";

const config: RiverLinesConfig = {
  snapM: 50,
  corridorM: 5000,
  gapSearchM: 60000,
  gapNeighbours: 6,
  weights: { own: 1, unnamed: 1.5, other: 3, gap: 10 },
  excludeClasses: [],
  mouthLakeIds: ["lake"],
  lakeTouchM: 500,
  ownShareTarget: 0.95,
  anchorMaxM: 10000,
  extensionGapM: 500,
  attachM: 500,
  fillCorridorM: 3000,
  fillSnapM: 100,
  fillMaxStretch: 2,
  armMaxFromCourseM: 5000,
};

type P = [number, number];
const ep = (p: P, lake?: number): Endpoint => ({
  x: p[0],
  y: p[1],
  lon: p[0] / 1e5,
  lat: p[1] / 1e5,
  lake: lake === undefined ? null : { id: "lake", distM: lake },
});
/** A piece from `a` to `b`; length is the straight distance unless given. */
const piece = (
  id: string,
  kind: PieceKind,
  a: P,
  b: P,
  extra: { lakeB?: number; lengthM?: number } = {},
): CoursePiece => ({
  id,
  kind,
  lengthM: extra.lengthM ?? Math.hypot(a[0] - b[0], a[1] - b[1]),
  a: ep(a),
  b: ep(b, extra.lakeB),
});
const run = (
  pieces: CoursePiece[],
  source: P,
  mouth: P,
  claimed: string[] = [],
  cfg: Partial<RiverLinesConfig> = {},
  near: Pick<CourseInput, "nearHeld" | "nearCourse"> = {},
) =>
  buildCourse({
    ...near,
    pieces,
    claimed: new Set(claimed),
    source: { x: source[0], y: source[1] },
    mouth: { x: mouth[0], y: mouth[1] },
    config: { ...config, ...cfg },
  } satisfies CourseInput);
const ids = (r: ReturnType<typeof run>) => r.entries.map((e) => e.id);

describe("snapClusters", () => {
  it("joins points within snapM, chaining, and keeps the others apart", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 }, // 40 m from the second: chains into the first cluster
      { x: 1000, y: 0 },
      { x: 1000, y: 49 },
      { x: 0, y: 300 },
    ];
    expect(snapClusters(pts, 50)).toEqual([0, 0, 0, 1, 1, 2]);
  });
  it("labels by first appearance, so the order of the points decides", () => {
    const pts = [
      { x: 500, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(snapClusters(pts, 50)).toEqual([0, 1, 1]);
  });
});

describe("pieceKind, ownNameKeys, classExcluded", () => {
  const keys = ownNameKeys({
    name: "Río Tercero",
    type: "Río",
    aliases: ["Ctalamochita"],
  });
  it("matches the name, the alias, and the name after stripping a parenthesised alias", () => {
    expect(pieceKind("Río Tercero", keys)).toBe("own");
    expect(pieceKind("Río Tercero (Ctalamochita)", keys)).toBe("own");
    expect(pieceKind("Río Ctalamochita", keys)).toBe("own");
    expect(pieceKind("Río Cuarto", keys)).toBe("other");
    expect(pieceKind(null, keys)).toBe("unnamed");
  });
  it("matches classes without case or accents", () => {
    expect(classExcluded("Canal", ["canal"])).toBe(true);
    expect(classExcluded("Cañada", ["canada"])).toBe(true);
    expect(classExcluded("Arroyo", ["canal"])).toBe(false);
    expect(classExcluded(null, ["canal"])).toBe(false);
    expect(classExcluded("Canal", [])).toBe(false);
  });
});

describe("parseRiverLinesConfig", () => {
  it("accepts a complete config and the committed cba config", () => {
    expect(parseRiverLinesConfig(config)).toEqual(config);
    const file = path.join(
      import.meta.dirname,
      "../../regions/cba/river-lines.config.json",
    );
    const cba = parseRiverLinesConfig(JSON.parse(readFileSync(file, "utf8")));
    expect(cba.mouthLakeIds).toEqual(["aprhi-nat-1582"]);
  });
  it("rejects a missing or non-positive setting", () => {
    expect(() =>
      parseRiverLinesConfig({ ...config, snapM: undefined }),
    ).toThrow(/snapM/);
    expect(() => parseRiverLinesConfig({ ...config, snapM: 0 })).toThrow(
      /snapM/,
    );
    expect(() =>
      parseRiverLinesConfig({ ...config, weights: { own: 1 } }),
    ).toThrow(/weights\.unnamed/);
    expect(() =>
      parseRiverLinesConfig({ ...config, mouthLakeIds: "lake" }),
    ).toThrow(/mouthLakeIds/);
  });
});

describe("buildCourse", () => {
  it("chains pieces whose endpoints are within snapM, mouth first", () => {
    const r = run(
      [
        piece("p1", "own", [0, 0], [1000, 0]),
        piece("p2", "own", [1010, 20], [2000, 0]),
        piece("p3", "own", [2030, 10], [3000, 0]),
      ],
      [0, 0],
      [3000, 0],
    );
    expect(r.failure).toBeNull();
    expect(r.entries.map((e) => [e.id, e.order, e.role])).toEqual([
      ["p3", 0, "own"],
      ["p2", 1, "own"],
      ["p1", 2, "own"],
    ]);
    expect(r.gaps).toEqual([]);
    expect(r.cut).toBeNull();
  });

  it("prefers own-named over other-named pieces, and unnamed over other", () => {
    const own = [
      piece("own1", "own", [0, 0], [1000, 800]),
      piece("own2", "own", [1000, 800], [2000, 0]),
    ];
    // direct but other-named: 2000 m × 3 = 6000 against 2 × 1281 m × 1 for the own detour
    const direct = piece("direct", "other", [0, 0], [2000, 0]);
    const r = run([...own, direct], [0, 0], [2000, 0]);
    expect(ids(r)).toEqual(["own2", "own1"]);
    expect(r.entries.every((e) => e.role === "own")).toBe(true);

    const unnamed = piece("unnamed", "unnamed", [0, 0], [2000, 0]);
    const r2 = run([unnamed, direct], [0, 0], [2000, 0]);
    expect(ids(r2)).toEqual(["unnamed"]);
    expect(r2.entries[0]!.role).toBe("bridge");
    // an other-named piece is the only link: used, as a bridge
    const r3 = run([direct], [0, 0], [2000, 0]);
    expect(r3.entries.map((e) => [e.id, e.role])).toEqual([
      ["direct", "bridge"],
    ]);
  });

  it("uses a virtual gap edge only when no piece connects, and records it", () => {
    const a = piece("a", "own", [0, 0], [1000, 0]);
    const b = piece("b", "own", [1600, 0], [2600, 0]);
    const r = run([a, b], [0, 0], [2600, 0]);
    expect(r.failure).toBeNull();
    expect(ids(r)).toEqual(["b", "a"]);
    expect(r.gaps).toEqual([
      {
        kind: "path",
        from: [0.01, 0],
        to: [0.016, 0],
        km: 0.6,
        downOrder: 0,
        upOrder: 1,
      },
    ]);
    // pieces that connect leave no gap, even with another component in reach
    const joined = run(
      [
        a,
        piece("b2", "own", [1000, 0], [2000, 0]),
        piece("far", "other", [5000, 0], [6000, 0]),
      ],
      [0, 0],
      [2000, 0],
    );
    expect(joined.gaps).toEqual([]);
  });

  it("fails, with no course, when the only link is farther than gapSearchM", () => {
    const r = run(
      [
        piece("a", "own", [0, 0], [1000, 0]),
        piece("b", "own", [90000, 0], [91000, 0]),
      ],
      [0, 0],
      [91000, 0],
    );
    expect(r.failure).toMatch(/no path/);
    expect(r.entries).toEqual([]);
  });

  it("extends the mouth along own-named pieces to a lake's shore", () => {
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [2000, 0]), // mouth anchor here
      piece("e1", "own", [2000, 0], [3000, 0]),
      piece("e2", "own", [3000, 0], [4000, 0], { lakeB: 120 }),
      piece("o1", "other", [2000, 0], [2000, 900], { lakeB: 10 }), // not own: never followed
    ];
    const r = run(pieces, [0, 0], [2000, 0]);
    expect(ids(r)).toEqual(["e2", "e1", "m2", "m1"]);
    expect(r.entries.map((e) => e.part)).toEqual([
      "mouth-extension",
      "mouth-extension",
      "main",
      "main",
    ]);
    expect(r.mouthExtension).toEqual({ lakeId: "lake", km: 2, pieces: 2 });
    // no extension when the shore is farther than lakeTouchM
    const far = run(
      pieces.map((p) =>
        p.id === "e2"
          ? piece("e2", "own", [3000, 0], [4000, 0], { lakeB: 900 })
          : p,
      ),
      [0, 0],
      [2000, 0],
    );
    expect(far.mouthExtension).toBeNull();
    expect(ids(far)).toEqual(["m2", "m1"]);
  });

  it("reports the lake the course already touches at its mouth, with no extension", () => {
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [2000, 0], { lakeB: 405 }),
    ];
    const r = run(pieces, [0, 0], [2000, 0]);
    expect(r.mouthExtension).toBeNull();
    expect(r.mouthLake).toEqual({ lakeId: "lake", distM: 405 });
    // an extension ends at the lake too; a course far from every lake reports none
    const ext = run(
      [
        piece("m1", "own", [0, 0], [1000, 0]),
        piece("e1", "own", [1000, 0], [2000, 0], { lakeB: 100 }),
      ],
      [0, 0],
      [1000, 0],
    );
    expect(ext.mouthLake).toEqual({ lakeId: "lake", distM: 100 });
    expect(
      run([piece("a", "own", [0, 0], [1000, 0])], [0, 0], [1000, 0]).mouthLake,
    ).toBeNull();
  });

  it("extends the source along own-named pieces to the farthest node", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("u1", "own", [0, 0], [0, 1000]),
      piece("u2", "own", [0, 1000], [0, 2500]),
      piece("side", "own", [0, 0], [-300, 0]), // shorter branch
      piece("wrongName", "other", [0, 2500], [0, 4000]), // never followed
    ];
    const r = run(pieces, [0, 0], [1000, 0]);
    expect(ids(r)).toEqual(["c1", "u1", "u2"]);
    expect(r.entries.map((e) => e.part)).toEqual([
      "main",
      "source-extension",
      "source-extension",
    ]);
    expect(r.sourceExtensionKm).toBeCloseTo(2.5, 6);
  });

  it("joins components by their closest pair of nodes, loops included", () => {
    // A ends at (1000,0); the loop has no dangling node, so the nearest-dangling rule never
    // reaches it. With gapNeighbours 1 only the closest-pair edge can link them.
    const loop = [
      piece("l1", "own", [1500, 0], [1900, 0]),
      piece("l2", "own", [1900, 0], [1900, 400]),
      piece("l3", "own", [1900, 400], [1500, 400]),
      piece("l4", "own", [1500, 400], [1500, 0]),
    ];
    const a = piece("a", "own", [0, 0], [1000, 0]);
    const r = run([a, ...loop], [0, 0], [1900, 400], [], { gapNeighbours: 1 });
    expect(r.failure).toBeNull();
    expect(ids(r)).toEqual(["l2", "l1", "a"]);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.km).toBeCloseTo(0.5, 6);
  });

  it("anchors on the nearest own-named node within anchorMaxM, else the nearest with an edge", () => {
    const pieces = [
      piece("p1", "own", [0, 0], [1000, 0]),
      piece("p2", "own", [1000, 0], [2000, 0]),
      piece("o", "other", [2000, 0], [2900, 0]), // nearer to the mouth point, not own
    ];
    const r = run(pieces, [0, 0], [3000, 0]);
    expect(ids(r)).toEqual(["p2", "p1"]);
    expect(r.anchorRule).toEqual({ source: "own", mouth: "own" });
    expect(r.anchorDistM.mouth).toBeCloseTo(1000, 6);
    const near = run(pieces, [0, 0], [3000, 0], [], { anchorMaxM: 500 });
    expect(ids(near)).toEqual(["o", "p2", "p1"]);
    expect(near.anchorRule.mouth).toBe("edge");
  });

  it("starts the mouth extension from the own-named anchor", () => {
    // the mouth point lies 8 km past the own line, which touches the lake
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [2000, 0]),
      piece("e1", "own", [2000, 0], [3000, 0], { lakeB: 440 }),
    ];
    const r = run(pieces, [0, 0], [11000, 0], [], { anchorMaxM: 9000 });
    expect(ids(r)).toEqual(["e1", "m2", "m1"]);
    expect(r.anchorRule.mouth).toBe("own");
    // the anchor is mid-line: the extension follows the own line to the lake
    const mid = run(pieces, [0, 0], [2000, 0]);
    expect(ids(mid)).toEqual(["e1", "m2", "m1"]);
    expect(mid.mouthExtension).toEqual({ lakeId: "lake", km: 1, pieces: 1 });
  });

  it("adds the own-named pieces joined to the course through own-named pieces as arms", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("c2", "own", [1000, 0], [2000, 0]),
      piece("a1", "own", [1000, 0], [1000, 800]),
      piece("a2", "own", [1000, 800], [1500, 800]),
      piece("o", "other", [1000, 0], [-300, -800]), // joins by an other-named piece
      piece("x", "own", [-300, -800], [-300, -1200]), // so x is not an arm
      piece("far", "own", [5000, 5000], [6000, 5000]),
    ];
    const r = run(pieces, [0, 0], [2000, 0]);
    expect(ids(r)).toEqual(["c2", "c1"]);
    expect(r.arms.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(r.arms[0]!.lengthM).toBeCloseTo(800, 6);
    // a claimed piece is never an arm
    const claimed = run(pieces, [0, 0], [2000, 0], ["a2"]);
    expect(claimed.arms.map((a) => a.id)).toEqual(["a1"]);
  });

  it("lets the mouth extension cross a break up to extensionGapM, recorded as a gap", () => {
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [2000, 0]),
      piece("e1", "own", [2300, 0], [3000, 0], { lakeB: 100 }),
    ];
    const r = run(pieces, [0, 0], [2000, 0]);
    expect(ids(r)).toEqual(["e1", "m2", "m1"]);
    expect(r.mouthExtension).toEqual({ lakeId: "lake", km: 0.7, pieces: 1 });
    expect(r.gaps).toEqual([
      {
        kind: "extension",
        from: [0.02, 0],
        to: [0.023, 0],
        km: 0.3,
        downOrder: 0,
        upOrder: 1,
      },
    ]);
    const wide = run(
      pieces.map((p) =>
        p.id === "e1"
          ? piece("e1", "own", [2600, 0], [3000, 0], { lakeB: 100 })
          : p,
      ),
      [0, 0],
      [2000, 0],
    );
    expect(wide.mouthExtension).toBeNull();
    expect(wide.gaps).toEqual([]);
  });

  it("ends the course where a lower arm leaves it when the anchor cannot reach the lake", () => {
    // the own line to the lake leaves the course 100 m from its node at (1000,0), beyond snapM
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [2000, 0]),
      piece("m3", "own", [2000, 0], [3000, 0]),
      piece("e1", "own", [1000, 100], [1000, 2000], { lakeB: 50 }),
    ];
    const r = run(pieces, [0, 0], [3000, 0]);
    expect(ids(r)).toEqual(["e1", "m1"]);
    expect(r.mouthExtension).toEqual({ lakeId: "lake", km: 1.9, pieces: 1 });
    expect(r.gaps.map((g) => [g.kind, g.downOrder, g.upOrder])).toEqual([
      ["extension", 0, 1],
    ]);
    expect(r.arms.map((a) => a.id)).toEqual(["m2", "m3"]);
  });

  it("lets the source extension cross a break too", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("u1", "own", [0, 400], [0, 1400]), // 400 m from the source node
    ];
    const r = run(pieces, [0, 0], [1000, 0]);
    expect(ids(r)).toEqual(["c1", "u1"]);
    expect(r.gaps.map((g) => [g.kind, g.km])).toEqual([["extension", 0.4]]);
    expect(r.sourceExtensionKm).toBeCloseTo(1, 6);
  });

  it("attaches an own-named line to the interior of a course piece within attachM, as an arm", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [4000, 0]),
      piece("c2", "own", [4000, 0], [5000, 0]),
      piece("a1", "own", [2000, 100], [2000, 2000]),
    ];
    const near = (distM: number): NearPiece => ({
      piece: "c1",
      distM,
      lon: 0.02,
      lat: 0,
    });
    const without = run(pieces, [0, 0], [5000, 0]);
    expect(without.arms).toEqual([]);
    const r = run(
      pieces,
      [0, 0],
      [5000, 0],
      [],
      {},
      {
        nearCourse: { [endKey("a1", 0)]: near(100) },
      },
    );
    expect(ids(r)).toEqual(["c2", "c1"]); // whole pieces only
    expect(r.arms.map((a) => a.id)).toEqual(["a1"]);
    expect(r.attachments).toEqual([
      {
        piece: "c1",
        armPiece: "a1",
        distM: 100,
        from: [0.02, 0],
        to: [0.02, 0.001],
      },
    ]);
    const far = run(
      pieces,
      [0, 0],
      [5000, 0],
      [],
      {},
      {
        nearCourse: { [endKey("a1", 0)]: near(700) },
      },
    );
    expect(far.arms).toEqual([]);
  });

  it("continues the mouth extension from a line attached to a course piece's interior", () => {
    const pieces = [
      piece("m1", "own", [0, 0], [1000, 0]),
      piece("m2", "own", [1000, 0], [5000, 0]),
      piece("m3", "own", [5000, 0], [6000, 0]),
      piece("e1", "own", [3000, 100], [3000, 3000], { lakeB: 50 }),
    ];
    const r = run(
      pieces,
      [0, 0],
      [6000, 0],
      [],
      {},
      {
        nearCourse: {
          [endKey("e1", 0)]: { piece: "m2", distM: 100, lon: 0.03, lat: 0 },
        },
      },
    );
    expect(ids(r)).toEqual(["e1", "m2", "m1"]);
    expect(r.mouthExtension).toEqual({ lakeId: "lake", km: 2.9, pieces: 1 });
    expect(r.gaps).toEqual([
      {
        kind: "attach",
        piece: "m2",
        from: [0.03, 0],
        to: [0.03, 0.001],
        km: 0.1,
        downOrder: 0,
        upOrder: 1,
      },
    ]);
    expect(r.arms.map((a) => a.id)).toEqual(["m3"]);
  });

  it("cuts at a node within attachM of the interior of a piece an earlier river holds", () => {
    const pieces = [
      piece("b1", "own", [0, 0], [1000, 0]),
      piece("b2", "own", [1000, 0], [2000, 0]),
      piece("b3", "own", [2000, 0], [3000, 0]),
    ];
    const held: NearPiece = { piece: "h", distM: 120, lon: 0.02, lat: 0.0012 };
    const r = run(
      pieces,
      [0, 0],
      [3000, 0],
      [],
      {},
      {
        nearHeld: { [endKey("b2", 1)]: held },
      },
    );
    expect(ids(r)).toEqual(["b2", "b1"]);
    expect(r.cut).toEqual({
      lon: 0.02,
      lat: 0,
      claimedPieces: ["h"],
      nearest: held,
    });
    // beyond attachM it is not a confluence
    const far = run(
      pieces,
      [0, 0],
      [3000, 0],
      [],
      {},
      {
        nearHeld: { [endKey("b2", 1)]: { ...held, distM: 900 } },
      },
    );
    expect(far.cut).toBeNull();
    expect(ids(far)).toEqual(["b3", "b2", "b1"]);
  });

  it("extends the course along own-named lines to a node another river holds (receiver extension) and stops there", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("a1", "own", [1000, 0], [1000, 500]),
      piece("a2", "own", [1000, 500], [1000, 1000]),
    ];
    const r = run(
      pieces,
      [0, 0],
      [1000, 0],
      [],
      {},
      {
        nearHeld: {
          [endKey("a1", 1)]: { piece: "h", distM: 50, lon: 0, lat: 0 },
        },
      },
    );
    // a1 goes on to the node another river holds (the receiver): the course continues and ends
    // there; a2 lies beyond it and is not entered
    expect(ids(r)).toEqual(["a1", "c1"]);
    expect(r.receiverExtension).toEqual({ km: 0.5, pieces: 1 });
    expect(r.arms).toEqual([]);
  });

  it("lets the arm search cross a break up to extensionGapM between own-named lines, never into a held node", () => {
    const pieces = (gap: number) => [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("a1", "own", [1000, 0], [1000, 1000]),
      piece("a2", "own", [1000, 1000 + gap], [1000, 2500]),
    ];
    const cfg = { extensionGapM: 600 };
    const crossed = run(pieces(485), [0, 0], [1000, 0], [], cfg);
    expect(crossed.arms.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(crossed.armBreaks).toEqual([
      {
        pieceA: "a1",
        pieceB: "a2",
        distM: 485,
        from: [0.01, 0.01],
        to: [0.01, 0.01485],
      },
    ]);
    // the course and its km are untouched by arms
    expect(ids(crossed)).toEqual(["c1"]);
    const far = run(pieces(700), [0, 0], [1000, 0], [], cfg);
    expect(far.arms.map((a) => a.id)).toEqual(["a1"]);
    expect(far.armBreaks).toEqual([]);
    // a node another river holds is not entered
    const held = run(pieces(485), [0, 0], [1000, 0], [], cfg, {
      nearHeld: {
        [endKey("a2", 0)]: { piece: "h", distM: 80, lon: 0, lat: 0 },
      },
    });
    expect(ids(held)).toEqual(["a1", "c1"]);
    expect(held.arms).toEqual([]);
    expect(held.armBreaks).toEqual([]);
  });

  it("extends the source upstream only: a braid that returns to the course becomes an arm", () => {
    const pieces = [
      piece("c1", "own", [0, 0], [1000, 0]),
      piece("u1", "own", [0, 0], [0, 400]), // upstream, shorter than the braid
      piece("b1", "own", [0, 0], [800, -500]),
      piece("b2", "own", [800, -500], [1000, 0]),
    ];
    const r = run(pieces, [0, 0], [1000, 0]);
    expect(ids(r)).toEqual(["c1", "u1"]);
    expect(r.entries.map((e) => e.part)).toEqual(["main", "source-extension"]);
    expect(r.arms.map((a) => a.id)).toEqual(["b1", "b2"]);
  });

  it("fails a river whose anchors resolve to one node", () => {
    const r = run([piece("p", "own", [0, 0], [1000, 0])], [0, 0], [10, 10]);
    expect(r.failure).toBe("source and mouth anchors coincide");
    expect(r.entries).toEqual([]);
  });

  it("counts the own-named pieces whose ends snap to one node", () => {
    const r = run(
      [
        piece("c1", "own", [0, 0], [1000, 0]),
        piece("tiny", "own", [500, 0], [520, 0]),
        piece("other", "other", [700, 0], [720, 0]),
      ],
      [0, 0],
      [1000, 0],
    );
    expect(r.collapsedOwn.count).toBe(1);
    expect(r.collapsedOwn.km).toBeCloseTo(0.02, 6);
  });

  it("cuts the course where it reaches a piece an earlier river holds", () => {
    const pieces = [
      piece("b1", "own", [0, 0], [1000, 0]),
      piece("b2", "own", [1000, 0], [2000, 0]),
      piece("claimed", "own", [2000, 0], [2000, 2000]), // the earlier river's course
    ];
    const r = run(pieces, [0, 0], [2000, 2000], ["claimed"]);
    expect(r.failure).toBeNull();
    expect(ids(r)).toEqual(["b2", "b1"]);
    expect(r.cut).toEqual({
      lon: 0.02,
      lat: 0,
      claimedPieces: ["claimed"],
      nearest: null,
    });
    expect(r.mouthExtension).toBeNull();
    // a claimed piece is never part of the course
    expect(ids(r)).not.toContain("claimed");
  });

  it("is deterministic: input order does not matter and ties go to the smaller piece id", () => {
    // two equal routes from (0,0) to (2000,0): through a1/a2 or b1/b2
    const pieces = [
      piece("b1", "unnamed", [0, 0], [1000, 300]),
      piece("b2", "unnamed", [1000, 300], [2000, 0]),
      piece("a1", "unnamed", [0, 0], [1000, -300]),
      piece("a2", "unnamed", [1000, -300], [2000, 0]),
    ];
    const first = run(pieces, [0, 0], [2000, 0]);
    expect(ids(first)).toEqual(["a2", "a1"]);
    for (const order of [
      [...pieces].reverse(),
      [pieces[2]!, pieces[0]!, pieces[3]!, pieces[1]!],
    ])
      expect(run(order, [0, 0], [2000, 0])).toEqual(first);
  });
});

describe("pipeline:river-lines without a config", () => {
  it("stops with a message for a region that has no river-lines.config.json", () => {
    const root = path.join(import.meta.dirname, "../..");
    expect(
      existsSync(path.join(root, "regions/nqn/river-lines.config.json")),
    ).toBe(false);
    const run = spawnSync(
      path.join(root, "node_modules/.bin/tsx"),
      ["pipeline/steps/river-lines.ts", "--region", "nqn"],
      { cwd: root, encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/no settings for region "nqn"/);
  });
});

describe("processing order", () => {
  it("finds the river a mouth flows into along NEXT_DOWN", () => {
    const nextDown = new Map([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ]);
    const riverOf = new Map([
      [1, "a"],
      [4, "b"],
    ]);
    expect(findReceiver("a", 1, nextDown, riverOf)).toBe("b");
    expect(findReceiver("b", 4, nextDown, riverOf)).toBeNull();
    // a loop in the chain ends the walk instead of hanging
    expect(
      findReceiver(
        "a",
        1,
        new Map([
          [1, 2],
          [2, 1],
        ]),
        riverOf,
      ),
    ).toBeNull();
  });
  it("puts a receiver before every river that flows into it, ties by the given order", () => {
    const order = processingOrder([
      { slug: "a", receiver: "c" },
      { slug: "b", receiver: null },
      { slug: "c", receiver: "d" },
      { slug: "d", receiver: null },
      { slug: "e", receiver: "gone" }, // receiver not in the list: free
    ]);
    expect(order).toEqual(["b", "d", "c", "a", "e"]);
    expect(() =>
      processingOrder([
        { slug: "a", receiver: "b" },
        { slug: "b", receiver: "a" },
      ]),
    ).toThrow(/cycle/);
  });
});

describe("gap fill", () => {
  const edge = (
    id: string,
    a: [number, number],
    b: [number, number],
    cost?: number,
  ): FillEdge => {
    const lengthM = Math.hypot(a[0] - b[0], a[1] - b[1]);
    return {
      id,
      lengthM,
      cost: cost ?? lengthM,
      a: { x: a[0], y: a[1], start: a[0] === 0, end: a[0] === 1000 },
      b: { x: b[0], y: b[1], start: b[0] === 0, end: b[0] === 1000 },
    };
  };
  it("takes the cheapest IGN chain that joins both gap ends, else HydroRIVERS", () => {
    const edges = [
      edge("x1", [0, 0], [500, 0]),
      edge("x2", [500, 10], [1000, 0]), // 10 m off the first end: within snap
      edge("detour", [0, 0], [1000, 0], 5000),
    ];
    const plan = planGapFill(edges, 50);
    expect(plan.src).toBe("ign");
    if (plan.src === "ign")
      expect(plan.chain.edges.map((e) => [e.id, e.reversed])).toEqual([
        ["x1", false],
        ["x2", false],
      ]);
    // the chain is broken by more than snapM: no IGN chain
    expect(
      planGapFill([edges[0]!, edge("x3", [600, 0], [1000, 0])], 50),
    ).toEqual({ src: "hydrorivers" });
  });
  it("cuts only against the receiver's pieces", () => {
    const held = new Map([
      ["p2", "dulce"],
      ["p1", "dulce"],
      ["q1", "saladillo"],
    ]);
    expect(receiverPieces(held, "dulce")).toEqual(["p1", "p2"]);
    expect(receiverPieces(held, null)).toEqual([]);
  });
});
