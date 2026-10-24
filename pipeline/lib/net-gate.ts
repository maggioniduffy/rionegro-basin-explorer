/**
 * Pure checks on a finished flow-net/1 used by pipeline:flow-net-publish.
 * endsLinked: the net links the section's ends along its main arm (owner decision 2026-10-23).
 */
import type { FlowNet } from "../../lib/flow/net-schema";
import { distanceM } from "./piece-rank";

export interface EndsLinkedOpts {
  /** A start must have s <= endTolM and a sink s >= courseLengthM - endTolM, m. */
  endTolM: number;
  minInsideWater: number;
  maxConnectorShare: number;
  minPathRatio: number;
}

export interface LinkedPath {
  from: string;
  to: string;
  lengthM: number;
  connectorShare: number;
  minHalfWidthM: number;
}

export interface EndsLinkedResult {
  linked: boolean;
  path: LinkedPath | null;
  reason: string | null;
}

/** Nodes where flow enters: sources and reservoir outlets. */
export function startNodes(net: FlowNet): FlowNet["nodes"] {
  const outletNodes = new Set(
    net.reservoirs.flatMap((r) => r.outlets.map((o) => o.node)),
  );
  return net.nodes.filter((n) => n.kind === "source" || outletNodes.has(n.id));
}

interface State {
  from: string;
  lengthM: number;
  connectorM: number;
  minHalfWidthM: number;
}

/** Whether `a` is a wider main arm than `b`: wider bottleneck, then fewer connector metres. */
function better(a: State, b: State): boolean {
  if (a.minHalfWidthM !== b.minHalfWidthM)
    return a.minHalfWidthM > b.minHalfWidthM;
  return a.connectorM < b.connectorM;
}

function branchLengthM(lon: number[], lat: number[]): number {
  let total = 0;
  for (let i = 1; i < lon.length; i++)
    total += distanceM([lon[i - 1]!, lat[i - 1]!], [lon[i]!, lat[i]!]);
  return total;
}

export function endsLinked(
  net: FlowNet,
  opts: EndsLinkedOpts,
): EndsLinkedResult {
  const fail = (reason: string): EndsLinkedResult => ({
    linked: false,
    path: null,
    reason,
  });
  const out = new Map<string, number[]>();
  const indeg = new Map<string, number>();
  net.branches.forEach((b, i) => {
    const l = out.get(b.from) ?? [];
    l.push(i);
    out.set(b.from, l);
    indeg.set(b.to, (indeg.get(b.to) ?? 0) + 1);
  });

  // Best state per node, relaxed in topological order (Kahn).
  const best = new Map<string, State>();
  for (const n of startNodes(net))
    if (n.s <= opts.endTolM)
      best.set(n.id, {
        from: n.id,
        lengthM: 0,
        connectorM: 0,
        minHalfWidthM: Infinity,
      });
  if (best.size === 0)
    return fail("no start within the course start tolerance");

  const queue = net.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  while (queue.length) {
    const id = queue.pop()!;
    const cur = best.get(id);
    for (const i of out.get(id) ?? []) {
      const b = net.branches[i]!;
      if (cur) {
        const len = branchLengthM(b.lon, b.lat);
        const next: State = {
          from: cur.from,
          lengthM: cur.lengthM + len,
          connectorM: cur.connectorM + (b.kind === "connector" ? len : 0),
          minHalfWidthM:
            b.kind === "connector"
              ? cur.minHalfWidthM
              : Math.min(cur.minHalfWidthM, ...b.halfWidthM),
        };
        const old = best.get(b.to);
        if (!old || better(next, old)) best.set(b.to, next);
      }
      const d = indeg.get(b.to)! - 1;
      indeg.set(b.to, d);
      if (d === 0) queue.push(b.to);
    }
  }

  let top: { to: string; state: State } | null = null;
  for (const n of net.nodes) {
    if (n.kind !== "sink" || n.s < net.courseLengthM - opts.endTolM) continue;
    const st = best.get(n.id);
    if (st && st.lengthM > 0 && (!top || better(st, top.state)))
      top = { to: n.id, state: st };
  }
  if (!top) return fail("no path from the course start to a sink at its end");

  const { state } = top;
  const path: LinkedPath = {
    from: state.from,
    to: top.to,
    lengthM: Math.round(state.lengthM * 10) / 10,
    connectorShare:
      state.lengthM > 0
        ? Math.round((state.connectorM / state.lengthM) * 1000) / 1000
        : 0,
    minHalfWidthM: Number.isFinite(state.minHalfWidthM)
      ? Math.round(state.minHalfWidthM * 10) / 10
      : 0,
  };
  const inside = net.qa.insideWater;
  if (inside === null || inside < opts.minInsideWater)
    return {
      linked: false,
      path,
      reason: `insideWater ${inside ?? "null"} < ${opts.minInsideWater}`,
    };
  if (state.connectorM / state.lengthM > opts.maxConnectorShare)
    return {
      linked: false,
      path,
      reason: `connector share ${path.connectorShare} > ${opts.maxConnectorShare}`,
    };
  if (state.lengthM < opts.minPathRatio * net.courseLengthM)
    return {
      linked: false,
      path,
      reason: `path ${path.lengthM} m < ${opts.minPathRatio} of the course (${net.courseLengthM} m)`,
    };
  return { linked: true, path, reason: null };
}
