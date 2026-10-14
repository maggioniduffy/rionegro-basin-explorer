/**
 * The course of one river, assembled from the display line pieces (pipeline:river-lines,
 * WP 5.1). Pure: the step reads the pieces and the anchors from files and calls buildCourse.
 *
 * Graph: the endpoints of the candidate pieces are clustered within snapM into nodes (union-find,
 * deterministic); a piece is an edge weighted by length × the factor of its kind (own-named,
 * unnamed, other-named). Pieces another river already holds ("claimed") are not edges, but their
 * endpoints mark nodes where the course ends (a confluence). Virtual gap edges join dangling
 * nodes of different components within gapSearchM, weighted by straight distance × weights.gap,
 * so a real path is preferred and a gap is used only where the lines do not connect; a gap on the
 * course is returned, never filled. The course is the cheapest path from the source anchor to
 * the mouth anchor (Dijkstra, ties broken by edge index), cut at the first node another river
 * holds, or whose node lies within attachM of the interior of a held piece (nearHeld); then
 * extended past the mouth along own-named pieces to a mouth lake's shore, and upstream from the
 * source along own-named pieces to the node farthest from the mouth. Own-named pieces joined to
 * the course through own-named pieces, or attached to a course piece's interior within attachM
 * (nearCourse), are returned as arms. Breaks up to extensionGapM can be crossed by the extensions.
 *
 * A course that is not cut and reaches no mouth lake continues, along own-named pieces and breaks
 * up to extensionGapM, to the nearest node another river holds (the river it flows into): a lower
 * course the mouth anchor did not reach (R5.2, the Cuarto into the Saladillo).
 *
 * R5.2 gap fill (planGapFill): where the course has a path gap, the step offers the IGN line
 * pieces of the gap's corridor as edges; the cheapest chain that joins both ends fills the gap
 * (IGN first, owner), otherwise the step cuts the river's HydroRIVERS reaches between the ends.
 *
 * Coordinates are metres in a planar projection (the step uses South America Albers), with
 * lon/lat kept for the gaps and the cut. Every number comes from the config (RiverLinesConfig).
 */
import { ignMainName } from "./line-names";
import { nameKey } from "./names";

export type PieceKind = "own" | "unnamed" | "other";

export interface RiverLinesConfig {
  /** Endpoints within this distance (m) are one node. */
  snapM: number;
  /** Candidate pieces lie within this distance (m) of the river's reaches. */
  corridorM: number;
  /** Virtual gap edges join dangling nodes up to this far apart (m). */
  gapSearchM: number;
  /** Each dangling node gets virtual edges to at most this many nearest nodes of other components. */
  gapNeighbours: number;
  /** Edge weight factors: per metre of piece by kind, per metre of straight gap. */
  weights: { own: number; unnamed: number; other: number; gap: number };
  /** Piece classes (APRHI class or IGN class, case insensitive) that never join a course. */
  excludeClasses: string[];
  /** Lake ids (lakes.parquet) the course of a river that ends at them is extended to. */
  mouthLakeIds: string[];
  /** An endpoint within this distance (m) of a mouth lake touches it. */
  lakeTouchM: number;
  /** Warn when a river's course holds less than this share of its own-named candidate km. */
  ownShareTarget: number;
  /** An anchor takes the nearest own-named node within this distance (m) of the reach end. */
  anchorMaxM: number;
  /** The own-named extensions (mouth and source) cross breaks up to this long (m), each recorded as a gap. */
  extensionGapM: number;
  /** An endpoint within this distance (m) of the interior of another piece attaches to it. */
  attachM: number;
  /** Gap fill: IGN lines within this distance (m) of the gap's guide (straight line, HydroRIVERS path) are offered. */
  fillCorridorM: number;
  /** Gap fill: an IGN line end within this distance (m) of a gap end, or of another IGN line end, joins there. */
  fillSnapM: number;
  /** Gap fill: a chain or HydroRIVERS route is used only if no longer than this times the straight distance between the gap ends, plus 2 * fillSnapM. */
  fillMaxStretch: number;
  /** An arm piece farther than this (m) from the course (pieces and fill) is not part of the river. */
  armMaxFromCourseM: number;
}

const POSITIVE = [
  "snapM",
  "anchorMaxM",
  "extensionGapM",
  "attachM",
  "corridorM",
  "gapSearchM",
  "gapNeighbours",
  "lakeTouchM",
  "fillCorridorM",
  "fillSnapM",
  "fillMaxStretch",
  "armMaxFromCourseM",
] as const;
const WEIGHTS = ["own", "unnamed", "other", "gap"] as const;

/** Validate regions/<id>/river-lines.config.json; a missing or non-positive setting throws. */
export function parseRiverLinesConfig(raw: unknown): RiverLinesConfig {
  const c = raw as Partial<Record<string, unknown>> | null;
  if (c === null || typeof c !== "object")
    throw new Error("river-lines.config.json: expected an object");
  const positive = (v: unknown, name: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
      throw new Error(
        `river-lines.config.json: ${name} must be a positive number`,
      );
    return v;
  };
  const strings = (v: unknown, name: string) => {
    if (!Array.isArray(v) || v.some((s) => typeof s !== "string"))
      throw new Error(
        `river-lines.config.json: ${name} must be a list of strings`,
      );
    return v as string[];
  };
  const out = Object.fromEntries(
    POSITIVE.map((k) => [k, positive(c[k], k)]),
  ) as Record<(typeof POSITIVE)[number], number>;
  const w = (c.weights ?? {}) as Record<string, unknown>;
  const weights = Object.fromEntries(
    WEIGHTS.map((k) => [k, positive(w[k], `weights.${k}`)]),
  ) as RiverLinesConfig["weights"];
  const share = positive(c.ownShareTarget, "ownShareTarget");
  if (share > 1)
    throw new Error(
      "river-lines.config.json: ownShareTarget must be at most 1",
    );
  return {
    ...out,
    weights,
    excludeClasses: strings(c.excludeClasses, "excludeClasses"),
    mouthLakeIds: strings(c.mouthLakeIds, "mouthLakeIds"),
    ownShareTarget: share,
  };
}

/** Name keys a river's own pieces carry: its name, its aliases and "<type> <alias>". */
export function ownNameKeys(river: {
  name: string;
  type?: string;
  aliases?: readonly string[];
}): Set<string> {
  const keys = new Set([nameKey(river.name)]);
  for (const alias of river.aliases ?? []) {
    keys.add(nameKey(alias));
    if (river.type) keys.add(nameKey(`${river.type} ${alias}`));
  }
  keys.delete("");
  return keys;
}

/**
 * A piece's kind for one river from its display name (lib/piece-names.ts; null = shows none):
 * own when its name key, after stripping a parenthesised alias, is one of the river's.
 */
export function pieceKind(
  displayName: string | null,
  ownKeys: ReadonlySet<string>,
): PieceKind {
  if (displayName === null) return "unnamed";
  return ownKeys.has(nameKey(ignMainName(displayName))) ? "own" : "other";
}

/** True when a piece class is listed in `excludeClasses` (case and accent insensitive). */
export function classExcluded(
  cls: string | null,
  excludeClasses: readonly string[],
): boolean {
  if (cls === null) return false;
  const key = nameKey(cls);
  return excludeClasses.some((c) => nameKey(c) === key);
}

export interface Endpoint {
  x: number;
  y: number;
  lon: number;
  lat: number;
  /** Nearest mouth lake and its distance (m), set where it is within reach of the lake. */
  lake?: { id: string; distM: number } | null;
}
export interface CoursePiece {
  id: string;
  lengthM: number;
  kind: PieceKind;
  a: Endpoint;
  b: Endpoint;
}
/** The nearest point on another piece: the piece, the distance (m) and the point's lon/lat. */
export interface NearPiece {
  piece: string;
  distM: number;
  lon: number;
  lat: number;
}
/** Key of a piece endpoint (0 = first, 1 = last vertex) in the near maps. */
export const endKey = (pieceId: string, end: number) => `${pieceId}|${end}`;

export interface CourseInput {
  pieces: readonly CoursePiece[];
  /** Pieces another river holds; they end this course and are never part of it. */
  claimed: ReadonlySet<string>;
  /** Upstream end of the river's most upstream reach, and downstream end of its mouth reach. */
  source: { x: number; y: number };
  mouth: { x: number; y: number };
  /**
   * Endpoints of the candidates within attachM of the interior of a piece another river holds
   * (the step measures them): the node counts as held, so the course is cut there.
   */
  nearHeld?: Readonly<Record<string, NearPiece>>;
  /**
   * Endpoints of own-named candidates within attachM of the interior of a piece of this river's
   * course (measured against a first pass): the line attaches to the course there, as an arm
   * or, for the mouth extension, as the continuation.
   */
  nearCourse?: Readonly<Record<string, NearPiece>>;
  /** Pieces of the river this one flows into; the only ones a receiver extension may end at. */
  receiver?: ReadonlySet<string>;
  config: Pick<
    RiverLinesConfig,
    | "snapM"
    | "gapSearchM"
    | "gapNeighbours"
    | "weights"
    | "mouthLakeIds"
    | "lakeTouchM"
    | "anchorMaxM"
    | "extensionGapM"
    | "attachM"
  >;
}

export type AnchorRule = "own" | "edge" | "any";
export type CoursePart = "mouth-extension" | "main" | "source-extension";
export interface CourseEntry {
  id: string;
  kind: PieceKind;
  /** own = an own-named piece; bridge = an unnamed or other-named piece on the course. */
  role: "own" | "bridge";
  /** 0 at the mouth end. */
  order: number;
  lengthM: number;
  part: CoursePart;
}
export interface CourseGap {
  /**
   * path = on the cheapest path; extension = a break an own-named extension crosses; attach = an
   * own-named line joined to the interior of a course piece (from = the point on `piece`, to =
   * the line's end).
   */
  kind: "path" | "extension" | "attach";
  /** The course piece an attach gap joins. */
  piece?: string;
  /** Upstream and downstream end, lon/lat rounded to 1e-5. */
  from: [number, number];
  to: [number, number];
  km: number;
  /** Order of the course piece just downstream / upstream of the gap (null at an end). */
  downOrder: number | null;
  upOrder: number | null;
}
/** A break an arm crosses between two own-named lines of the river. */
export interface ArmBreak {
  /** The piece on the course side and the piece it reaches across the break. */
  pieceA: string;
  pieceB: string;
  distM: number;
  from: [number, number];
  to: [number, number];
}
/** An arm joined to the interior of a course piece. */
export interface Attachment {
  /** The course piece. */
  piece: string;
  /** The arm piece whose end attaches. */
  armPiece: string;
  distM: number;
  from: [number, number];
  to: [number, number];
}
export interface CourseResult {
  entries: CourseEntry[];
  gaps: CourseGap[];
  /** Arms joined to a course piece's interior (not through a shared node). */
  attachments: Attachment[];
  /** Breaks (up to extensionGapM) the arm search crossed between own-named lines. */
  armBreaks: ArmBreak[];
  /**
   * Set when the course ends at a node another river holds; `nearest` is the piece and point it
   * was within attachM of, when the node does not touch that river's piece.
   */
  cut: {
    lon: number;
    lat: number;
    claimedPieces: string[];
    nearest: NearPiece | null;
  } | null;
  /** Own-named pieces left out because both ends snap to one node. */
  collapsedOwn: { count: number; km: number };
  mouthExtension: { lakeId: string; km: number; pieces: number } | null;
  /** Own-named continuation from the mouth anchor to a node another river holds (the course is cut there). */
  receiverExtension: { km: number; pieces: number } | null;
  /** Where the course ends (the node past any extension); null when it failed. */
  mouthPoint: { x: number; y: number; lon: number; lat: number } | null;
  /** The mouth lake the course's mouth end itself touches (within lakeTouchM), extension or not. */
  mouthLake: { lakeId: string; distM: number } | null;
  sourceExtensionKm: number;
  /** Unclaimed own-named pieces connected to the course through own-named pieces only; not part of the course. */
  arms: { id: string; lengthM: number }[];
  /** Distance (m) from each anchor point to the node it snapped to. */
  anchorDistM: { source: number; mouth: number };
  /** Which rule chose each anchor: own = nearest node touching an own-named piece within anchorMaxM, edge = nearest node with a real edge, any = nearest node. */
  anchorRule: { source: AnchorRule | null; mouth: AnchorRule | null };
  /** Null when a course was found; the reason otherwise (entries is empty). */
  failure: string | null;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Cluster points within `snapM` of each other (single linkage). Returns one dense label per
 * point; labels are numbered by the smallest point index of each cluster, so the result depends
 * only on the order of `points`.
 */
export function snapClusters(
  points: readonly { x: number; y: number }[],
  snapM: number,
): number[] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    for (let c = i; parent[c] !== r;) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const cells = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / snapM);
  points.forEach((p, i) => {
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? [])
          if (Math.hypot(p.x - points[j]!.x, p.y - points[j]!.y) <= snapM)
            union(i, j);
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  const label = new Map<number, number>();
  return points.map((_, i) => {
    const r = find(i);
    let l = label.get(r);
    if (l === undefined) {
      l = label.size;
      label.set(r, l);
    }
    return l;
  });
}

interface Node {
  x: number;
  y: number;
  lon: number;
  lat: number;
  lake: { id: string; distM: number } | null;
  claimed: string[];
  /** Touches an unclaimed own-named piece. */
  own: boolean;
  /** The nearest point of a held piece within attachM of an endpoint here. */
  near: NearPiece | null;
}
interface Edge {
  a: number;
  b: number;
  w: number;
  lenM: number;
  /** Index into the sorted pieces; -1 for a virtual gap. */
  piece: number;
  /** A break an own-named extension may cross (only in the extension graph). */
  brk?: boolean;
  /** The attachment this break stands for (extension graph only). */
  attach?: NearPiece;
}

/** Binary min-heap on (distance, node). */
class Heap {
  private d: number[] = [];
  private n: number[] = [];
  get size() {
    return this.d.length;
  }
  private less(i: number, j: number) {
    return (
      this.d[i]! < this.d[j]! ||
      (this.d[i] === this.d[j] && this.n[i]! < this.n[j]!)
    );
  }
  private swap(i: number, j: number) {
    [this.d[i], this.d[j]] = [this.d[j]!, this.d[i]!];
    [this.n[i], this.n[j]] = [this.n[j]!, this.n[i]!];
  }
  push(dist: number, node: number) {
    this.d.push(dist);
    this.n.push(node);
    for (let i = this.d.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.d[0]!, this.n[0]!];
    const last = this.d.length - 1;
    this.swap(0, last);
    this.d.pop();
    this.n.pop();
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.d.length && this.less(l, m)) m = l;
      if (r < this.d.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/**
 * Dijkstra from `start`. `weight` gives an edge's cost, or null to skip it; `blocked` nodes are
 * never entered. Equal costs resolve to the smaller edge index, so the result does not depend
 * on iteration order. A `terminal` node can be reached but is not expanded.
 */
function dijkstra(
  nodeCount: number,
  edges: readonly Edge[],
  adj: readonly (readonly number[])[],
  start: number | readonly number[],
  weight: (e: Edge) => number | null,
  blocked: (node: number) => boolean = () => false,
  terminal: (node: number) => boolean = () => false,
) {
  const dist = new Array<number>(nodeCount).fill(Infinity);
  const prev = new Array<number>(nodeCount).fill(-1);
  const done = new Array<boolean>(nodeCount).fill(false);
  const heap = new Heap();
  for (const st of typeof start === "number" ? [start] : start) {
    dist[st] = 0;
    heap.push(0, st);
  }
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = true;
    if (terminal(u)) continue;
    for (const ei of adj[u]!) {
      const e = edges[ei]!;
      const w = weight(e);
      if (w === null) continue;
      const v = e.a === u ? e.b : e.a;
      if (done[v] || blocked(v)) continue;
      const nd = d + w;
      if (nd < dist[v]! || (nd === dist[v] && ei < prev[v]!)) {
        dist[v] = nd;
        prev[v] = ei;
        heap.push(nd, v);
      }
    }
  }
  return { dist, prev };
}

/** Edge indices from `start` to `target` following `prev`, in walking order; null if unreached. */
function walkBack(
  edges: readonly Edge[],
  prev: readonly number[],
  start: number,
  target: number,
): number[] | null {
  const path: number[] = [];
  for (let v = target; v !== start;) {
    const ei = prev[v]!;
    if (ei < 0) return null;
    path.push(ei);
    const e = edges[ei]!;
    v = e.a === v ? e.b : e.a;
  }
  return path.reverse();
}

/** The path to `target` from whichever start of a multi-start Dijkstra it descends from. */
function walkBackToRoot(
  edges: readonly Edge[],
  prev: readonly number[],
  target: number,
): { root: number; path: number[] } {
  const path: number[] = [];
  let v = target;
  while (prev[v]! >= 0) {
    const ei = prev[v]!;
    path.push(ei);
    const e = edges[ei]!;
    v = e.a === v ? e.b : e.a;
  }
  return { root: v, path: path.reverse() };
}

/** Assemble the course of one river. See the file header for the rules. */
export function buildCourse(input: CourseInput): CourseResult {
  const { config, claimed } = input;
  const pieces = [...input.pieces].sort((p, q) =>
    p.id < q.id ? -1 : p.id > q.id ? 1 : 0,
  );
  for (let i = 1; i < pieces.length; i++)
    if (pieces[i]!.id === pieces[i - 1]!.id)
      throw new Error(`river-course: duplicate piece ${pieces[i]!.id}`);

  // 1. Nodes: endpoints clustered within snapM.
  const ends = pieces
    .flatMap((p, i) => [
      { piece: i, end: 0, e: p.a },
      { piece: i, end: 1, e: p.b },
    ])
    .sort(
      (p, q) =>
        p.e.x - q.e.x || p.e.y - q.e.y || p.piece - q.piece || p.end - q.end,
    );
  const label = snapClusters(
    ends.map((s) => s.e),
    config.snapM,
  );
  const nodeOfEnd = pieces.map(() => [-1, -1] as [number, number]);
  const sums: { n: number; x: number; y: number; lon: number; lat: number }[] =
    [];
  const nodes: Node[] = [];
  ends.forEach((s, k) => {
    const id = label[k]!;
    let node = nodes[id];
    if (!node) {
      node = {
        x: 0,
        y: 0,
        lon: 0,
        lat: 0,
        lake: null,
        claimed: [],
        own: false,
        near: null,
      };
      nodes[id] = node;
      sums[id] = { n: 0, x: 0, y: 0, lon: 0, lat: 0 };
    }
    const sum = sums[id]!;
    sum.n++;
    sum.x += s.e.x;
    sum.y += s.e.y;
    sum.lon += s.e.lon;
    sum.lat += s.e.lat;
    nodeOfEnd[s.piece]![s.end] = id;
    const lake = s.e.lake;
    if (
      lake &&
      config.mouthLakeIds.includes(lake.id) &&
      lake.distM <= config.lakeTouchM &&
      (node.lake === null || lake.distM < node.lake.distM)
    )
      node.lake = lake;
    const pid = pieces[s.piece]!.id;
    if (claimed.has(pid) && !node.claimed.includes(pid)) node.claimed.push(pid);
    if (pieces[s.piece]!.kind === "own" && !claimed.has(pid)) node.own = true;
    const held = claimed.has(pid)
      ? undefined
      : input.nearHeld?.[endKey(pid, s.end)];
    if (held && held.distM <= config.attachM) {
      if (!node.claimed.includes(held.piece)) node.claimed.push(held.piece);
      if (!node.near || held.distM < node.near.distM) node.near = held;
    }
  });
  nodes.forEach((node, id) => {
    const s = sums[id]!;
    node.x = s.x / s.n;
    node.y = s.y / s.n;
    node.lon = s.lon / s.n;
    node.lat = s.lat / s.n;
    node.claimed.sort();
  });

  // 2. Edges: unclaimed pieces between two different nodes.
  const factor = (k: PieceKind) => config.weights[k];
  const edges: Edge[] = [];
  const collapsedOwn = { count: 0, km: 0 };
  pieces.forEach((p, i) => {
    if (claimed.has(p.id)) return;
    const [a, b] = nodeOfEnd[i]!;
    if (a === b) {
      if (p.kind === "own") {
        collapsedOwn.count++;
        collapsedOwn.km += p.lengthM / 1000;
      }
      return;
    }
    edges.push({
      a,
      b,
      w: p.lengthM * factor(p.kind),
      lenM: p.lengthM,
      piece: i,
    });
  });
  const degree = new Array<number>(nodes.length).fill(0);
  for (const e of edges) {
    degree[e.a]!++;
    degree[e.b]!++;
  }
  const comp = componentsOf(nodes.length, edges);

  // 3. Virtual gap edges between dangling nodes of different components.
  const dangling = Array.from(nodes, (_, i) => i).filter(
    (i) => degree[i] === 1 || nodes[i]!.claimed.length > 0,
  );
  const cellOf = (v: number) => Math.floor(v / config.gapSearchM);
  const grid = new Map<string, number[]>();
  for (const i of dangling) {
    const key = `${cellOf(nodes[i]!.x)},${cellOf(nodes[i]!.y)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  const gapKeys = new Set<string>();
  const gapEdges: Edge[] = [];
  for (const i of dangling) {
    const ni = nodes[i]!;
    const near: { j: number; d: number }[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cellOf(ni.x) + dx},${cellOf(ni.y) + dy}`) ??
          []) {
          if (j === i || comp[j] === comp[i]) continue;
          const d = Math.hypot(ni.x - nodes[j]!.x, ni.y - nodes[j]!.y);
          if (d <= config.gapSearchM) near.push({ j, d });
        }
    near.sort((p, q) => p.d - q.d || p.j - q.j);
    for (const { j, d } of near.slice(0, config.gapNeighbours)) {
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (gapKeys.has(key)) continue;
      gapKeys.add(key);
      gapEdges.push({
        a: Math.min(i, j),
        b: Math.max(i, j),
        w: d * config.weights.gap,
        lenM: d,
        piece: -1,
      });
    }
  }
  // Every pair of components within gapSearchM is also joined once, between their closest
  // nodes (any node): the nearest-dangling rule alone can leave components apart (loops,
  // dense braided lines), and then no path exists although the lines are chained.
  const linked = Array.from(nodes, (_, i) => i).filter(
    (i) => degree[i]! > 0 || nodes[i]!.claimed.length > 0,
  );
  const allGrid = new Map<string, number[]>();
  for (const i of linked) {
    const key = `${cellOf(nodes[i]!.x)},${cellOf(nodes[i]!.y)}`;
    const list = allGrid.get(key);
    if (list) list.push(i);
    else allGrid.set(key, [i]);
  }
  const closest = new Map<string, { i: number; j: number; d: number }>();
  for (const i of linked) {
    const ni = nodes[i]!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of allGrid.get(
          `${cellOf(ni.x) + dx},${cellOf(ni.y) + dy}`,
        ) ?? []) {
          if (j <= i || comp[j] === comp[i]) continue;
          const d = Math.hypot(ni.x - nodes[j]!.x, ni.y - nodes[j]!.y);
          if (d > config.gapSearchM) continue;
          const ca = Math.min(comp[i]!, comp[j]!);
          const cb = Math.max(comp[i]!, comp[j]!);
          const key = `${ca}|${cb}`;
          const best = closest.get(key);
          if (
            !best ||
            d < best.d ||
            (d === best.d && (i < best.i || (i === best.i && j < best.j)))
          )
            closest.set(key, { i, j, d });
        }
  }
  for (const { i, j, d } of closest.values()) {
    const key = `${i}|${j}`;
    if (gapKeys.has(key)) continue;
    gapKeys.add(key);
    gapEdges.push({
      a: i,
      b: j,
      w: d * config.weights.gap,
      lenM: d,
      piece: -1,
    });
  }
  gapEdges.sort((p, q) => p.a - q.a || p.b - q.b);
  edges.push(...gapEdges);
  const adj: number[][] = nodes.map(() => []);
  edges.forEach((e, ei) => {
    adj[e.a]!.push(ei);
    adj[e.b]!.push(ei);
  });

  // 4. Anchors: the nearest node (the source needs a real edge, else it could only gap away).
  const distTo = (i: number, p: { x: number; y: number }) =>
    Math.hypot(nodes[i]!.x - p.x, nodes[i]!.y - p.y);
  const nearest = (
    p: { x: number; y: number },
    eligible: (i: number) => boolean,
  ) => {
    let best = -1;
    let bestD = Infinity;
    nodes.forEach((n, i) => {
      if (!eligible(i)) return;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return { node: best, distM: bestD };
  };
  const failed = (
    failure: string,
    anchorDistM = { source: NaN, mouth: NaN },
    anchorRule: CourseResult["anchorRule"] = { source: null, mouth: null },
  ): CourseResult => ({
    entries: [],
    gaps: [],
    attachments: [],
    armBreaks: [],
    collapsedOwn: { count: 0, km: 0 },
    cut: null,
    mouthExtension: null,
    receiverExtension: null,
    mouthPoint: null,
    mouthLake: null,
    sourceExtensionKm: 0,
    arms: [],
    anchorDistM,
    anchorRule,
    failure,
  });
  if (nodes.length === 0) return failed("no candidate pieces");
  // An anchor takes the nearest node touching an own-named piece within anchorMaxM of the
  // reach end; else the nearest node with a real edge; else the nearest node.
  const anchor = (p: { x: number; y: number }) => {
    const own = nearest(
      p,
      (i) =>
        nodes[i]!.own && degree[i]! > 0 && distTo(i, p) <= config.anchorMaxM,
    );
    if (own.node >= 0) return { ...own, rule: "own" as AnchorRule };
    const edge = nearest(p, (i) => degree[i]! > 0);
    if (edge.node >= 0) return { ...edge, rule: "edge" as AnchorRule };
    return { ...nearest(p, () => true), rule: "any" as AnchorRule };
  };
  const src = anchor(input.source);
  const mth = anchor(input.mouth);
  const anchorDistM = { source: src.distM, mouth: mth.distM };
  const anchorRule = { source: src.rule, mouth: mth.rule };

  if (src.node === mth.node)
    return failed("source and mouth anchors coincide", anchorDistM, anchorRule);

  // 5. Course: cheapest path source -> mouth, cut at the first node another river holds.
  const { prev } = dijkstra(nodes.length, edges, adj, src.node, (e) => e.w);
  const path = walkBack(edges, prev, src.node, mth.node);
  if (path === null)
    return failed(
      "no path from the source anchor to the mouth anchor",
      anchorDistM,
      anchorRule,
    );
  const walk = [src.node];
  for (const ei of path) {
    const e = edges[ei]!;
    const u = walk[walk.length - 1]!;
    walk.push(e.a === u ? e.b : e.a);
  }
  let cutIndex = -1;
  for (let k = 1; k < walk.length; k++)
    if (nodes[walk[k]!]!.claimed.length > 0) {
      cutIndex = k;
      break;
    }
  const kept = cutIndex < 0 ? path : path.slice(0, cutIndex);
  const mouthNode = cutIndex < 0 ? mth.node : walk[cutIndex]!;
  let cutNode = cutIndex < 0 ? null : nodes[mouthNode]!;

  // Course items in walking order (source -> mouth).
  type Item =
    | { type: "piece"; piece: number; part: CoursePart }
    | {
        type: "gap";
        kind: CourseGap["kind"];
        from: [number, number];
        to: [number, number];
        km: number;
        piece?: string;
      };
  const items: Item[] = kept.map((ei, k): Item => {
    const e = edges[ei]!;
    if (e.piece >= 0) return { type: "piece", piece: e.piece, part: "main" };
    return {
      type: "gap",
      kind: "path",
      from: [nodes[walk[k]!]!.lon, nodes[walk[k]!]!.lat],
      to: [nodes[walk[k + 1]!]!.lon, nodes[walk[k + 1]!]!.lat],
      km: e.lenM / 1000,
    };
  });
  const onCourse = new Set<number>(
    items.flatMap((it) => (it.type === "piece" ? [it.piece] : [])),
  );
  let courseNodes = new Set<number>(walk.slice(0, kept.length + 1));

  // Extension graph: the real edges plus breaks (up to extensionGapM) between nodes touching
  // own-named pieces that no chain of own-named pieces joins, plus attachments (an own-named
  // endpoint within attachM of the interior of a main course piece, joined to the node at
  // the piece's downstream end).
  const isOwnEdge = (e: Edge) =>
    e.piece >= 0 && pieces[e.piece]!.kind === "own";
  const ownComp = componentsOf(nodes.length, edges.filter(isOwnEdge));
  const ownNodes = Array.from(nodes, (_, i) => i).filter(
    (i) => nodes[i]!.own && degree[i]! > 0,
  );
  const extCell = (v: number) => Math.floor(v / config.extensionGapM);
  const extGrid = new Map<string, number[]>();
  for (const i of ownNodes) {
    const key = `${extCell(nodes[i]!.x)},${extCell(nodes[i]!.y)}`;
    const list = extGrid.get(key);
    if (list) list.push(i);
    else extGrid.set(key, [i]);
  }
  const extEdges: Edge[] = [...edges];
  for (const i of ownNodes) {
    const ni = nodes[i]!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of extGrid.get(
          `${extCell(ni.x) + dx},${extCell(ni.y) + dy}`,
        ) ?? []) {
          if (j <= i || ownComp[j] === ownComp[i]) continue;
          const d = Math.hypot(ni.x - nodes[j]!.x, ni.y - nodes[j]!.y);
          if (d <= config.extensionGapM)
            extEdges.push({ a: i, b: j, w: d, lenM: d, piece: -1, brk: true });
        }
  }
  // Attachments to the interior of a main course piece (the step measured them against the
  // course of a first pass), best per node.
  const pieceIndex = new Map(pieces.map((p, i) => [p.id, i]));
  const downNodeOfPiece = new Map<number, number>();
  items.forEach((it, k) => {
    if (it.type === "piece") downNodeOfPiece.set(it.piece, walk[k + 1]!);
  });
  const attachBest = new Map<
    number,
    { node: number; arm: number; course: number; near: NearPiece }
  >();
  if (input.nearCourse)
    pieces.forEach((p, i) => {
      if (p.kind !== "own" || claimed.has(p.id) || onCourse.has(i)) return;
      for (const end of [0, 1]) {
        const near = input.nearCourse![endKey(p.id, end)];
        if (!near || near.distM > config.attachM) continue;
        const course = pieceIndex.get(near.piece);
        const node = nodeOfEnd[i]![end]!;
        if (course === undefined || !onCourse.has(course)) continue;
        if (nodes[node]!.claimed.length > 0) continue;
        const best = attachBest.get(node);
        if (!best || near.distM < best.near.distM)
          attachBest.set(node, { node, arm: i, course, near });
      }
    });
  const attachCands = [...attachBest.values()].sort(
    (p, q) =>
      p.near.distM - q.near.distM ||
      (pieces[p.arm]!.id < pieces[q.arm]!.id
        ? -1
        : pieces[p.arm]!.id > pieces[q.arm]!.id
          ? 1
          : 0),
  );
  for (const c of attachCands) {
    const down = downNodeOfPiece.get(c.course);
    if (down !== undefined && down !== c.node)
      extEdges.push({
        a: Math.min(down, c.node),
        b: Math.max(down, c.node),
        w: c.near.distM,
        lenM: c.near.distM,
        piece: -1,
        brk: true,
        attach: c.near,
      });
  }
  // The extension searches walk real pieces and breaks; the path gaps are not for them.
  const extAdj: number[][] = nodes.map(() => []);
  const allAdj: number[][] = nodes.map(() => []);
  extEdges.forEach((e, ei) => {
    allAdj[e.a]!.push(ei);
    allAdj[e.b]!.push(ei);
    if (e.piece < 0 && !e.brk) return;
    extAdj[e.a]!.push(ei);
    extAdj[e.b]!.push(ei);
  });
  const extWeight = (e: Edge) => {
    if (e.piece >= 0)
      return isOwnEdge(e) && !onCourse.has(e.piece) ? e.lenM : null;
    return e.brk ? e.lenM : null;
  };
  // Searches stop at the course and at nodes another river holds.
  const stopAt = (v: number) =>
    courseNodes.has(v) || nodes[v]!.claimed.length > 0;
  /** Items of an extension path walked from `start`; downstream = walking towards the mouth. */
  const extensionItems = (
    path: readonly number[],
    start: number,
    part: CoursePart,
    downstream: boolean,
  ) => {
    const out: Item[] = [];
    let km = 0;
    let pieceCount = 0;
    let u = start;
    for (const ei of path) {
      const e = extEdges[ei]!;
      const v = e.a === u ? e.b : e.a;
      if (e.piece >= 0) {
        out.push({ type: "piece", piece: e.piece, part });
        onCourse.add(e.piece);
        km += e.lenM / 1000;
        pieceCount++;
      } else if (e.attach) {
        // from = the point on the course piece, to = the node of the attached line
        const free = nodes[e.a === courseSide(e) ? e.b : e.a]!;
        out.push({
          type: "gap",
          kind: "attach",
          from: [e.attach.lon, e.attach.lat],
          to: [free.lon, free.lat],
          km: e.lenM / 1000,
          piece: e.attach.piece,
        });
      } else {
        const from = nodes[downstream ? u : v]!;
        const to = nodes[downstream ? v : u]!;
        out.push({
          type: "gap",
          kind: "extension",
          from: [from.lon, from.lat],
          to: [to.lon, to.lat],
          km: e.lenM / 1000,
        });
      }
      u = v;
    }
    return { items: out, km, pieceCount };
  };
  /** The course-side node of an attach edge (the downstream node of the course piece). */
  const courseSide = (e: Edge) =>
    downNodeOfPiece.get(pieceIndex.get(e.attach!.piece)!)!;
  const nearestLake = (dist: readonly number[]) => {
    let best = -1;
    nodes.forEach((n, i) => {
      if (n.lake === null || dist[i] === Infinity) return;
      if (best < 0 || n.lake.distM < nodes[best]!.lake!.distM) best = i;
    });
    return best;
  };

  // 6. Mouth extension to a lake's shore, along own-named pieces not on the course (crossing
  // breaks up to extensionGapM). From the mouth anchor; failing that, from any other node of
  // the course, which then ends there (the pieces below it leave the course, and become arms
  // when they are own-named).
  let mouthExtension: CourseResult["mouthExtension"] = null;
  let mouthEnd = mouthNode; // the node the course ends at, past the extension
  let downItems: Item[] = [];
  if (cutNode === null && config.mouthLakeIds.length > 0) {
    const fromAnchor = dijkstra(
      nodes.length,
      extEdges,
      extAdj,
      mouthNode,
      extWeight,
      stopAt,
    );
    const best = nearestLake(fromAnchor.dist);
    if (best >= 0) {
      const ext = walkBack(extEdges, fromAnchor.prev, mouthNode, best);
      if (ext !== null && ext.length > 0) {
        const r = extensionItems(ext, mouthNode, "mouth-extension", true);
        downItems = r.items;
        mouthEnd = best;
        mouthExtension = {
          lakeId: nodes[best]!.lake!.id,
          km: r.km,
          pieces: r.pieceCount,
        };
      }
    } else {
      const multi = dijkstra(
        nodes.length,
        extEdges,
        extAdj,
        walk.slice(1, kept.length),
        extWeight,
        stopAt,
      );
      const lakeNode = nearestLake(multi.dist);
      if (lakeNode >= 0) {
        const { root, path } = walkBackToRoot(extEdges, multi.prev, lakeNode);
        const attach = walk.indexOf(root);
        if (attach > 0 && path.length > 0) {
          for (const it of items.slice(attach))
            if (it.type === "piece") onCourse.delete(it.piece);
          items.length = attach;
          courseNodes = new Set(walk.slice(0, attach + 1));
          const r = extensionItems(path, root, "mouth-extension", true);
          downItems = r.items;
          mouthEnd = lakeNode;
          mouthExtension = {
            lakeId: nodes[lakeNode]!.lake!.id,
            km: r.km,
            pieces: r.pieceCount,
          };
        }
      }
    }
  }

  // 6b. No mouth lake reached and no cut: the own-named lines may go on past the mouth anchor
  // to a node the receiver holds (R5.2). The course ends there, as a cut at a confluence. A node
  // only other rivers hold blocks the search (R5.2 review); its length is bounded by the
  // own-named pieces and the breaks of up to extensionGapM it walks.
  let receiverExtension: CourseResult["receiverExtension"] = null;
  const receiver = input.receiver ?? new Set<string>();
  const atReceiver = (v: number) =>
    nodes[v]!.claimed.some((p) => receiver.has(p));
  if (cutNode === null && mouthExtension === null && receiver.size > 0) {
    const toHeld = dijkstra(
      nodes.length,
      extEdges,
      extAdj,
      mouthNode,
      extWeight,
      (v) =>
        courseNodes.has(v) || (nodes[v]!.claimed.length > 0 && !atReceiver(v)),
      atReceiver,
    );
    let held = -1;
    nodes.forEach((n, i) => {
      if (!atReceiver(i) || toHeld.dist[i] === Infinity) return;
      if (held < 0 || toHeld.dist[i]! < toHeld.dist[held]!) held = i;
    });
    if (held >= 0) {
      const ext = walkBack(extEdges, toHeld.prev, mouthNode, held);
      if (ext !== null && ext.length > 0) {
        const r = extensionItems(ext, mouthNode, "mouth-extension", true);
        downItems = r.items;
        mouthEnd = held;
        cutNode = nodes[held]!;
        receiverExtension = { km: r.km, pieces: r.pieceCount };
      }
    }
  }

  for (const it of downItems)
    if (it.type === "piece")
      for (const v of nodeOfEnd[it.piece]!) courseNodes.add(v);

  // 7. Source extension: upstream only. It starts at the source anchor when that is the end
  // of the course (one course edge), follows own-named pieces (crossing breaks) and takes the
  // node farthest from the mouth along the graph, if that is farther than the anchor itself;
  // a braid that returns towards the mouth is not followed (it becomes an arm).
  let upItems: Item[] = [];
  let sourceExtensionKm = 0;
  const sourceDegree = kept.filter((ei) => {
    const e = edges[ei]!;
    return e.a === src.node || e.b === src.node;
  }).length;
  if (sourceDegree === 1) {
    const fromMouth = dijkstra(
      nodes.length,
      extEdges,
      allAdj,
      mouthNode,
      (e) => e.lenM,
    ).dist;
    const own = dijkstra(
      nodes.length,
      extEdges,
      extAdj,
      src.node,
      extWeight,
      stopAt,
    );
    let far = -1;
    own.dist.forEach((d, i) => {
      if (i === src.node || d === Infinity) return;
      if (!(fromMouth[i]! > fromMouth[src.node]!) || fromMouth[i] === Infinity)
        return;
      if (
        far < 0 ||
        fromMouth[i]! > fromMouth[far]! ||
        (fromMouth[i] === fromMouth[far] && d > own.dist[far]!)
      )
        far = i;
    });
    if (far >= 0) {
      const ext = walkBack(extEdges, own.prev, src.node, far);
      if (ext !== null) {
        const r = extensionItems(ext, src.node, "source-extension", false);
        upItems = r.items;
        sourceExtensionKm = r.km;
      }
    }
  }

  // 8. Arms: unclaimed own-named pieces joined to the course through own-named pieces only,
  // or attached to the interior of a course piece within attachM; the search stops at nodes
  // another river holds.
  const seen = new Set<number>();
  const queue: number[] = [];
  const seed = (v: number) => {
    if (seen.has(v) || nodes[v]!.claimed.length > 0) return false;
    seen.add(v);
    queue.push(v);
    return true;
  };
  for (const it of [...downItems, ...items, ...upItems])
    if (it.type === "piece") for (const v of nodeOfEnd[it.piece]!) seed(v);
  const armPieces = new Set<number>();
  let head = 0;
  const armBreaks: ArmBreak[] = [];
  /** The smallest-id own piece at a node satisfying `ok`, if any. */
  const ownPieceAt = (v: number, ok: (piece: number) => boolean) => {
    let best = -1;
    for (const ei of adj[v]!) {
      const e = edges[ei]!;
      if (
        isOwnEdge(e) &&
        ok(e.piece) &&
        (best < 0 || pieces[e.piece]!.id < pieces[best]!.id)
      )
        best = e.piece;
    }
    return best;
  };
  const flood = () => {
    for (; head < queue.length; head++) {
      const u = queue[head]!;
      for (const ei of adj[u]!) {
        const e = edges[ei]!;
        if (!isOwnEdge(e) || onCourse.has(e.piece) || armPieces.has(e.piece))
          continue;
        armPieces.add(e.piece);
        seed(e.a === u ? e.b : e.a);
      }
      // A break (up to extensionGapM) between this river's own-named lines, never into a
      // node another river holds.
      for (const ei of extAdj[u]!) {
        const e = extEdges[ei]!;
        if (e.piece >= 0 || !e.brk || e.attach) continue;
        const v = e.a === u ? e.b : e.a;
        if (seen.has(v) || nodes[v]!.claimed.length > 0) continue;
        const from = ownPieceAt(u, (q) => onCourse.has(q) || armPieces.has(q));
        const to = ownPieceAt(v, (q) => !onCourse.has(q));
        if (from < 0 || to < 0) continue;
        seed(v);
        armBreaks.push({
          pieceA: pieces[from]!.id,
          pieceB: pieces[to]!.id,
          distM: e.lenM,
          from: [round5(nodes[u]!.lon), round5(nodes[u]!.lat)],
          to: [round5(nodes[v]!.lon), round5(nodes[v]!.lat)],
        });
      }
    }
  };
  flood();
  const attachments: Attachment[] = [];
  for (const c of attachCands) {
    if (!onCourse.has(c.course) || !seed(c.node)) continue;
    attachments.push({
      piece: c.near.piece,
      armPiece: pieces[c.arm]!.id,
      distM: c.near.distM,
      from: [round5(c.near.lon), round5(c.near.lat)],
      to: [round5(nodes[c.node]!.lon), round5(nodes[c.node]!.lat)],
    });
    flood();
  }
  const arms = [...armPieces]
    .map((i) => ({ id: pieces[i]!.id, lengthM: pieces[i]!.lengthM }))
    .sort((p, q) => (p.id < q.id ? -1 : 1));

  // Mouth first: the extension reversed, then the course reversed, then the source extension.
  const seq: Item[] = [...downItems.reverse(), ...items.reverse(), ...upItems];
  const entries: CourseEntry[] = [];
  const gaps: CourseGap[] = [];
  for (const it of seq) {
    if (it.type === "piece") {
      const p = pieces[it.piece]!;
      const order = entries.length;
      entries.push({
        id: p.id,
        kind: p.kind,
        role: p.kind === "own" ? "own" : "bridge",
        order,
        lengthM: p.lengthM,
        part: it.part,
      });
      for (const g of gaps) if (g.upOrder === null) g.upOrder = order;
    } else {
      const gap: CourseGap = {
        kind: it.kind,
        ...(it.piece ? { piece: it.piece } : {}),
        from: [round5(it.from[0]), round5(it.from[1])],
        to: [round5(it.to[0]), round5(it.to[1])],
        km: it.km,
        downOrder: entries.length > 0 ? entries.length - 1 : null,
        upOrder: null,
      };
      gaps.push(gap);
    }
  }
  return {
    entries,
    gaps,
    attachments,
    armBreaks,
    collapsedOwn,
    cut: cutNode
      ? {
          lon: round5(cutNode.lon),
          lat: round5(cutNode.lat),
          claimedPieces: cutNode.claimed,
          nearest: cutNode.near
            ? {
                ...cutNode.near,
                lon: round5(cutNode.near.lon),
                lat: round5(cutNode.near.lat),
              }
            : null,
        }
      : null,
    mouthExtension,
    receiverExtension,
    mouthPoint: {
      x: nodes[mouthEnd]!.x,
      y: nodes[mouthEnd]!.y,
      lon: nodes[mouthEnd]!.lon,
      lat: nodes[mouthEnd]!.lat,
    },
    mouthLake: nodes[mouthEnd]!.lake
      ? {
          lakeId: nodes[mouthEnd]!.lake!.id,
          distM: nodes[mouthEnd]!.lake!.distM,
        }
      : null,
    sourceExtensionKm,
    arms,
    anchorDistM,
    anchorRule,
    failure: null,
  };
}

/** Connected component label of each node over the edges (dense, by smallest node index). */
function componentsOf(count: number, edges: readonly Edge[]): number[] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  return parent.map((_, i) => find(i));
}

/**
 * The river a river's mouth flows into: the first reach on the NEXT_DOWN chain below its mouth
 * reach that belongs to another river (`riverOfReach`), or null when the chain ends first.
 */
export function findReceiver(
  river: string,
  mouthReach: number,
  nextDown: ReadonlyMap<number, number>,
  riverOfReach: ReadonlyMap<number, string>,
): string | null {
  const visited = new Set<number>([mouthReach]);
  for (
    let id = nextDown.get(mouthReach) ?? 0;
    id > 0 && !visited.has(id);
    id = nextDown.get(id) ?? 0
  ) {
    visited.add(id);
    const other = riverOfReach.get(id);
    if (other !== undefined && other !== river) return other;
  }
  return null;
}

/**
 * Processing order: a receiver before every river that flows into it, ties by the given
 * (names.json) order. A cycle among receivers throws.
 */
export function processingOrder(
  rivers: readonly { slug: string; receiver: string | null }[],
): string[] {
  const slugs = new Set(rivers.map((r) => r.slug));
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < rivers.length) {
    const next = rivers.find(
      (r) =>
        !done.has(r.slug) &&
        (r.receiver === null || !slugs.has(r.receiver) || done.has(r.receiver)),
    );
    if (!next)
      throw new Error(
        `river-lines: rivers flow into each other in a cycle (${rivers
          .filter((r) => !done.has(r.slug))
          .map((r) => r.slug)
          .join(", ")})`,
      );
    done.add(next.slug);
    order.push(next.slug);
  }
  return order;
}

/**
 * The pieces `receiver` holds. A course is cut only against the river it flows into (R5.1 review):
 * a line end near any other earlier river's piece is not a confluence.
 */
export function receiverPieces(
  claimedBy: ReadonlyMap<string, string>,
  receiver: string | null,
): string[] {
  if (receiver === null) return [];
  return [...claimedBy]
    .filter(([, river]) => river === receiver)
    .map(([id]) => id)
    .sort();
}

/** A vertex of a fill candidate; `start` / `end` mark the ends of the gap it lies within fillSnapM of. */
export interface FillPoint {
  x: number;
  y: number;
  start?: boolean;
  end?: boolean;
}
/** An IGN line part offered to fill a gap; `cost` is its length times the weight of its kind. */
export interface FillEdge {
  id: string;
  lengthM: number;
  cost: number;
  a: FillPoint;
  b: FillPoint;
}
export interface FillChain {
  /** Edges from the gap's upstream end to its downstream end; reversed = walked from b to a. */
  edges: { id: string; reversed: boolean }[];
  lengthM: number;
}
export type GapFillPlan =
  { src: "ign"; chain: FillChain } | { src: "hydrorivers" };

/**
 * Chooses the source of a gap's fill: the cheapest chain of IGN edges (endpoints within snapM
 * are one node) from a node at the gap's upstream end to one at its downstream end; when none
 * joins both ends, HydroRIVERS (the step cuts the river's reaches). Deterministic: edges are
 * sorted by id and ties resolve to the smaller edge index.
 */
export function planGapFill(
  edges: readonly FillEdge[],
  snapM: number,
): GapFillPlan {
  const sorted = [...edges].sort((p, q) =>
    p.id < q.id ? -1 : p.id > q.id ? 1 : 0,
  );
  const points = sorted.flatMap((e) => [e.a, e.b]);
  const label = snapClusters(points, snapM);
  const count = label.reduce((m, l) => Math.max(m, l + 1), 0);
  const starts = new Set<number>();
  const ends = new Set<number>();
  points.forEach((p, i) => {
    if (p.start) starts.add(label[i]!);
    if (p.end) ends.add(label[i]!);
  });
  const graph: Edge[] = [];
  sorted.forEach((e, i) => {
    const a = label[2 * i]!;
    const b = label[2 * i + 1]!;
    if (a !== b) graph.push({ a, b, w: e.cost, lenM: e.lengthM, piece: i });
  });
  const adj: number[][] = Array.from({ length: count }, () => []);
  graph.forEach((e, ei) => {
    adj[e.a]!.push(ei);
    adj[e.b]!.push(ei);
  });
  if (
    [...starts].some((n) => ends.has(n)) ||
    starts.size === 0 ||
    ends.size === 0
  )
    return { src: "hydrorivers" };
  const { dist, prev } = dijkstra(
    count,
    graph,
    adj,
    [...starts].sort((p, q) => p - q),
    (e) => e.w,
  );
  let best = -1;
  for (const n of [...ends].sort((p, q) => p - q))
    if (dist[n]! < Infinity && (best < 0 || dist[n]! < dist[best]!)) best = n;
  if (best < 0) return { src: "hydrorivers" };
  const { root, path } = walkBackToRoot(graph, prev, best);
  if (path.length === 0) return { src: "hydrorivers" };
  // Walk the path from its root to read each edge's direction.
  let u = root;
  const chain: FillChain = { edges: [], lengthM: 0 };
  for (const ei of path) {
    const e = graph[ei]!;
    chain.edges.push({ id: sorted[e.piece]!.id, reversed: e.a !== u });
    chain.lengthM += e.lenM;
    u = e.a === u ? e.b : e.a;
  }
  return { src: "ign", chain };
}

/** Vertices of a WKT LINESTRING ("LINESTRING (x y, x y)"); anything else throws. */
export function parseLineWkt(wkt: string): [number, number][] {
  const m = /^LINESTRING\s*\((.*)\)$/i.exec(wkt.trim());
  if (!m)
    throw new Error(
      `river-lines: expected a LINESTRING, got ${wkt.slice(0, 40)}`,
    );
  return m[1]!.split(",").map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map(Number);
    if (
      x === undefined ||
      y === undefined ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      throw new Error(`river-lines: bad coordinate "${pair}"`);
    return [x, y];
  });
}

/** Concatenates vertex lists in order, dropping a vertex equal to the one before it. */
export function joinLines(
  parts: readonly (readonly (readonly [number, number])[])[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const part of parts)
    for (const [x, y] of part) {
      const last = out[out.length - 1];
      if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
    }
  return out;
}

/** WKT LINESTRING of the vertices (at least two). */
export function lineWkt(
  points: readonly (readonly [number, number])[],
): string {
  if (points.length < 2)
    throw new Error("river-lines: a line needs two vertices");
  return `LINESTRING (${points.map(([x, y]) => `${x} ${y}`).join(", ")})`;
}
