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
