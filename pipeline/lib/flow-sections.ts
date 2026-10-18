/**
 * Pure logic of pipeline:flow-sections (F1.1): the windows a river's course is cut into, the
 * stations along them, the wet span across the channel at each station, and the reason a
 * section is not flowable. The step reads the files, calls buildCourse (lib/river-course.ts)
 * and writes the JSON; nothing here touches the disk or DuckDB.
 *
 * Coordinates are metres in a planar projection (the step uses South America Albers), so lengths
 * and offsets are planar metres; lon/lat appear only in the step. Every threshold comes from
 * regions/<id>/flow.config.json (FlowConfig).
 */
import type { CourseInput } from "./river-course";

export type XY = [number, number];
/** The wet span across a channel in metres from the centerline: + is the left bank looking downstream. */
export type Span = [number, number];

export interface FlowConfig {
  /** Settings of buildCourse, plus the corridor (m) that picks a river's candidate IGN pieces. */
  course: CourseInput["config"] & { corridorM: number };
  /** Path gaps are filled from the river's HydroRIVERS reaches when the route is credible. */
  gapFill: { maxStretch: number; snapM: number };
  sections: {
    targetSectionKm: number;
    stationSpacingM: number;
    tangentWindowM: number;
  };
  span: {
    /** BH140 polygons within this distance (m) of a course vertex are loaded. */
    corridorM: number;
    maxSearchM: number;
    maxOffsetM: number;
    maxSpanM: number;
    /** Water intervals separated by less than this (m) are one (touching polygons). */
    mergeGapM: number;
    smoothStations: number;
    gridCellM: number;
  };
  flowable: { minSpanShare: number; minWidthM: number };
  /** Upper bound on the bytes of public/flow/<id>/. */
  maxTotalBytes: number;
}

const COURSE_POSITIVE = [
  "snapM",
  "corridorM",
  "gapSearchM",
  "gapNeighbours",
  "lakeTouchM",
  "anchorMaxM",
  "extensionGapM",
  "attachM",
] as const;
const WEIGHTS = ["own", "unnamed", "other", "gap"] as const;

/** Validate regions/<id>/flow.config.json; a missing or non-positive setting throws. */
export function parseFlowConfig(raw: unknown): FlowConfig {
  const fail = (msg: string): never => {
    throw new Error(`flow.config.json: ${msg}`);
  };
  const obj = (v: unknown, name: string) => {
    if (v === null || typeof v !== "object" || Array.isArray(v))
      return fail(`${name} must be an object`);
    return v as Record<string, unknown>;
  };
  const positive = (o: Record<string, unknown>, key: string, where: string) => {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
      return fail(`${where}${key} must be a positive number`);
    return v;
  };
  const root = obj(raw, "the file");
  const course = obj(root.course, "course");
  const weights = obj(course.weights, "course.weights");
  const ids = course.mouthLakeIds;
  if (!Array.isArray(ids) || ids.some((s) => typeof s !== "string"))
    fail("course.mouthLakeIds must be a list of strings");
  const gapFill = obj(root.gapFill, "gapFill");
  const sections = obj(root.sections, "sections");
  const span = obj(root.span, "span");
  const flowable = obj(root.flowable, "flowable");
  const minSpanShare = positive(flowable, "minSpanShare", "flowable.");
  if (minSpanShare > 1) fail("flowable.minSpanShare must be at most 1");
  const smooth = positive(span, "smoothStations", "span.");
  if (!Number.isInteger(smooth) || smooth % 2 === 0)
    fail("span.smoothStations must be an odd integer");
  return {
    course: {
      ...(Object.fromEntries(
        COURSE_POSITIVE.map((k) => [k, positive(course, k, "course.")]),
      ) as Record<(typeof COURSE_POSITIVE)[number], number>),
      weights: Object.fromEntries(
        WEIGHTS.map((k) => [k, positive(weights, k, "course.weights.")]),
      ) as FlowConfig["course"]["weights"],
      mouthLakeIds: ids as string[],
    },
    gapFill: {
      maxStretch: positive(gapFill, "maxStretch", "gapFill."),
      snapM: positive(gapFill, "snapM", "gapFill."),
    },
    sections: {
      targetSectionKm: positive(sections, "targetSectionKm", "sections."),
      stationSpacingM: positive(sections, "stationSpacingM", "sections."),
      tangentWindowM: positive(sections, "tangentWindowM", "sections."),
    },
    span: {
      corridorM: positive(span, "corridorM", "span."),
      maxSearchM: positive(span, "maxSearchM", "span."),
      maxOffsetM: positive(span, "maxOffsetM", "span."),
      maxSpanM: positive(span, "maxSpanM", "span."),
      mergeGapM: positive(span, "mergeGapM", "span."),
      smoothStations: smooth,
      gridCellM: positive(span, "gridCellM", "span."),
    },
    flowable: {
      minSpanShare,
      minWidthM: positive(flowable, "minWidthM", "flowable."),
    },
    maxTotalBytes: positive(root, "maxTotalBytes", ""),
  };
}

export const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// --- Windows -------------------------------------------------------------------------------

export interface SectionWindow {
  /** `<slug>-<nnn>`, counted from the source. */
  id: string;
  index: number;
  count: number;
  /** Arc-length range along the course (m, from the source). */
  s0: number;
  s1: number;
  /** Section length rounded to 0.1 m; the lengths of a course add up to its length. */
  lengthM: number;
  /** Upstream and downstream neighbours. */
  prev: string | null;
  next: string | null;
}

export const sectionId = (slug: string, index: number) =>
  `${slug}-${String(index).padStart(3, "0")}`;

/**
 * Cuts a course of `lengthM` into n = max(1, round(L / targetSectionKm)) equal windows. Lengths
 * are the differences of rounded boundaries, so they add up to the course length to 0.1 m.
 */
export function cutWindows(
  slug: string,
  lengthM: number,
  targetSectionKm: number,
): SectionWindow[] {
  if (!(lengthM > 0))
    throw new Error(`${slug}: course length must be positive`);
  const n = Math.max(1, Math.round(lengthM / (targetSectionKm * 1000)));
  const at = (i: number) => (i === n ? lengthM : (lengthM * i) / n);
  return Array.from({ length: n }, (_, i) => ({
    id: sectionId(slug, i),
    index: i,
    count: n,
    s0: at(i),
    s1: at(i + 1),
    lengthM: round(round(at(i + 1), 1) - round(at(i), 1), 1),
    prev: i > 0 ? sectionId(slug, i - 1) : null,
    next: i < n - 1 ? sectionId(slug, i + 1) : null,
  }));
}

// --- Polylines -----------------------------------------------------------------------------

const dist = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Cumulative arc length at each vertex (first is 0). */
export function cumLengths(p: readonly XY[]): number[] {
  const out = [0];
  for (let i = 1; i < p.length; i++)
    out.push(out[i - 1]! + dist(p[i - 1]!, p[i]!));
  return out;
}

/** Index i of the segment [i, i+1] that holds arc length s (clamped). */
export function segmentAt(cum: readonly number[], s: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The point at arc length s along the polyline (clamped to its ends). */
export function pointAt(
  p: readonly XY[],
  cum: readonly number[],
  s: number,
): XY {
  if (p.length === 1) return p[0]!;
  const total = cum[cum.length - 1]!;
  const t = Math.min(Math.max(s, 0), total);
  const i = segmentAt(cum, t);
  const len = cum[i + 1]! - cum[i]!;
  const f = len > 0 ? (t - cum[i]!) / len : 0;
  const a = p[i]!;
  const b = p[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** The vertices from arc length s0 to s1 (s0 <= s1), with the exact end points. */
export function sliceBetween(
  p: readonly XY[],
  cum: readonly number[],
  s0: number,
  s1: number,
): XY[] {
  const out: XY[] = [pointAt(p, cum, s0)];
  for (let i = 0; i < p.length; i++)
    if (cum[i]! > s0 && cum[i]! < s1) out.push(p[i]!);
  out.push(pointAt(p, cum, s1));
  return out;
}

/** The nearest point of a polyline to q: its arc length and its distance. */
export function locate(
  p: readonly XY[],
  cum: readonly number[],
  q: XY,
): { s: number; d: number } {
  if (p.length === 1) return { s: 0, d: dist(p[0]!, q) };
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const f =
      len2 > 0
        ? Math.min(
            1,
            Math.max(0, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / len2),
          )
        : 0;
    const d = Math.hypot(q[0] - (a[0] + vx * f), q[1] - (a[1] + vy * f));
    if (d < best.d) best = { s: cum[i]! + f * Math.sqrt(len2), d };
  }
  return best;
}

/** Unit tangent (downstream) at arc length s from the chord s ± halfM (clamped to the ends). */
export function tangentAt(
  p: readonly XY[],
  cum: readonly number[],
  s: number,
  halfM: number,
): XY {
  const total = cum[cum.length - 1]!;
  let a = pointAt(p, cum, s - halfM);
  let b = pointAt(p, cum, s + halfM);
  let d = dist(a, b);
  if (d === 0) {
    a = pointAt(p, cum, s - halfM * 4);
    b = pointAt(p, cum, s + halfM * 4);
    d = dist(a, b);
  }
  if (d === 0) {
    const i = segmentAt(cum, Math.min(Math.max(s, 0), total));
    a = p[i]!;
    b = p[i + 1] ?? p[i]!;
    d = dist(a, b);
  }
  return d === 0 ? [1, 0] : [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

/** Left normal: the tangent rotated +90 degrees (the left bank looking downstream). */
export const leftNormal = (t: XY): XY => [-t[1], t[0]];

/**
 * Station arc lengths of a window: s0, s0 + spacing, ... and s1. `pad` more stations on each
 * side (kept inside [0, total]) feed the running median; `from` and `to` bound the window's own.
 */
export function stationPositions(
  s0: number,
  s1: number,
  spacingM: number,
  total: number,
  pad: number,
): { s: number[]; from: number; to: number } {
  const inner = [s0];
  for (let k = 1; s0 + k * spacingM < s1 - 1e-6; k++)
    inner.push(s0 + k * spacingM);
  inner.push(s1);
  const before: number[] = [];
  for (let k = pad; k >= 1; k--)
    if (s0 - k * spacingM >= 0) before.push(s0 - k * spacingM);
  const after: number[] = [];
  for (let k = 1; k <= pad; k++)
    if (s1 + k * spacingM <= total) after.push(s1 + k * spacingM);
  return {
    s: [...before, ...inner, ...after],
    from: before.length,
    to: before.length + inner.length,
  };
}

// --- HydroRIVERS fill of path gaps -----------------------------------------------------------

export interface ReachLine {
  id: number;
  pathOrder: number;
  /** Vertices in flow direction (HydroRIVERS lines are digitised downstream). */
  pts: XY[];
  cum: number[];
  bbox: [number, number, number, number];
}

export const reachLine = (
  id: number,
  pathOrder: number,
  pts: XY[],
): ReachLine => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    id,
    pathOrder,
    pts,
    cum: cumLengths(pts),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
};

/** The reach nearest to p (bounding boxes prune the search); ties go to the smaller id. */
export function nearestReach(
  reaches: readonly ReachLine[],
  p: XY,
): { reach: ReachLine; d: number; s: number } {
  let best: { reach: ReachLine; d: number; s: number } | null = null;
  for (const r of reaches) {
    const dx = Math.max(r.bbox[0] - p[0], 0, p[0] - r.bbox[2]);
    const dy = Math.max(r.bbox[1] - p[1], 0, p[1] - r.bbox[3]);
    if (best && Math.hypot(dx, dy) > best.d) continue;
    const loc = locate(r.pts, r.cum, p);
    if (!best || loc.d < best.d || (loc.d === best.d && r.id < best.reach.id))
      best = { reach: r, d: loc.d, s: loc.s };
  }
  if (!best) throw new Error("flow-sections: no reaches to look up");
  return best;
}

/**
 * The river's HydroRIVERS path from `a` (upstream) to `b` (downstream), cut at the points
 * nearest them, with the exact ends. Null when no path joins them in flow order or the route
 * is longer than maxStretch times the straight distance plus 2 * snapM (a detour).
 */
export function hydroRoute(
  reaches: readonly ReachLine[],
  a: XY,
  b: XY,
  maxStretch: number,
  snapM: number,
): XY[] | null {
  const ra = nearestReach(reaches, a);
  const rb = nearestReach(reaches, b);
  const parts: XY[][] = [];
  if (ra.reach.pathOrder > rb.reach.pathOrder) {
    parts.push(
      sliceBetween(
        ra.reach.pts,
        ra.reach.cum,
        ra.s,
        ra.reach.cum[ra.reach.cum.length - 1]!,
      ),
    );
    const mids = reaches
      .filter(
        (r) =>
          r.pathOrder < ra.reach.pathOrder && r.pathOrder > rb.reach.pathOrder,
      )
      .sort((p, q) => q.pathOrder - p.pathOrder);
    for (const m of mids) parts.push(m.pts);
    parts.push(sliceBetween(rb.reach.pts, rb.reach.cum, 0, rb.s));
  } else if (ra.reach.id === rb.reach.id && ra.s < rb.s) {
    parts.push(sliceBetween(ra.reach.pts, ra.reach.cum, ra.s, rb.s));
  } else return null;
  const route = joinPoints([[a], ...parts, [b]]);
  const length = cumLengths(route).at(-1)!;
  return length <= maxStretch * dist(a, b) + 2 * snapM ? route : null;
}

/** Concatenates vertex lists, dropping a vertex that repeats the one before it. */
export function joinPoints(parts: readonly (readonly XY[])[]): XY[] {
  const out: XY[] = [];
  for (const part of parts)
    for (const q of part) {
      const last = out[out.length - 1];
      if (!last || dist(last, q) > 1e-6) out.push(q);
    }
  return out;
}

/**
 * Orients the course pieces (in source-to-mouth order) end to end: the first so that its end is
 * nearest the next piece (a single piece: its start nearest `startRef`), each other so that its
 * start is nearest the previous end. `jumps[i]` is the distance between piece i's end and piece
 * i + 1's start.
 */
export function chainPieces(
  parts: readonly (readonly XY[])[],
  startRef: XY,
): { lines: XY[][]; jumps: number[] } {
  const lines: XY[][] = [];
  parts.forEach((part, i) => {
    const fwd = [...part];
    const rev = [...part].reverse();
    if (i === 0) {
      if (parts.length === 1) {
        lines.push(
          dist(fwd[0]!, startRef) <= dist(rev[0]!, startRef) ? fwd : rev,
        );
        return;
      }
      const next = parts[1]!;
      const ends = [next[0]!, next[next.length - 1]!];
      const score = (l: XY[]) =>
        Math.min(...ends.map((e) => dist(l[l.length - 1]!, e)));
      lines.push(score(fwd) <= score(rev) ? fwd : rev);
      return;
    }
    const prevEnd = lines[i - 1]![lines[i - 1]!.length - 1]!;
    lines.push(dist(fwd[0]!, prevEnd) <= dist(rev[0]!, prevEnd) ? fwd : rev);
  });
  const jumps = lines
    .slice(0, -1)
    .map((l, i) => dist(l[l.length - 1]!, lines[i + 1]![0]!));
  return { lines, jumps };
}

// --- Channel polygons ------------------------------------------------------------------------

/** Rings (outer first, then holes) of the polygons in a WKT POLYGON / MULTIPOLYGON. */
export function parsePolygonWkt(wkt: string): XY[][][] {
  const text = wkt.trim();
  if (/EMPTY$/i.test(text)) return [];
  const rings = (body: string): XY[][] =>
    body.split(/\)\s*,\s*\(/).map((ring) =>
      ring.split(",").map((pair): XY => {
        const [x, y] = pair.trim().split(/\s+/).map(Number);
        if (
          x === undefined ||
          y === undefined ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        )
          throw new Error(`flow-sections: bad coordinate "${pair.trim()}"`);
        return [x, y];
      }),
    );
  if (/^MULTIPOLYGON/i.test(text)) {
    const inner = text.slice(text.indexOf("(((") + 3, text.lastIndexOf(")))"));
    return inner.split(/\)\)\s*,\s*\(\(/).map(rings);
  }
  if (/^POLYGON/i.test(text)) {
    const inner = text.slice(text.indexOf("((") + 2, text.lastIndexOf("))"));
    return [rings(inner)];
  }
  throw new Error(
    `flow-sections: expected a polygon, got ${text.slice(0, 40)}`,
  );
}

/** Visits the grid cells a segment passes through (Amanatides-Woo traversal). */
function traverse(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cell: number,
  visit: (cx: number, cy: number) => void,
) {
  let cx = Math.floor(x0 / cell);
  let cy = Math.floor(y0 / cell);
  const ex = Math.floor(x1 / cell);
  const ey = Math.floor(y1 / cell);
  visit(cx, cy);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  let tx =
    sx === 0 ? Infinity : ((sx > 0 ? (cx + 1) * cell : cx * cell) - x0) / dx;
  let ty =
    sy === 0 ? Infinity : ((sy > 0 ? (cy + 1) * cell : cy * cell) - y0) / dy;
  const tdx = sx === 0 ? Infinity : cell / Math.abs(dx);
  const tdy = sy === 0 ? Infinity : cell / Math.abs(dy);
  for (let n = Math.abs(ex - cx) + Math.abs(ey - cy); n > 0; n--) {
    if (tx < ty) {
      cx += sx;
      tx += tdx;
    } else {
      cy += sy;
      ty += tdy;
    }
    visit(cx, cy);
  }
}

const cellKey = (cx: number, cy: number) => cx * 1_000_003 + cy;

/**
 * The edges of polygon rings in a uniform grid, for the two questions the spans ask: which
 * edges lie along a segment, and which polygons contain a point. Each polygon is told apart
 * (its edges carry its index), so overlapping polygons do not cancel each other.
 */
export class PolyIndex {
  private readonly ax: number[] = [];
  private readonly ay: number[] = [];
  private readonly bx: number[] = [];
  private readonly by: number[] = [];
  private readonly pid: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly rows = new Map<number, number[]>();
  private readonly rowCache = new Map<number, Map<number, number[]>>();

  constructor(
    polygons: readonly (readonly (readonly XY[])[])[],
    readonly cellM: number,
  ) {
    polygons.forEach((rings, pid) => {
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % ring.length]!;
          if (a[0] === b[0] && a[1] === b[1]) continue;
          this.add(a, b, pid);
        }
    });
  }

  private add(a: XY, b: XY, pid: number) {
    const id = this.ax.length;
    this.ax.push(a[0]);
    this.ay.push(a[1]);
    this.bx.push(b[0]);
    this.by.push(b[1]);
    this.pid.push(pid);
    traverse(a[0], a[1], b[0], b[1], this.cellM, (cx, cy) => {
      const key = cellKey(cx, cy);
      const list = this.cells.get(key);
      if (list) list.push(id);
      else this.cells.set(key, [id]);
    });
    const r0 = Math.floor(Math.min(a[1], b[1]) / this.cellM);
    const r1 = Math.floor(Math.max(a[1], b[1]) / this.cellM);
    for (let r = r0; r <= r1; r++) {
      const list = this.rows.get(r);
      if (list) list.push(id);
      else this.rows.set(r, [id]);
    }
  }

  get edgeCount() {
    return this.ax.length;
  }

  /** Edge ids in the cells along the segment and their 8 neighbours (each once). */
  private edgesAlong(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Set<number> {
    const out = new Set<number>();
    traverse(x0, y0, x1, y1, this.cellM, (cx, cy) => {
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const e of this.cells.get(cellKey(cx + i, cy + j)) ?? [])
            out.add(e);
    });
    return out;
  }

  /** Per polygon, the sorted x where its edges cross the row's centre line. */
  private rowCrossings(r: number): Map<number, number[]> {
    let map = this.rowCache.get(r);
    if (map) return map;
    map = new Map();
    const yc = (r + 0.5) * this.cellM;
    for (const e of this.rows.get(r) ?? []) {
      const ay = this.ay[e]!;
      const by = this.by[e]!;
      if (ay > yc === by > yc) continue;
      const x =
        this.ax[e]! + ((yc - ay) * (this.bx[e]! - this.ax[e]!)) / (by - ay);
      const list = map.get(this.pid[e]!);
      if (list) list.push(x);
      else map.set(this.pid[e]!, [x]);
    }
    for (const list of map.values()) list.sort((p, q) => p - q);
    this.rowCache.set(r, map);
    return map;
  }

  /**
   * The polygons that contain (x, y) (even-odd per polygon, holes excluded). The state at the
   * centre line of the point's cell comes from the crossings to its left; the short vertical
   * hop to the point flips it for each edge crossed, and only that cell's edges can be crossed.
   */
  insidePids(x: number, y: number): Set<number> {
    const r = Math.floor(y / this.cellM);
    const yc = (r + 0.5) * this.cellM;
    const inside = new Set<number>();
    for (const [pid, xs] of this.rowCrossings(r)) {
      let lo = 0;
      let hi = xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid]! < x) lo = mid + 1;
        else hi = mid;
      }
      if (lo % 2 === 1) inside.add(pid);
    }
    if (y !== yc) {
      const cx = Math.floor(x / this.cellM);
      const lo = Math.min(y, yc);
      const hi = Math.max(y, yc);
      const hop = new Set<number>();
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const e of this.cells.get(cellKey(cx + i, r + j)) ?? [])
            hop.add(e);
      for (const e of hop) {
        const ax = this.ax[e]!;
        const bx = this.bx[e]!;
        if (ax > x === bx > x) continue;
        const yi =
          this.ay[e]! + ((x - ax) * (this.by[e]! - this.ay[e]!)) / (bx - ax);
        if (yi > lo && yi <= hi) {
          const pid = this.pid[e]!;
          if (inside.has(pid)) inside.delete(pid);
          else inside.add(pid);
        }
      }
    }
    return inside;
  }

  /**
   * Where the normal line through (cx, cy) with direction `n` crosses polygon edges, as offsets
   * in [-reach, reach] with the polygon they belong to, sorted by offset.
   */
  crossings(
    cx: number,
    cy: number,
    n: XY,
    reach: number,
  ): { offset: number; pid: number }[] {
    const out: { offset: number; pid: number }[] = [];
    const edges = this.edgesAlong(
      cx - n[0] * reach,
      cy - n[1] * reach,
      cx + n[0] * reach,
      cy + n[1] * reach,
    );
    // Across the line: along the tangent t = (n[1], -n[0]); along it: n.
    for (const e of edges) {
      const rx0 = this.ax[e]! - cx;
      const ry0 = this.ay[e]! - cy;
      const rx1 = this.bx[e]! - cx;
      const ry1 = this.by[e]! - cy;
      const w0 = rx0 * n[1] - ry0 * n[0];
      const w1 = rx1 * n[1] - ry1 * n[0];
      if (w0 > 0 === w1 > 0) continue;
      const o0 = rx0 * n[0] + ry0 * n[1];
      const o1 = rx1 * n[0] + ry1 * n[1];
      const offset = o0 + ((0 - w0) * (o1 - o0)) / (w1 - w0);
      if (offset >= -reach && offset <= reach)
        out.push({ offset, pid: this.pid[e]! });
    }
    return out.sort((p, q) => p.offset - q.offset || p.pid - q.pid);
  }
}

/**
 * The wet span across the channel at a station: the intervals of the normal line (+-maxSearchM)
 * that lie inside the polygons, touching ones merged (mergeGapM); the interval holding offset 0,
 * else the nearest one whose near edge is within maxOffsetM. Null when there is none, when the
 * chosen interval runs to the end of the search (its real width is unknown), or when it is wider
 * than maxSpanM; the caller then falls back to a band. `n` is the unit left normal.
 */
export function stationSpan(
  index: PolyIndex,
  cx: number,
  cy: number,
  n: XY,
  cfg: Pick<
    FlowConfig["span"],
    "maxSearchM" | "maxOffsetM" | "maxSpanM" | "mergeGapM"
  >,
): Span | null {
  const reach = cfg.maxSearchM;
  const inside = index.insidePids(cx - n[0] * reach, cy - n[1] * reach);
  const raw: { lo: number; hi: number }[] = [];
  let open: number | null = inside.size > 0 ? -reach : null;
  for (const { offset, pid } of index.crossings(cx, cy, n, reach)) {
    if (inside.has(pid)) inside.delete(pid);
    else inside.add(pid);
    if (inside.size > 0 && open === null) open = offset;
    else if (inside.size === 0 && open !== null) {
      raw.push({ lo: open, hi: offset });
      open = null;
    }
  }
  if (open !== null) raw.push({ lo: open, hi: reach });
  const merged: { lo: number; hi: number }[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.lo - last.hi <= cfg.mergeGapM)
      last.hi = Math.max(last.hi, iv.hi);
    else merged.push({ ...iv });
  }
  const wet = merged.filter((iv) => iv.hi - iv.lo > 0.05);
  const holding = wet.find((iv) => iv.lo <= 0 && iv.hi >= 0);
  let chosen = holding;
  if (!chosen) {
    const gap = (iv: { lo: number; hi: number }) =>
      iv.lo > 0 ? iv.lo : -iv.hi;
    chosen = wet
      .filter((iv) => gap(iv) <= cfg.maxOffsetM)
      .sort((p, q) => gap(p) - gap(q) || p.lo - q.lo)[0];
  }
  if (!chosen) return null;
  if (chosen.lo <= -reach || chosen.hi >= reach) return null;
  if (chosen.hi - chosen.lo > cfg.maxSpanM) return null;
  return [chosen.lo, chosen.hi];
}

// --- Spans, widths and statistics ------------------------------------------------------------

/** Band width (m) from RiverATLAS river area (ria_ha_csu, hectares) over the reach length (km). */
export function bandWidthM(
  riverAreaHa: number | null,
  lengthKm: number | null,
): number | null {
  if (riverAreaHa === null || lengthKm === null) return null;
  if (!(riverAreaHa > 0) || !(lengthKm > 0)) return null;
  return (riverAreaHa * 10_000) / (lengthKm * 1000);
}

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/** Linear-interpolation quantile of unsorted values; null when empty. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((p, r) => p - r);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/**
 * Running median of the spans over `width` stations (odd), nMin and nMax apart, taken over the
 * neighbours that have a span and the same label (source), so a polygon span is never mixed with
 * a band one; a station without a span stays without.
 */
export function smoothSpans(
  spans: readonly (Span | null)[],
  width: number,
  labels?: readonly number[],
): (Span | null)[] {
  const half = (width - 1) / 2;
  return spans.map((s, i) => {
    if (s === null) return null;
    const lo: number[] = [];
    const hi: number[] = [];
    for (
      let j = Math.max(0, i - half);
      j <= Math.min(spans.length - 1, i + half);
      j++
    ) {
      const t = spans[j];
      if (t && (labels === undefined || labels[j] === labels[i])) {
        lo.push(t[0]);
        hi.push(t[1]);
      }
    }
    return [median(lo)!, median(hi)!];
  });
}

export type NotFlowable = "noDischarge" | "reservoir" | "noChannel" | "narrow";

/** The first reason a section is not flowable (null = flowable). */
export function flowReason(
  s: {
    dischargeM3s: number | null;
    inLake: boolean;
    spanShare: number;
    medianWidthM: number | null;
  },
  cfg: FlowConfig["flowable"],
): NotFlowable | null {
  if (s.dischargeM3s === null || !(s.dischargeM3s > 0)) return "noDischarge";
  if (s.inLake) return "reservoir";
  if (s.spanShare < cfg.minSpanShare) return "noChannel";
  if (s.medianWidthM === null || s.medianWidthM < cfg.minWidthM)
    return "narrow";
  return null;
}
