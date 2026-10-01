import { parseReachId, parseRiverId } from "./data/params";

export type Selection =
  { kind: "river"; id: string } | { kind: "reach"; id: number };

/** URL parameters: ?r=<river slug> or ?reach=<HydroRIVERS id>. */
export const RIVER_PARAM = "r";
export const REACH_PARAM = "reach";

/** Selection from the URL; invalid values are ignored. A river wins over a reach. */
export function parseSelection(params: URLSearchParams): Selection | null {
  const river = params.get(RIVER_PARAM);
  const riverId = river === null ? null : parseRiverId(river);
  if (riverId) return { kind: "river", id: riverId };
  const reach = params.get(REACH_PARAM);
  const reachId = reach === null ? null : parseReachId(reach);
  return reachId ? { kind: "reach", id: reachId } : null;
}

/** Query string for a selection, keeping unrelated parameters. "" when none remain. */
export function selectionSearch(
  current: URLSearchParams,
  selection: Selection | null,
): string {
  const next = new URLSearchParams(current);
  next.delete(RIVER_PARAM);
  next.delete(REACH_PARAM);
  if (selection?.kind === "river") next.set(RIVER_PARAM, selection.id);
  if (selection?.kind === "reach") next.set(REACH_PARAM, String(selection.id));
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a?.kind === b?.kind && a?.id === b?.id;
