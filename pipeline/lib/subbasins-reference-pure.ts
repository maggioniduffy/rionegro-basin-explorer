/**
 * Pure helpers for pipeline:subbasins in reference mode (R3.5): stable ids, display-name
 * fixes, parent and reach assignment by share, and the outlet rule. DuckDB-free, so they are
 * unit-tested. The source layers are APRHI's (Córdoba): basins (level 1), subcuencas
 * (level 2) and unidades de gestión hídrica, UGH (level 3).
 */
import { cleanName, slugify } from "./names";

/** Node level in the reference hierarchy: 0 region, 1 basin, 2 subcuenca, 3 UGH. */
export type RefLevel = 0 | 1 | 2 | 3;

/** One source feature that becomes a node, before its id is known. */
export interface SourceKey {
  level: 1 | 2 | 3;
  /** Root code (level 1), cleaned subcuenca name (2), COD_SIST or cleaned name (3). */
  key: string;
}

/** The committed regions/<id>/subbasin-ids.json: source key → node id, per level. */
export interface IdsFile {
  $comment?: string;
  level1: Record<string, string>;
  level2: Record<string, string>;
  level3: Record<string, string>;
}

const LEVEL_PROPERTY = {
  1: "level1",
  2: "level2",
  3: "level3",
} as const;

/** Suffix that tells a level-2/3 id apart from an id already taken (deterministic). */
const LEVEL_SUFFIX = { 1: "basin", 2: "subcuenca", 3: "ugh" } as const;

const ID_FORMAT = /^[a-z0-9-]+$/;

export interface IdCandidate extends SourceKey {
  /** Text to slugify: the key itself for codes, the name otherwise. */
  basis: string;
  /** An id fixed by hand (level 1: regions/<id>/subbasins.config.json rootSlugs). */
  preset?: string;
}

export interface GeneratedIds {
  ids: IdsFile;
  /** Entries whose plain slug was taken, with the id they got instead. */
  disambiguated: { level: number; key: string; wanted: string; got: string }[];
}

/**
 * Assign every candidate an id: its preset, else the slug of its basis. Levels are processed
 * top-down and keys in code-point order, so the result never depends on the input order. A
 * slug that is already taken gets the level suffix ("la-picasa-subcuenca"), then a counter.
 * `reserved` ids (the region node) are taken from the start.
 */
export function generateIds(
  candidates: readonly IdCandidate[],
  reserved: readonly string[] = [],
): GeneratedIds {
  const taken = new Set<string>(reserved);
  const ids: IdsFile = { level1: {}, level2: {}, level3: {} };
  const disambiguated: GeneratedIds["disambiguated"] = [];
  const sorted = [...candidates].sort(
    (a, b) => a.level - b.level || compareCodePoints(a.key, b.key),
  );
  for (const c of sorted) {
    const wanted = c.preset ?? slugify(c.basis);
    if (!ID_FORMAT.test(wanted))
      throw new Error(
        `level ${c.level} "${c.key}": cannot make an id from "${c.basis}"`,
      );
    let got = wanted;
    if (taken.has(got)) got = `${wanted}-${LEVEL_SUFFIX[c.level]}`;
    for (let n = 2; taken.has(got); n++)
      got = `${wanted}-${LEVEL_SUFFIX[c.level]}-${n}`;
    taken.add(got);
    ids[LEVEL_PROPERTY[c.level]][c.key] = got;
    if (got !== wanted)
      disambiguated.push({ level: c.level, key: c.key, wanted, got });
  }
  return { ids, disambiguated };
}

/**
 * Problems of an existing ids file against the source keys: a feature without an id, an id
 * without a feature, a malformed id, an id used twice (also against `reserved`). Empty when
 * the file still describes the data, so ids never change silently.
 */
export function idsProblems(
  ids: IdsFile,
  keys: readonly SourceKey[],
  reserved: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const used = new Map<string, string>(reserved.map((r) => [r, "region"]));
  for (const level of [1, 2, 3] as const) {
    const map = ids[LEVEL_PROPERTY[level]];
    const wanted = new Set(
      keys.filter((k) => k.level === level).map((k) => k.key),
    );
    for (const key of [...wanted].sort(compareCodePoints))
      if (map[key] === undefined)
        problems.push(`level ${level}: "${key}" has no id`);
    for (const key of Object.keys(map).sort(compareCodePoints)) {
      const id = map[key] as string;
      if (!wanted.has(key))
        problems.push(`level ${level}: id "${id}" has no feature "${key}"`);
      if (!ID_FORMAT.test(id))
        problems.push(`level ${level}: "${key}" has malformed id "${id}"`);
      const other = used.get(id);
      if (other !== undefined)
        problems.push(
          `level ${level}: id "${id}" of "${key}" is already used by ${other}`,
        );
      used.set(id, `level ${level} "${key}"`);
    }
  }
  return problems;
}

export interface NameFix {
  from: string;
  to: string;
  note: string;
  /** "word": replace the word wherever it occurs; default: the whole name must equal `from`. */
  match?: "exact" | "word";
}

export interface FixedName {
  name: string;
  /** `from` of every fix that changed the name, plus "whitespace" when only cleaning did. */
  applied: string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Display name from a source name: Unicode NFC, whitespace collapsed (cleanName), then the
 * config's fixes in order. Throws on an empty name, so a node never lacks one.
 */
export function fixName(raw: string, fixes: readonly NameFix[]): FixedName {
  const cleaned = cleanName(raw);
  if (cleaned === null) throw new Error(`empty name "${raw}"`);
  const applied: string[] = [];
  if (cleaned !== raw) applied.push("whitespace");
  let name = cleaned;
  for (const fix of fixes) {
    const next =
      fix.match === "word"
        ? name.replace(
            new RegExp(
              `(?<![\\p{L}\\p{N}])${escapeRegExp(fix.from)}(?![\\p{L}\\p{N}])`,
              "gu",
            ),
            fix.to,
          )
        : name === fix.from
          ? fix.to
          : name;
    if (next !== name) {
      applied.push(fix.from);
      name = next;
    }
  }
  return { name, applied };
}

/** Code-point order, so sorting never depends on the locale. */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ShareChoice {
  key: string;
  share: number;
}

/**
 * The key holding the largest share (ties: the lowest key), or null when no share is
 * positive. Shares are fractions of the feature's whole size (area or length).
 */
export function largestShare(
  shares: ReadonlyMap<string, number>,
): ShareChoice | null {
  let best: ShareChoice | null = null;
  for (const [key, share] of shares) {
    if (!(share > 0)) continue;
    if (
      best === null ||
      share > best.share ||
      (share === best.share && compareCodePoints(key, best.key) < 0)
    )
      best = { key, share };
  }
  return best;
}

/** `largestShare`, kept only when the share reaches `minShare`. */
export function assignByShare(
  shares: ReadonlyMap<string, number>,
  minShare: number,
): ShareChoice | null {
  const best = largestShare(shares);
  return best !== null && best.share >= minShare ? best : null;
}

export interface OutletReach {
  id: number;
  /** NEXT_DOWN; 0 or a reach outside the node ends the walk. */
  nextDown: number;
  /** HydroRIVERS UPLAND_SKM. */
  upland: number;
  /** HydroRIVERS LENGTH_KM. */
  lengthKm: number;
}

export interface OutletChoice {
  /** The reach of the node with the largest UPLAND_SKM (ties: the lowest id); null if none. */
  reachId: number | null;
  /** Share of the node's stream km that drains to that reach, through the node's own reaches. */
  share: number;
  upstreamReaches: number;
  upstreamKm: number;
  totalKm: number;
  /** True when the share reaches `minShare`. */
  kept: boolean;
}

/**
 * Owner rule for the outlet of a node (levels 2-3): the node's reach with the largest
 * UPLAND_SKM, kept only if at least `minShare` of the node's stream km drain to it, walking
 * NEXT_DOWN within the node's reaches. Otherwise the node has no single outlet. With
 * `forcedId` (a root's configured exit) that reach is used instead of the largest one; the
 * share is still reported.
 */
export function chooseOutlet(
  reaches: readonly OutletReach[],
  minShare: number,
  forcedId?: number,
): OutletChoice {
  const totalKm = reaches.reduce((s, r) => s + r.lengthKm, 0);
  let top: OutletReach | undefined;
  if (forcedId !== undefined) {
    top = reaches.find((r) => r.id === forcedId);
    if (top === undefined)
      throw new Error(`outlet reach ${forcedId} is not among the reaches`);
  } else {
    for (const r of reaches)
      if (
        top === undefined ||
        r.upland > top.upland ||
        (r.upland === top.upland && r.id < top.id)
      )
        top = r;
  }
  if (top === undefined)
    return {
      reachId: null,
      share: 0,
      upstreamReaches: 0,
      upstreamKm: 0,
      totalKm,
      kept: false,
    };
  const members = new Map(reaches.map((r) => [r.id, r]));
  const index = new Map<number, number[]>();
  for (const r of reaches) {
    if (!members.has(r.nextDown)) continue;
    const list = index.get(r.nextDown);
    if (list) list.push(r.id);
    else index.set(r.nextDown, [r.id]);
  }
  const seen = new Set<number>([top.id]);
  const stack = [top.id];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    for (const up of index.get(id) ?? []) {
      if (seen.has(up)) continue;
      seen.add(up);
      stack.push(up);
    }
  }
  const upstreamKm = [...seen].reduce(
    (s, id) => s + (members.get(id) as OutletReach).lengthKm,
    0,
  );
  const share = totalKm > 0 ? upstreamKm / totalKm : 0;
  return {
    reachId: top.id,
    share,
    upstreamReaches: seen.size,
    upstreamKm,
    totalKm,
    kept: share >= minShare,
  };
}

export interface TreeNode {
  id: string;
  parentId: string | null;
}

/** Depth-first order, children sorted by id, so the output order is stable. */
export function depthFirst<T extends TreeNode>(nodes: readonly T[]): T[] {
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const list = children.get(n.parentId);
    if (list) list.push(n);
    else children.set(n.parentId, [n]);
  }
  const out: T[] = [];
  const visit = (parent: string | null) => {
    const kids = (children.get(parent) ?? [])
      .slice()
      .sort((a, b) => compareCodePoints(a.id, b.id));
    for (const k of kids) {
      out.push(k);
      visit(k.id);
    }
  };
  visit(null);
  if (out.length !== nodes.length)
    throw new Error("some nodes are not reachable from the root");
  return out;
}
