/**
 * Helpers over the flat sub-basin list served by /api/subbasins (hierarchy order:
 * every parent before its children). Pure, so they are unit-tested.
 */
export interface TreeNode {
  id: string;
  parentId: string | null;
  childIds: string[];
}

/** Ids of `id`'s ancestors, root first, without `id`; empty for the root or an unknown id. */
export function ancestorIds(nodes: readonly TreeNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let parent = byId.get(id)?.parentId ?? null;
  while (parent !== null && !out.includes(parent)) {
    out.unshift(parent);
    parent = byId.get(parent)?.parentId ?? null;
  }
  return out;
}

/** Nodes expanded at first: the root and level-1 nodes, plus the selection's ancestors. */
export function initiallyExpanded(
  nodes: readonly (TreeNode & { level: number })[],
  selectedId: string | null,
): Set<string> {
  const open = new Set(nodes.filter((n) => n.level <= 1).map((n) => n.id));
  if (selectedId) for (const id of ancestorIds(nodes, selectedId)) open.add(id);
  return open;
}
