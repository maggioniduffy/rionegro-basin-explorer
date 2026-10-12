/**
 * Display names of the map's line pieces (R3.7). Pure; the inputs are read by pipeline:export.
 *
 * The name a piece shows is the one pipeline:line-names decided (lib/line-names.ts
 * parseAprhiName + regions/<id>/names.config.json, owner nameFixes included), which it
 * records in data/work/<id>/line-names/aliases.json: per name key, the APRHI values as the
 * source writes them (`raw`) and the `display` name. A piece's APRHI value is looked up
 * there, so this never re-implements the rules:
 *   - an APRHI name with "*" is blank (the source marks it unknown): no name;
 *   - an APRHI name missing from aliases.json is an error (the file is stale: re-run
 *     pipeline:line-names), never a silent blank;
 *   - an IGN name is shown as IGN writes it, cleaned (cleanName).
 */
import { cleanName, nameKey } from "./names";

/** The part of aliases.json this module reads. */
export interface AliasesFile {
  names: Record<string, { display: string; raw: string[]; aliases: string[] }>;
}

/** Cleaned APRHI value -> display name, from aliases.json. */
export function rawNameIndex(aliases: AliasesFile): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, entry] of Object.entries(aliases.names))
    for (const raw of entry.raw) {
      const clean = cleanName(raw);
      if (clean === null) continue;
      const other = index.get(clean);
      if (other !== undefined && other !== entry.display)
        throw new Error(
          `aliases.json: "${clean}" is the raw value of two names ("${other}" and "${entry.display}", key ${key})`,
        );
      index.set(clean, entry.display);
    }
  return index;
}

/** The name a line piece shows, or null when it shows none. */
export function pieceDisplayName(
  piece: { source: string; name: string | null },
  index: ReadonlyMap<string, string>,
): string | null {
  const name = cleanName(piece.name);
  if (name === null) return null;
  if (piece.source === "ign") return name;
  if (piece.source !== "aprhi")
    throw new Error(`unknown line source "${piece.source}"`);
  if (name.includes("*")) return null;
  const display = index.get(name);
  if (display === undefined)
    throw new Error(
      `APRHI name "${name}" is not in aliases.json: re-run pipeline:line-names`,
    );
  return display;
}

/**
 * Alternative names a stream is searched by: the `aliases` of its name key in aliases.json
 * (raw APRHI values, parenthesized names, IGN aliases), without the stream's own name.
 * Empty when the name is not in aliases.json (an IGN-only name has no alias).
 */
export function streamAliases(name: string, aliases: AliasesFile): string[] {
  const entry = aliases.names[nameKey(name)];
  if (!entry) return [];
  const own = nameKey(name);
  return [...new Set(entry.aliases)].filter((a) => nameKey(a) !== own);
}
