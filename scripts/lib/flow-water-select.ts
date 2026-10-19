/** Pure selection/chunking logic of flow-water, mirroring its Python CLI (tested). */

export type Entry = { id: string; river: string; index: number };
const RANGE = /^(.+)\.\.(.+)$/;

export function selectIds(entries: Entry[], only?: string, rivers?: string) {
  if (!only && !rivers) return entries.map((entry) => entry.id);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const selected = new Set<string>();
  const unknown: string[] = [];
  for (const item of (only ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const range = item.match(RANGE);
    if (!range) {
      if (byId.has(item)) selected.add(item);
      else unknown.push(item);
      continue;
    }
    const a = byId.get(range[1]!);
    const b = byId.get(range[2]!);
    if (!a || !b) throw new Error(`unknown section ids in range ${item}`);
    if (a.river !== b.river) throw new Error(`range ${item} mixes rivers`);
    if (a.index > b.index) throw new Error(`range ${item} is reversed`);
    for (const entry of entries)
      if (
        entry.river === a.river &&
        entry.index >= a.index &&
        entry.index <= b.index
      )
        selected.add(entry.id);
  }
  if (unknown.length)
    throw new Error(`unknown section ids: ${unknown.join(", ")}`);
  if (rivers) {
    const wanted = rivers
      .split(",")
      .map((river) => river.trim())
      .filter(Boolean);
    const known = new Set(entries.map((entry) => entry.river));
    const bad = wanted.filter((river) => !known.has(river));
    if (bad.length) throw new Error(`unknown river slugs: ${bad.join(", ")}`);
    for (const entry of entries)
      if (wanted.includes(entry.river)) selected.add(entry.id);
  }
  return entries
    .filter((entry) => selected.has(entry.id))
    .map((entry) => entry.id);
}

export function chunkIds(ids: string[], chunk: number) {
  return {
    include: Array.from({ length: Math.ceil(ids.length / chunk) }, (_, i) => ({
      only: ids.slice(i * chunk, (i + 1) * chunk).join(","),
    })),
  };
}
