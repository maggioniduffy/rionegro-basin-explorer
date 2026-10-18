import {
  parseReachId,
  parseRiverId,
  parseStreamId,
  parseSubbasinId,
} from "./data/params";
import { isFlowSpeed, parseSectionId, type FlowSpeed } from "./flow/schema";

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
/** Flow close-up (phase F1): ?flow=<section id>&fs=<speed multiplier>. */
export const FLOW_PARAM = "flow";
export const FLOW_SPEED_PARAM = "fs";

/** The map's route. The landing is at /. */
export const MAP_PATH = "/map";

/**
 * Where a link from before the map moved to /map should go: "/" with a selection
 * (?r=, ?t=, ?reach=, ?s=, ?flow=) opens the map; anything else stays put (null).
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
    FLOW_PARAM,
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

export interface FlowUrl {
  section: string | null;
  speed: FlowSpeed;
}

/**
 * Flow state from the URL. A section id that isn't one is dropped, and so is the speed with it;
 * a speed that isn't offered reads as 1.
 */
export function parseFlow(params: URLSearchParams): FlowUrl {
  const id = params.get(FLOW_PARAM);
  if (id === null || !parseSectionId(id)) return { section: null, speed: 1 };
  const fs = Number(params.get(FLOW_SPEED_PARAM));
  return { section: id, speed: isFlowSpeed(fs) ? fs : 1 };
}

/**
 * Query string for the flow state, keeping unrelated parameters (the selection's included).
 * fs is omitted at 1 and without a section. "" when none remain.
 */
export function flowSearch(current: URLSearchParams, flow: FlowUrl): string {
  const next = new URLSearchParams(current);
  next.delete(FLOW_PARAM);
  next.delete(FLOW_SPEED_PARAM);
  if (flow.section) {
    next.set(FLOW_PARAM, flow.section);
    if (flow.speed !== 1) next.set(FLOW_SPEED_PARAM, String(flow.speed));
  }
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export const sameFlow = (a: FlowUrl, b: FlowUrl) =>
  a.section === b.section && (a.section === null || a.speed === b.speed);
