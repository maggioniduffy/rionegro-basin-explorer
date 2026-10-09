/**
 * Split IGN names into streams over the HydroRIVERS flow network (HYRIV_ID → NEXT_DOWN).
 * Pure, so it is unit-tested without DuckDB (tests/pipeline/streams.test.ts).
 *
 * Two reaches with the same name key belong to the same stream when one lies downstream
 * of the other and the path between them crosses at most `maxGap` "gap" reaches: reaches
 * with no shown IGN name and not on an approved river. Those gap reaches are absorbed into
 * the stream. A reach with another IGN name, or on an approved river, breaks the path.
 * Each connected group per name is one stream; its mouth is the member whose next-down
 * reach is outside the stream.
 */
import { slugify } from "./names";

export interface StreamReach {
  id: number;
  /** HYRIV_ID of the reach downstream; 0 (or an id not in the input) ends the walk. */
  nextDown: number;
  /** Name key of the shown IGN name (nameKey), or null when no IGN name is shown. */
  key: string | null;
  /** True when the reach belongs to an approved river (pipeline:named). */
  river: boolean;
}

export interface DetectOptions {
  /** Most gap reaches allowed on the path between two same-name parts. */
  maxGap: number;
  /** Name keys left out (approved rivers and their aliases); they still break paths. */
  excludedKeys?: ReadonlySet<string>;
}

export interface DetectedStream {
  /** `<slugify(key)>-<mouth HYRIV_ID>`. */
  id: string;
  key: string;
  mouth: number;
  /** Named and absorbed reaches, ascending. */
  reachIds: number[];
  namedReachIds: number[];
  absorbedReachIds: number[];
}

export interface AmbiguousGap {
  reach: number;
  /** Name keys whose joins would absorb this reach. */
  keys: string[];
}

export interface DetectResult {
  streams: DetectedStream[];
  /** Gap reaches claimed by more than one name; not absorbed, and those joins dropped. */
  ambiguousGaps: AmbiguousGap[];
}

/** Stable stream id: slug of the name key plus the mouth reach id. */
export const streamId = (key: string, mouth: number) =>
  `${slugify(key)}-${mouth}`;

/**
 * Gap reaches claimed by more than one claimant. In a flow tree a gap reach has a single
 * first named reach downstream, so this should stay empty; it is checked, not assumed.
 */
export function resolveGapClaims<C>(
  claims: ReadonlyMap<number, ReadonlySet<C>>,
): { contested: Set<number> } {
  const contested = new Set<number>();
  for (const [reach, owners] of claims)
    if (owners.size > 1) contested.add(reach);
  return { contested };
}

interface Join {
  key: string;
  from: number;
  to: number;
  gaps: number[];
}

export function detectStreams(
  reaches: readonly StreamReach[],
  { maxGap, excludedKeys = new Set() }: DetectOptions,
): DetectResult {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const isMember = (r: StreamReach) =>
    r.key !== null && !excludedKeys.has(r.key);
  const isGap = (r: StreamReach) => r.key === null && !r.river;

  // 1. Candidate joins: from each named reach, walk down to the first non-gap reach;
  //    join when it has the same key and at most maxGap gap reaches lie in between.
  const joins: Join[] = [];
  for (const r of reaches) {
    if (!isMember(r)) continue;
    const gaps: number[] = [];
    let next = byId.get(r.nextDown);
    // Bounded by the input size, so a cycle (a data error) cannot loop forever.
    for (let steps = 0; next && steps <= reaches.length; steps++) {
      if (next.key === r.key) {
        joins.push({ key: r.key!, from: r.id, to: next.id, gaps });
        break;
      }
      if (!isGap(next) || gaps.length === maxGap) break;
      gaps.push(next.id);
      next = byId.get(next.nextDown);
    }
  }

  // 2. A gap reach claimed by two names is not absorbed and its joins are dropped.
  const claims = new Map<number, Set<string>>();
  for (const j of joins)
    for (const g of j.gaps) {
      const set = claims.get(g) ?? new Set<string>();
      set.add(j.key);
      claims.set(g, set);
    }
  const { contested } = resolveGapClaims(claims);
  const kept = joins.filter((j) => !j.gaps.some((g) => contested.has(g)));

  // 3. Union-find over named reaches; absorbed gaps follow their join.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const up = parent.get(x)!;
      parent.set(x, root);
      x = up;
    }
    return root;
  };
  for (const r of reaches) if (isMember(r)) parent.set(r.id, r.id);
  for (const j of kept) {
    const a = find(j.from);
    const b = find(j.to);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<
    number,
    { key: string; named: number[]; gaps: Set<number> }
  >();
  for (const r of reaches) {
    if (!isMember(r)) continue;
    const root = find(r.id);
    const g = groups.get(root) ?? { key: r.key!, named: [], gaps: new Set() };
    g.named.push(r.id);
    groups.set(root, g);
  }
  for (const j of kept)
    for (const gap of j.gaps) groups.get(find(j.from))!.gaps.add(gap);

  // 4. Mouth: the member whose next-down reach is outside the stream.
  const streams = [...groups.values()].map((g) => {
    const all = new Set([...g.named, ...g.gaps]);
    const exits = [...all].filter((id) => !all.has(byId.get(id)!.nextDown));
    if (exits.length !== 1)
      throw new Error(
        `stream ${g.key} has ${exits.length} mouths; check the flow network`,
      );
    const mouth = exits[0]!;
    const asc = (a: number, b: number) => a - b;
    return {
      id: streamId(g.key, mouth),
      key: g.key,
      mouth,
      reachIds: [...all].sort(asc),
      namedReachIds: [...g.named].sort(asc),
      absorbedReachIds: [...g.gaps].sort(asc),
    };
  });
  return {
    streams: streams.sort(
      (a, b) => a.key.localeCompare(b.key) || a.mouth - b.mouth,
    ),
    ambiguousGaps: [...contested]
      .sort((a, b) => a - b)
      .map((reach) => ({ reach, keys: [...claims.get(reach)!].sort() })),
  };
}

/** A sub-basin node of pipeline/subbasins.config.json, as far as streams need it. */
export interface SubbasinNode {
  id: string;
  kind: "river" | "endorheic";
  /** Slug of the river whose mouth closes the node (river nodes only). */
  river?: string;
}

/**
 * Mouth reach (HYRIV_ID) → sub-basin id, for every river node. A river node is everything
 * upstream of its river's mouth reach (pipeline:subbasins), so the first node mouth on the
 * way down from a stream names the deepest sub-basin that holds the stream.
 */
export function subbasinMouths(
  nodes: readonly SubbasinNode[],
  rivers: readonly { _id: string; mouthReach: number }[],
): Map<number, string> {
  const mouthOf = new Map(rivers.map((r) => [r._id, r.mouthReach]));
  const out = new Map<number, string>();
  for (const node of nodes) {
    if (node.kind !== "river") continue;
    const mouth =
      node.river === undefined ? undefined : mouthOf.get(node.river);
    if (mouth === undefined)
      throw new Error(`sub-basin ${node.id}: river mouth reach not found`);
    out.set(mouth, node.id);
  }
  return out;
}

export interface Drainage {
  /** Sub-basin whose set holds the stream's mouth; null when none was found. */
  subbasin: string | null;
  /** Slug of the first approved river downstream of the mouth; null when none. */
  receivingRiver: string | null;
}

/**
 * Where a stream's mouth drains, from the flow network alone. The sub-basin is the first
 * node mouth reached walking down from the mouth reach itself (inclusive), or the
 * endorheic node when the mouth reach is on the endorheic network. The receiving river is
 * the first approved-river reach strictly downstream of the mouth reach.
 */
export function streamDrainage(
  mouth: number,
  net: {
    nextDown: ReadonlyMap<number, number>;
    /** Approved river slug of a reach, when it is on one. */
    river: ReadonlyMap<number, string>;
    endorheic: ReadonlySet<number>;
    nodeByMouth: ReadonlyMap<number, string>;
    /** Id of the endorheic sub-basin node, if the config has one. */
    endorheicNode: string | null;
  },
): Drainage {
  let subbasin: string | null = null;
  let receivingRiver: string | null = null;
  let id: number | undefined = mouth;
  // Bounded by the network size, so a cycle (a data error) cannot loop forever.
  for (let steps = 0; id !== undefined && steps <= net.nextDown.size; steps++) {
    if (subbasin === null) subbasin = net.nodeByMouth.get(id) ?? null;
    if (steps > 0 && receivingRiver === null)
      receivingRiver = net.river.get(id) ?? null;
    if (subbasin !== null && receivingRiver !== null) break;
    id = net.nextDown.get(id);
  }
  if (subbasin === null && net.endorheic.has(mouth))
    subbasin = net.endorheicNode;
  return { subbasin, receivingRiver };
}

export interface LineReach {
  id: number;
  nextDown: number;
  /** Coverage of the shown name on this reach (pipeline:ign-match cover), 0..1. */
  coverage: number;
}

export interface LineResult {
  streams: DetectedStream[];
  /** Reaches of the detected groups left out: below the threshold or unnamed, at an end. */
  droppedReachIds: number[];
}

/**
 * Keep only the reaches the IGN line runs along (owner, 2026-10-09). A named reach is on
 * the line when its coverage is at least `minCoverage`. In each detected group
 * (`detectStreams`, which already limits unnamed gaps to `maxGap` in a row) the ends that
 * are not on the line are pruned, repeatedly: an upstream end (a member with no member
 * upstream) and the mouth, until every end is on the line. What stays is the part of the
 * group between reaches on the line: below-threshold and unnamed reaches only in between,
 * and at a fork only the branches the line runs along. Pruning a mouth that joins two
 * branches leaves two streams, as same-name siblings are (DECISSIONS.md, IGN streams).
 * A group with no reach on the line is dropped whole.
 */
export function followIgnLines(
  groups: readonly DetectedStream[],
  reaches: ReadonlyMap<number, LineReach>,
  { minCoverage }: { minCoverage: number },
): LineResult {
  const streams: DetectedStream[] = [];
  const dropped: number[] = [];
  const asc = (a: number, b: number) => a - b;
  for (const g of groups) {
    const named = new Set(g.namedReachIds);
    const onLine = (id: number) =>
      named.has(id) && (reaches.get(id)?.coverage ?? 0) >= minCoverage;
    const kept = new Set(g.reachIds);
    const down = (id: number) => reaches.get(id)?.nextDown ?? 0;
    const upCount = new Map<number, number>();
    for (const id of kept)
      if (kept.has(down(id)))
        upCount.set(down(id), (upCount.get(down(id)) ?? 0) + 1);
    // Ends: upstream ends (no member upstream) and mouths (next-down not a member).
    const isEnd = (id: number) =>
      (upCount.get(id) ?? 0) === 0 || !kept.has(down(id));
    const queue = [...kept].filter((id) => isEnd(id) && !onLine(id));
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (!kept.has(id) || onLine(id) || !isEnd(id)) continue;
      kept.delete(id);
      const d = down(id);
      if (kept.has(d)) {
        upCount.set(d, (upCount.get(d) ?? 1) - 1);
        if (isEnd(d) && !onLine(d)) queue.push(d);
      }
      for (const up of g.reachIds)
        if (kept.has(up) && down(up) === id && !onLine(up)) queue.push(up);
    }
    for (const id of g.reachIds) if (!kept.has(id)) dropped.push(id);
    // Each remaining mouth closes one stream: the kept reaches that drain to it.
    const mouthOf = (id: number) => {
      let m = id;
      for (let i = 0; kept.has(down(m)) && i <= kept.size; i++) m = down(m);
      return m;
    };
    const byMouth = new Map<number, number[]>();
    for (const id of kept) {
      const m = mouthOf(id);
      byMouth.set(m, [...(byMouth.get(m) ?? []), id]);
    }
    for (const [mouth, ids] of byMouth) {
      ids.sort(asc);
      streams.push({
        id: streamId(g.key, mouth),
        key: g.key,
        mouth,
        reachIds: ids,
        namedReachIds: ids.filter((id) => named.has(id)),
        absorbedReachIds: ids.filter((id) => !named.has(id)),
      });
    }
  }
  return {
    streams: streams.sort(
      (a, b) => a.key.localeCompare(b.key) || a.mouth - b.mouth,
    ),
    droppedReachIds: dropped.sort(asc),
  };
}
