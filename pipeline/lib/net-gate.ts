/**
 * Pure checks on a finished flow-net/1 used by pipeline:flow-net-publish.
 * endsLinked: the net links the section's ends along its main arm, crossing reservoirs inlet to outlet
 * (owner rule 2026-10-24: the satellite image rules the flow view, not IGN).
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
  /** Reservoirs crossed inlet to outlet (zero length, not a connector). */
  viaReservoirs: number;
}

export interface EndsLinkedResult {
  linked: boolean;
  path: LinkedPath | null;
  reason: string | null;
  /** Reservoir pass-through edges left out because they would close a cycle. */
  skippedReservoirEdges: number;
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
  viaReservoirs: number;
}

/** A directed edge of the walk: a branch, or a reservoir pass-through (inlet to outlet). */
interface Edge {
  to: string;
  branch: number | null;
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

/**
 * Topological order (Kahn) of the nodes over the edges; `rest` lists the nodes it could not reach
 * (on a cycle or downstream of one).
 */
function topoOrder(
  net: FlowNet,
  out: Map<string, Edge[]>,
): { order: string[]; rest: Set<string> } {
  const indeg = new Map<string, number>();
  for (const list of out.values())
    for (const e of list) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = net.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.pop()!;
    order.push(id);
    for (const e of out.get(id) ?? []) {
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  const done = new Set(order);
  return {
    order,
    rest: new Set(net.nodes.map((n) => n.id).filter((id) => !done.has(id))),
  };
}

export function endsLinked(
  net: FlowNet,
  opts: EndsLinkedOpts,
): EndsLinkedResult {
  const fail = (reason: string, skipped = 0): EndsLinkedResult => ({
    linked: false,
    path: null,
    reason,
    skippedReservoirEdges: skipped,
  });
  const branchOut = new Map<string, Edge[]>();
  net.branches.forEach((b, i) => {
    const l = branchOut.get(b.from) ?? [];
    l.push({ to: b.to, branch: i });
    branchOut.set(b.from, l);
  });
  // Reservoirs are crossable: each inlet links to each outlet. Edges that would close a cycle are
  // dropped (nets have no cycles, so this is only a guard).
  const virtual: [string, string][] = [];
  for (const r of net.reservoirs)
    for (const inlet of r.inlets)
      for (const o of r.outlets) virtual.push([inlet, o.node]);
  let kept = virtual;
  let out = branchOut;
  const withVirtual = () => {
    const m = new Map([...branchOut].map(([k, v]) => [k, [...v]]));
    for (const [a, b] of kept) {
      const l = m.get(a) ?? [];
      l.push({ to: b, branch: null });
      m.set(a, l);
    }
    return m;
  };
  let topo: ReturnType<typeof topoOrder>;
  for (;;) {
    out = withVirtual();
    topo = topoOrder(net, out);
    if (topo.rest.size === 0) break;
    const next = kept.filter(
      ([a, b]) => !(topo.rest.has(a) && topo.rest.has(b)),
    );
    if (next.length === kept.length) break; // a cycle of branches alone: nothing more to drop
    kept = next;
  }
  const skipped = virtual.length - kept.length;

  // Best state per node, relaxed in topological order.
  const best = new Map<string, State>();
  const seed = (id: string) =>
    best.set(id, {
      from: id,
      lengthM: 0,
      connectorM: 0,
      minHalfWidthM: Infinity,
      viaReservoirs: 0,
    });
  for (const n of startNodes(net)) if (n.s <= opts.endTolM) seed(n.id);
  // A reservoir that starts at the course start feeds its outlets.
  const endNodes = new Set<string>();
  for (const r of net.reservoirs) {
    if (!r.sRange) continue;
    if (r.sRange[0] <= opts.endTolM) for (const o of r.outlets) seed(o.node);
    if (r.sRange[1] >= net.courseLengthM - opts.endTolM)
      for (const inlet of r.inlets) endNodes.add(inlet);
  }
  if (best.size === 0)
    return fail("no start within the course start tolerance", skipped);

  for (const id of topo.order) {
    const cur = best.get(id);
    if (!cur) continue;
    for (const e of out.get(id) ?? []) {
      let next: State;
      if (e.branch === null) {
        next = { ...cur, viaReservoirs: cur.viaReservoirs + 1 };
      } else {
        const b = net.branches[e.branch]!;
        const len = branchLengthM(b.lon, b.lat);
        next = {
          from: cur.from,
          lengthM: cur.lengthM + len,
          connectorM: cur.connectorM + (b.kind === "connector" ? len : 0),
          minHalfWidthM:
            b.kind === "connector"
              ? cur.minHalfWidthM
              : Math.min(cur.minHalfWidthM, ...b.halfWidthM),
          viaReservoirs: cur.viaReservoirs,
        };
      }
      const old = best.get(e.to);
      if (!old || better(next, old)) best.set(e.to, next);
    }
  }

  let top: { to: string; state: State } | null = null;
  for (const n of net.nodes) {
    const isEnd =
      (n.kind === "sink" && n.s >= net.courseLengthM - opts.endTolM) ||
      endNodes.has(n.id);
    if (!isEnd) continue;
    const st = best.get(n.id);
    if (st && st.lengthM > 0 && (!top || better(st, top.state)))
      top = { to: n.id, state: st };
  }
  if (!top)
    return fail("no path from the course start to a sink at its end", skipped);

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
    viaReservoirs: state.viaReservoirs,
  };
  const notLinked = (reason: string): EndsLinkedResult => ({
    linked: false,
    path,
    reason,
    skippedReservoirEdges: skipped,
  });
  const inside = net.qa.insideWater;
  if (inside === null || inside < opts.minInsideWater)
    return notLinked(
      `insideWater ${inside ?? "null"} < ${opts.minInsideWater}`,
    );
  if (state.connectorM / state.lengthM > opts.maxConnectorShare)
    return notLinked(
      `connector share ${path.connectorShare} > ${opts.maxConnectorShare}`,
    );
  if (state.lengthM < opts.minPathRatio * net.courseLengthM)
    return notLinked(
      `path ${path.lengthM} m < ${opts.minPathRatio} of the course (${net.courseLengthM} m)`,
    );
  return {
    linked: true,
    path,
    reason: null,
    skippedReservoirEdges: skipped,
  };
}
