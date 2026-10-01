import { parseReachId, parseRiverId, parseSubbasinId } from "./data/params";

export type Selection =
  | { kind: "river"; id: string }
  | { kind: "reach"; id: number }
  | { kind: "subbasin"; id: string };

/** URL parameters: ?r=<river slug>, ?reach=<HydroRIVERS id> or ?s=<sub-basin id>. */
export const RIVER_PARAM = "r";
export const REACH_PARAM = "reach";
export const SUBBASIN_PARAM = "s";

/**
 * Selection from the URL; invalid values are ignored. A river wins over a reach, and
 * both over a sub-basin.
 */
export function parseSelection(params: URLSearchParams): Selection | null {
  const river = params.get(RIVER_PARAM);
  const riverId = river === null ? null : parseRiverId(river);
  if (riverId) return { kind: "river", id: riverId };
  const reach = params.get(REACH_PARAM);
  const reachId = reach === null ? null : parseReachId(reach);
  if (reachId) return { kind: "reach", id: reachId };
  const subbasin = params.get(SUBBASIN_PARAM);
  const subbasinId = subbasin === null ? null : parseSubbasinId(subbasin);
  return subbasinId ? { kind: "subbasin", id: subbasinId } : null;
}

/** Query string for a selection, keeping unrelated parameters. "" when none remain. */
export function selectionSearch(
  current: URLSearchParams,
  selection: Selection | null,
): string {
  const next = new URLSearchParams(current);
  next.delete(RIVER_PARAM);
  next.delete(REACH_PARAM);
  next.delete(SUBBASIN_PARAM);
  if (selection?.kind === "river") next.set(RIVER_PARAM, selection.id);
  if (selection?.kind === "reach") next.set(REACH_PARAM, String(selection.id));
  if (selection?.kind === "subbasin") next.set(SUBBASIN_PARAM, selection.id);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a?.kind === b?.kind && a?.id === b?.id;
