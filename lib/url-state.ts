import {
  parseReachId,
  parseRiverId,
  parseStreamId,
  parseSubbasinId,
} from "./data/params";

export type Selection =
  | { kind: "river"; id: string }
  | { kind: "reach"; id: number }
  | { kind: "stream"; id: string }
  | { kind: "subbasin"; id: string };

/**
 * URL parameters: ?r=<river slug>, ?t=<stream id>, ?reach=<HydroRIVERS id> or
 * ?s=<sub-basin id>.
 */
export const RIVER_PARAM = "r";
export const STREAM_PARAM = "t";
export const REACH_PARAM = "reach";
export const SUBBASIN_PARAM = "s";

/** The map's route. The landing is at /. */
export const MAP_PATH = "/map";

/**
 * Where a link from before the map moved to /map should go: "/" with a selection
 * (?r=, ?t=, ?reach=, ?s=) opens the map; anything else stays put (null).
 */
export function legacyMapPath(
  pathname: string,
  params: URLSearchParams,
): string | null {
  if (pathname !== "/") return null;
  const hasSelection = [
    RIVER_PARAM,
    STREAM_PARAM,
    REACH_PARAM,
    SUBBASIN_PARAM,
  ].some((p) => params.has(p));
  return hasSelection ? MAP_PATH : null;
}

/**
 * Selection from the URL; invalid values are ignored. A river wins over a stream, a stream
 * over a reach, and all of them over a sub-basin.
 */
export function parseSelection(params: URLSearchParams): Selection | null {
  const river = params.get(RIVER_PARAM);
  const riverId = river === null ? null : parseRiverId(river);
  if (riverId) return { kind: "river", id: riverId };
  const stream = params.get(STREAM_PARAM);
  const streamId = stream === null ? null : parseStreamId(stream);
  if (streamId) return { kind: "stream", id: streamId };
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
  next.delete(STREAM_PARAM);
  next.delete(REACH_PARAM);
  next.delete(SUBBASIN_PARAM);
  if (selection?.kind === "river") next.set(RIVER_PARAM, selection.id);
  if (selection?.kind === "stream") next.set(STREAM_PARAM, selection.id);
  if (selection?.kind === "reach") next.set(REACH_PARAM, String(selection.id));
  if (selection?.kind === "subbasin") next.set(SUBBASIN_PARAM, selection.id);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a?.kind === b?.kind && a?.id === b?.id;
