/**
 * Pure graph logic for pipeline:rivers in reference mode (cba, R3.2): cut edges that cross
 * roots, apply manual overrides, flag connected reaches, find endorheic systems. No DuckDB, so
 * it is unit-tested.
 */
import { upstreamIndex, upstreamSet } from "./graph";

export interface RefReach {
  id: number;
  /** HYRIV_ID this reach drains to in HydroRIVERS (0 = terminal). */
  hrNextDown: number;
  root: string;
  km: number;
}

export type EdgeEdit = "cut" | "outside" | "override" | null;

export interface Override {
  from: number;
  to: number;
  reason: string;
  evidence: string;
}

export interface RootOverride {
  reach: number;
  root: string;
  reason: string;
  evidence: string;
}

/**
 * Reassign reaches to a root before the cuts, so edges inside the new root are not cut.
 * Throws listing every invalid entry (unknown reach, unknown root, duplicate, missing text).
 */
export function applyRootOverrides(
  reaches: readonly RefReach[],
  rootOverrides: readonly RootOverride[],
  rootCodes: ReadonlySet<string>,
): RefReach[] {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const o of rootOverrides) {
    const tag = `rootOverride ${o.reach} -> ${o.root}`;
    if (!byId.has(o.reach)) problems.push(`${tag}: not a selected reach`);
    if (!rootCodes.has(o.root)) problems.push(`${tag}: unknown root`);
    if (seen.has(o.reach)) problems.push(`${tag}: duplicate reach`);
    seen.add(o.reach);
    if (!o.reason || !o.evidence)
      problems.push(`${tag}: reason and evidence are required`);
  }
  if (problems.length > 0)
    throw new Error(`invalid root overrides:\n${problems.join("\n")}`);
  const to = new Map(rootOverrides.map((o) => [o.reach, o.root]));
  return reaches.map((r) =>
    to.has(r.id) ? { ...r, root: to.get(r.id) as string } : r,
  );
}

export interface EdgeResult {
  /** Effective NEXT_DOWN per reach (after cuts and overrides). */
  nextDown: Map<number, number>;
  edit: Map<number, EdgeEdit>;
  /** Cut edges between roots (edit = "cut"). */
  cuts: { from: number; to: number; rootFrom: string; rootTo: string }[];
}

/**
 * Cut edges: an HR_NEXT_DOWN into a reach of another root becomes 0 ("cut"); one into a reach
 * outside the selection becomes 0 ("outside", the reach leaves the region). Everything else
 * is kept.
 */
export function applyCuts(reaches: readonly RefReach[]): EdgeResult {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const nextDown = new Map<number, number>();
  const edit = new Map<number, EdgeEdit>();
  const cuts: EdgeResult["cuts"] = [];
  for (const r of reaches) {
    const to = byId.get(r.hrNextDown);
    if (r.hrNextDown === 0) {
      nextDown.set(r.id, 0);
      edit.set(r.id, null);
    } else if (!to) {
      nextDown.set(r.id, 0);
      edit.set(r.id, "outside");
    } else if (to.root !== r.root) {
      nextDown.set(r.id, 0);
      edit.set(r.id, "cut");
      cuts.push({
        from: r.id,
        to: r.hrNextDown,
        rootFrom: r.root,
        rootTo: to.root,
      });
    } else {
      nextDown.set(r.id, r.hrNextDown);
      edit.set(r.id, null);
    }
  }
  return { nextDown, edit, cuts };
}

/**
 * Validate overrides against the post-cut graph and apply them in place. Throws listing every
 * problem: unknown reach, different roots, `from` not a terminal after the cuts (or already
 * overridden), a cycle, a duplicate `from`.
 */
export function applyOverrides(
  reaches: readonly RefReach[],
  edges: EdgeResult,
  overrides: readonly Override[],
): void {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const o of overrides) {
    const tag = `override ${o.from} -> ${o.to}`;
    const from = byId.get(o.from);
    const to = byId.get(o.to);
    if (!from) problems.push(`${tag}: from is not a selected reach`);
    if (!to) problems.push(`${tag}: to is not a selected reach`);
    if (!from || !to) continue;
    if (from.root !== to.root)
      problems.push(`${tag}: roots differ (${from.root} vs ${to.root})`);
    if (seen.has(o.from)) problems.push(`${tag}: duplicate from`);
    seen.add(o.from);
    if (edges.nextDown.get(o.from) !== 0)
      problems.push(`${tag}: from is not a terminal after the cuts`);
    if (!o.reason || !o.evidence)
      problems.push(`${tag}: reason and evidence are required`);
    // Cycle: following `to` downstream must not come back to `from`.
    let cur: number | undefined = o.to;
    for (let i = 0; cur && cur !== 0 && i <= reaches.length; i++) {
      if (cur === o.from) {
        problems.push(`${tag}: creates a cycle`);
        break;
      }
      cur = edges.nextDown.get(cur);
    }
    if (problems.length === 0) {
      edges.nextDown.set(o.from, o.to);
      edges.edit.set(o.from, "override");
    }
  }
  if (problems.length > 0)
    throw new Error(`invalid network overrides:\n${problems.join("\n")}`);
}

/** Reaches that drain to `exit` along the effective edges (the exit included). */
export function connectedSet(
  edges: ReadonlyMap<number, number>,
  exit: number,
): Set<number> {
  const index = upstreamIndex(
    [...edges].map(([id, nextDown]) => ({ id, nextDown })),
  );
  return upstreamSet(index, exit);
}

export interface Terminal {
  id: number;
  root: string;
  why: "hr-sink" | "cut" | "outside";
  upstreamKm: number;
  upstreamReaches: number;
}

/**
 * Terminals of a root other than its exit, each with the km and reach count of the system it
 * drains (itself included). Sorted by upstream km, largest first.
 */
export function terminals(
  reaches: readonly RefReach[],
  edges: EdgeResult,
  exits: ReadonlyMap<string, number>,
): Terminal[] {
  const index = upstreamIndex(
    [...edges.nextDown].map(([id, nextDown]) => ({ id, nextDown })),
  );
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const out: Terminal[] = [];
  for (const r of reaches) {
    if (edges.nextDown.get(r.id) !== 0 || exits.get(r.root) === r.id) continue;
    const up = upstreamSet(index, r.id);
    let upstreamKm = 0;
    for (const id of up) upstreamKm += byId.get(id)?.km ?? 0;
    const e = edges.edit.get(r.id);
    out.push({
      id: r.id,
      root: r.root,
      why: e === "cut" ? "cut" : e === "outside" ? "outside" : "hr-sink",
      upstreamKm,
      upstreamReaches: up.size,
    });
  }
  return out.sort((a, b) => b.upstreamKm - a.upstreamKm);
}
