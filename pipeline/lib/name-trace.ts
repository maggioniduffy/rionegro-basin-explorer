/**
 * Follow one IGN name upstream over the HydroRIVERS flow tree (HYRIV_ID → NEXT_DOWN).
 * Used by pipeline:named (an approved river runs where its IGN name runs) and by
 * pipeline:ign-streams (a stream is the line IGN draws, not every same-name reach).
 * Pure, so it is unit-tested (tests/pipeline/name-trace.test.ts).
 *
 * Each reach is classed against the name being followed:
 *   strong   the name's IGN line runs along the reach (coverage ≥ the threshold); the only
 *            kind of reach a trace may end on
 *   weak     the reach carries the name, but the line covers too little of it; kept only
 *            between strong reaches, and not counted as a gap
 *   gap      no evidence for the name; kept only between strong reaches, at most `maxGap`
 *            in a row
 *   lake     a gap inside a lake, where IGN draws no line; kept only between strong reaches,
 *            and not counted (so a river crosses its reservoirs)
 *   blocked  the trace may not enter it (another approved river's mouth, another IGN name)
 *
 * From the start reach the trace moves upstream. At a fork it takes the branch whose
 * continuation has the most IGN evidence: the sum of km × coverage over its strong and
 * weak reaches (the IGN line, not the largest area), ties broken by the larger area. It
 * ends on the last strong reach; trailing weak, gap and lake reaches are dropped.
 */
export type ReachKind = "strong" | "weak" | "gap" | "lake" | "blocked";

export interface NameTraceInput {
  /** Reaches draining directly into `id`. */
  upstream: (id: number) => readonly number[];
  kind: (id: number) => ReachKind;
  /** Evidence weight of a strong or weak reach: km × coverage of the name. */
  evidence: (id: number) => number;
  /** Tie-break between branches with equal evidence (HydroRIVERS UPLAND_SKM). */
  area: (id: number) => number;
}

export interface NameTraceOptions {
  /** Most gap reaches allowed in a row between two reaches with the name. */
  maxGap: number;
  /**
   * Leading reaches above the start without the name are not limited by `maxGap`: a
   * river's mouth reaches can lie in a reservoir or lack IGN coverage, and its mouth end
   * is never trimmed. The start reach itself is always kept.
   */
  unlimitedLeadingGap?: boolean;
}

export interface NameTrace {
  /** From the start reach upstream, in flow order. */
  path: number[];
  /** Sum of `evidence` over the path's strong and weak reaches. */
  evidence: number;
}

interface Ext {
  evidence: number;
  path: number[];
}

const EPS = 1e-9;

export function traceAlongName(
  start: number,
  input: NameTraceInput,
  { maxGap, unlimitedLeadingGap = false }: NameTraceOptions,
): NameTrace {
  const better = (a: Ext | null, b: Ext | null): Ext | null => {
    if (!a) return b;
    if (!b) return a;
    if (Math.abs(a.evidence - b.evidence) > EPS)
      return a.evidence > b.evidence ? a : b;
    return input.area(a.path[0]!) >= input.area(b.path[0]!) ? a : b;
  };

  // Best continuation above a reach that may end the trace (strong).
  const above = (id: number): Ext => {
    let best: Ext | null = null;
    for (const up of input.upstream(id)) best = better(best, ext(up, 0, false));
    return best ?? { evidence: 0, path: [] };
  };

  // Best continuation entering `id`, after `gaps` gap reaches in a row. Null when no
  // strong reach is reached within the gap limit (the trace may not end here).
  // In a tree every reach is entered from one parent only, so this visits each reach of
  // the explored part once.
  const ext = (id: number, gaps: number, leading: boolean): Ext | null => {
    const k = input.kind(id);
    if (k === "blocked") return null;
    if (k === "strong") {
      const rest = above(id);
      return {
        evidence: input.evidence(id) + rest.evidence,
        path: [id, ...rest.path],
      };
    }
    const g = k === "gap" ? gaps + 1 : gaps;
    if (!leading && g > maxGap) return null;
    let best: Ext | null = null;
    for (const up of input.upstream(id))
      best = better(best, ext(up, g, leading));
    if (!best) return null;
    return {
      evidence: best.evidence + (k === "weak" ? input.evidence(id) : 0),
      path: [id, ...best.path],
    };
  };

  const startKind = input.kind(start);
  if (startKind === "strong") {
    const rest = above(start);
    return {
      path: [start, ...rest.path],
      evidence: input.evidence(start) + rest.evidence,
    };
  }
  // The start reach is kept whatever it carries; look above it for the name.
  let best: Ext | null = null;
  for (const up of input.upstream(start))
    best = better(best, ext(up, 0, unlimitedLeadingGap));
  const own = startKind === "weak" ? input.evidence(start) : 0;
  return best
    ? { path: [start, ...best.path], evidence: own + best.evidence }
    : { path: [start], evidence: own };
}
