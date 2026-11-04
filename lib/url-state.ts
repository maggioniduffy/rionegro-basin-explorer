import {
  parseReachId,
  parseRiverId,
  parseStreamId,
  parseSubbasinId,
} from "./data/params";
import type { ScenarioSelector } from "./effluent/forecast";
import type { ParamLevels } from "./effluent/river";
import type { Level } from "./effluent/schema";
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
/** Effluent mode (phase E1): ?ef=<reach id>[_<token>…]. */
export const EF_PARAM = "ef";

/** The map's route. The landing is at /. */
export const MAP_PATH = "/map";

/**
 * Where a link from before the map moved to /map should go: "/" with a selection
 * (?r=, ?t=, ?reach=, ?s=, ?flow=, ?ef=) opens the map; anything else stays put (null).
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
    EF_PARAM,
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

/**
 * What the user changed from the config's defaults; an absent key means "the default", so a
 * default is never written to the URL. Units: m³/s, mg/L, coliforms per 100 mL, °C.
 */
export interface EffluentOverrides {
  flowM3s?: number;
  bodMgL?: number;
  coliformsPer100mL?: number;
  doMgL?: number;
  /** Treatment removal of BOD and coliforms, 0–100 %. */
  removalPct?: number;
  /** Absent = the long-term mean. */
  scenario?: Exclude<ScenarioSelector, "mean">;
  doMinMgL?: number;
  coliformsThreshold?: number;
  tempC?: number;
  /** Absent level = central. */
  levels?: Partial<ParamLevels>;
}

export interface EffluentUrl {
  /** HydroRIVERS id of the reach that receives the discharge. */
  reach: number;
  overrides: EffluentOverrides;
}

const LEVEL_CODE: Record<string, Level> = {
  l: "low",
  c: "central",
  h: "high",
};
const LEVEL_KEYS = [
  ["lk", "kd"],
  ["ln", "manningN"],
  ["lw", "widthCoef"],
] as const;
const STAT_CODE = { l: "p25", m: "median", h: "p75" } as const;
const NUMBER = /^\d+(\.\d+)?$/;

/** The token's number when it is plain decimal and within [min, max]. */
function tokenNumber(raw: string, min: number, max: number): number | null {
  if (!NUMBER.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/**
 * Effluent state from the URL: `<reach id>` then `_`-joined tokens, each a code and a value:
 * q flow m³/s, b BOD₅, c coliforms, o effluent DO, x removal %, s scenario (m mean, t today,
 * d<N><l|m|h> forecast day N, 1 = tomorrow, at p25/median/p75), td DO threshold, tc coliform
 * threshold, w water °C, lk/ln/lw + l|c|h for the kd, Manning n and width levels. A token that
 * isn't valid, or only restates the default, is dropped; an invalid reach drops the whole
 * parameter (null). Whether the reach is in the region's net is for the caller to check.
 */
export function parseEffluent(params: URLSearchParams): EffluentUrl | null {
  const raw = params.get(EF_PARAM);
  if (raw === null) return null;
  const [reachRaw = "", ...tokens] = raw.split("_");
  const reach = parseReachId(reachRaw);
  if (reach === null) return null;
  const o: EffluentOverrides = {};
  const levels: Partial<ParamLevels> = {};
  for (const token of tokens) {
    const level = LEVEL_KEYS.find(([code]) => token.startsWith(code));
    if (level) {
      const value = LEVEL_CODE[token.slice(2)];
      if (value && value !== "central" && token.length === 3)
        levels[level[1]] = value;
      continue;
    }
    const two = token.slice(0, 2);
    if (two === "td" || two === "tc") {
      const n = tokenNumber(token.slice(2), 0, 1e6);
      if (n === null) continue;
      if (two === "td") o.doMinMgL = n;
      else o.coliformsThreshold = n;
      continue;
    }
    const code = token[0];
    const rest = token.slice(1);
    if (code === "s") {
      const day = /^d([1-9]\d?)([lmh])$/.exec(rest);
      if (rest === "t") o.scenario = "today";
      else if (day)
        o.scenario = {
          day: Number(day[1]) - 1,
          stat: STAT_CODE[day[2] as keyof typeof STAT_CODE],
        };
      continue;
    }
    if (code === "q") {
      const n = tokenNumber(rest, 0, 1e6);
      if (n !== null && n > 0) o.flowM3s = n;
    } else if (code === "b") {
      const n = tokenNumber(rest, 0, 1e6);
      if (n !== null) o.bodMgL = n;
    } else if (code === "c") {
      const n = tokenNumber(rest, 0, 1e12);
      if (n !== null) o.coliformsPer100mL = n;
    } else if (code === "o") {
      const n = tokenNumber(rest, 0, 100);
      if (n !== null) o.doMgL = n;
    } else if (code === "x") {
      const n = tokenNumber(rest, 0, 100);
      if (n !== null && n > 0) o.removalPct = n;
    } else if (code === "w") {
      const n = tokenNumber(rest, 0, 50);
      if (n !== null) o.tempC = n;
    }
  }
  if (Object.keys(levels).length > 0) o.levels = levels;
  return { reach, overrides: o };
}

/** The `?ef=` value, or null without effluent state. Defaults are never written. */
function effluentValue(ef: EffluentUrl | null): string | null {
  if (!ef) return null;
  const o = ef.overrides;
  const tokens: string[] = [];
  const add = (code: string, n: number | undefined) => {
    // Exponent forms (1e-7) don't parse back, so they are not written.
    if (n !== undefined && NUMBER.test(String(n))) tokens.push(code + n);
  };
  add("q", o.flowM3s);
  add("b", o.bodMgL);
  add("c", o.coliformsPer100mL);
  add("o", o.doMgL);
  add("x", o.removalPct);
  const sc = o.scenario;
  if (sc === "today") tokens.push("st");
  else if (sc) {
    const stat = Object.entries(STAT_CODE).find(([, v]) => v === sc.stat)?.[0];
    if (stat) tokens.push(`sd${sc.day + 1}${stat}`);
  }
  add("td", o.doMinMgL);
  add("tc", o.coliformsThreshold);
  add("w", o.tempC);
  for (const [code, key] of LEVEL_KEYS) {
    const level = o.levels?.[key];
    const letter = Object.entries(LEVEL_CODE).find(([, v]) => v === level)?.[0];
    if (level && level !== "central" && letter) tokens.push(code + letter);
  }
  return [String(ef.reach), ...tokens].join("_");
}

/**
 * Query string for the effluent state, keeping unrelated parameters (the selection's and the
 * flow's included). "" when none remain.
 */
export function effluentSearch(
  current: URLSearchParams,
  ef: EffluentUrl | null,
): string {
  const next = new URLSearchParams(current);
  next.delete(EF_PARAM);
  const value = effluentValue(ef);
  if (value !== null) next.set(EF_PARAM, value);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export const sameEffluent = (a: EffluentUrl | null, b: EffluentUrl | null) =>
  effluentValue(a) === effluentValue(b);
