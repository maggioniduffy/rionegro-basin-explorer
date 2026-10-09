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
