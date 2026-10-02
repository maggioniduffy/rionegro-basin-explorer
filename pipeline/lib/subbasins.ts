/**
 * Sub-basin hierarchy over HydroBASINS polygons. Each node's polygon set is everything
 * upstream of its mouth polygon; its "own" area is that set minus its children's sets.
 * The own areas of all nodes must partition the root's set. Pure, so it is unit-tested.
 */
export interface SubbasinNode {
  id: string;
  parentId: string | null;
}

export interface LeveledNode extends SubbasinNode {
  level: number;
}

/**
 * Ids from the root down to `id` (inclusive). Throws on an unknown id or a cycle, so a
 * broken hierarchy never reaches the outputs.
 */
export function ancestorPath(
  nodes: readonly SubbasinNode[],
  id: string,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  let current: string | null = id;
  while (current !== null) {
    if (path.includes(current)) throw new Error(`cycle at ${current}`);
    const node = byId.get(current);
    if (!node) throw new Error(`unknown node ${current}`);
    path.unshift(current);
    current = node.parentId;
  }
  return path;
}

/**
 * Structural checks on the config: unique ids, a known acyclic parent for every node,
 * the root at level 0, each child one level below its parent, and parents listed
 * before their children.
 */
export function hierarchyProblems(nodes: readonly LeveledNode[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, LeveledNode>();
  for (const node of nodes) {
    if (seen.has(node.id)) problems.push(`${node.id}: duplicate id`);
    if (node.parentId === null) {
      if (node.level !== 0) problems.push(`${node.id}: root must be level 0`);
    } else {
      const parent = seen.get(node.parentId);
      if (!parent)
        problems.push(
          `${node.id}: parent ${node.parentId} not listed before it`,
        );
      else if (node.level !== parent.level + 1)
        problems.push(
          `${node.id}: level ${node.level}, parent ${parent.id} is level ${parent.level}`,
        );
    }
    seen.set(node.id, node);
  }
  for (const node of nodes) {
    try {
      ancestorPath(nodes, node.id);
    } catch (err) {
      problems.push(`${node.id}: ${(err as Error).message}`);
    }
  }
  return problems;
}

export interface Partition<Id> {
  /** Polygons of each node that belong to none of its children. */
  own: Map<string, Set<Id>>;
  /** Owning node of every polygon in the root set. */
  ownerOf: Map<Id, string>;
  /** Empty when the hierarchy is a clean partition of the root set. */
  problems: string[];
}

export function partition<Id>(
  nodes: readonly SubbasinNode[],
  setOf: ReadonlyMap<string, ReadonlySet<Id>>,
): Partition<Id> {
  const problems: string[] = [];
  const roots = nodes.filter((n) => n.parentId === null);
  if (roots.length !== 1)
    problems.push(`expected one root, found ${roots.length}`);
  const ids = new Set(nodes.map((n) => n.id));
  const get = (id: string) => setOf.get(id) ?? new Set<Id>();

  const own = new Map<string, Set<Id>>();
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId))
      problems.push(`${node.id}: unknown parent ${node.parentId}`);
    const children = nodes.filter((n) => n.parentId === node.id);
    const mine = new Set(get(node.id));
    const claimedBy = new Map<Id, string>();
    for (const child of children) {
      for (const p of get(child.id)) {
        if (!get(node.id).has(p)) {
          problems.push(
            `${child.id}: polygon ${String(p)} is outside ${node.id}`,
          );
          break;
        }
        const other = claimedBy.get(p);
        if (other !== undefined) {
          problems.push(`${other} and ${child.id} overlap at ${String(p)}`);
          break;
        }
        claimedBy.set(p, child.id);
        mine.delete(p);
      }
    }
    own.set(node.id, mine);
  }

  const ownerOf = new Map<Id, string>();
  for (const [id, set] of own) {
    for (const p of set) {
      const other = ownerOf.get(p);
      if (other !== undefined)
        problems.push(`${other} and ${id} both own ${String(p)}`);
      ownerOf.set(p, id);
    }
  }
  const root = roots[0];
  if (root) {
    const rootSet = get(root.id);
    const missing = [...rootSet].filter((p) => !ownerOf.has(p)).length;
    const extra = [...ownerOf.keys()].filter((p) => !rootSet.has(p)).length;
    if (missing > 0) problems.push(`${missing} root polygons have no owner`);
    if (extra > 0)
      problems.push(`${extra} owned polygons are outside the root`);
  }
  return { own, ownerOf, problems };
}
