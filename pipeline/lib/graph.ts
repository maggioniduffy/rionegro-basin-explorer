/**
 * Upstream traversal over a "next down" tree, as used by HydroBASINS (HYBAS_ID →
 * NEXT_DOWN) and HydroRIVERS (HYRIV_ID → NEXT_DOWN). Pure, so it is unit-tested.
 */
export interface DownLink<Id> {
  id: Id;
  nextDown: Id;
}

/** Map each id to the ids that drain directly into it. */
export function upstreamIndex<Id>(
  links: Iterable<DownLink<Id>>,
): Map<Id, Id[]> {
  const index = new Map<Id, Id[]>();
  for (const { id, nextDown } of links) {
    const list = index.get(nextDown);
    if (list) list.push(id);
    else index.set(nextDown, [id]);
  }
  return index;
}

/** All ids upstream of `root`, including `root`. Iterative, so deep trees are fine. */
export function upstreamSet<Id>(index: Map<Id, Id[]>, root: Id): Set<Id> {
  const seen = new Set<Id>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop() as Id;
    for (const up of index.get(id) ?? []) {
      if (seen.has(up)) continue; // a cycle would be a data error; do not loop forever
      seen.add(up);
      stack.push(up);
    }
  }
  return seen;
}

/** Elements in `a` but not in `b`. */
export function difference<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((x) => !b.has(x));
}

/**
 * Mouth reaches of major branches: the outlet, plus every reach at a confluence
 * where at least two upstream branches have area >= `minArea` (all such branches
 * are returned, so both rivers at a major confluence become candidates).
 */
export function majorBranchMouths<Id>(
  index: Map<Id, Id[]>,
  area: (id: Id) => number,
  outlet: Id,
  minArea: number,
): Id[] {
  const mouths = [outlet];
  for (const id of upstreamSet(index, outlet)) {
    const big = (index.get(id) ?? []).filter((up) => area(up) >= minArea);
    if (big.length >= 2) mouths.push(...big);
  }
  return mouths;
}

/**
 * Reaches from `start` upstream, always taking the branch with the largest area.
 * Stops at a headwater, or before entering a reach in `stopAt`.
 */
export function traceLargestUpstream<Id>(
  index: Map<Id, Id[]>,
  area: (id: Id) => number,
  start: Id,
  stopAt: ReadonlySet<Id> = new Set(),
): Id[] {
  const path = [start];
  let node = start;
  for (;;) {
    const ups = index.get(node) ?? [];
    if (ups.length === 0) return path;
    const next = ups.reduce((best, id) => (area(id) > area(best) ? id : best));
    if (stopAt.has(next)) return path;
    path.push(next);
    node = next;
  }
}

/**
 * Trace a named river from its mouth: at each confluence take the largest-area
 * branch that is not another named river's mouth (`claimed`). Stops at a headwater
 * or when every upstream branch is claimed. This keeps "Limay" out of the larger
 * Collón Curá, for example.
 */
export function traceNamedRiver<Id>(
  index: Map<Id, Id[]>,
  area: (id: Id) => number,
  mouth: Id,
  claimed: ReadonlySet<Id>,
): Id[] {
  const path = [mouth];
  let node = mouth;
  for (;;) {
    const ups = (index.get(node) ?? []).filter((id) => !claimed.has(id));
    if (ups.length === 0) return path;
    node = ups.reduce((best, id) => (area(id) > area(best) ? id : best));
    path.push(node);
  }
}
