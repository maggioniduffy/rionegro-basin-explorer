/**
 * Pure rules of pipeline:line-names (R3.4 step 1): turn an APRHI NOMBRE_COM value into the
 * name the map displays, and decide when an IGN name corrects or names it. No file or
 * database access. Settings: regions/<id>/names.config.json.
 */
import { cleanName, nameKey } from "./names";

export interface NamesConfig {
  /** Dotted word (lower case, no dot) -> the full word it stands for. */
  abbreviations: Record<string, string>;
  /** Abbreviations of the table that are also expanded without the dot. */
  dotlessAbbreviations: string[];
  /** Full words a name may start with (after expansion; compared by nameKey). */
  leadingWords: string[];
  /** Misspelled word (lower case) -> the right word. */
  wordFixes: Record<string, string>;
  /** Text in parentheses (lower case) that is a qualifier, not a name. */
  aliasExcludeParentheses: string[];
  /** Share of an APRHI name's km an IGN name must run along to be its alias. */
  aliasMinShare: number;
  /** Largest edit distance (on name keys) at which an IGN spelling corrects APRHI's. */
  maxEditDistance: number;
  /** Alias test buffer, metres (Albers). */
  bufferM: number;
}

export interface ParsedName {
  /** The value as cleaned (NFC, spaces collapsed); null when empty. */
  raw: string | null;
  /** The source marks the name as unknown with a "*": it is shown blank. */
  starred: boolean;
  /** The expanded name without parentheses; null when empty or starred. */
  display: string | null;
  /** Names that were in parentheses, expanded; qualifiers in aliasExcludeParentheses left out. */
  parenthesized: string[];
  /** Parenthesized text dropped as a qualifier. */
  excluded: string[];
  /** Rule ids applied, e.g. "abbr:a", "fix:rio" (one per occurrence). */
  rules: string[];
  /** Dotted words that are not in the abbreviation table (left as they are). */
  unexpanded: string[];
  /** Parentheses left unbalanced after reading the balanced ones: a damaged value. */
  unbalanced: boolean;
}

/** A name that starts with something that is neither an abbreviation nor a known full word. */
export class UnknownPrefixError extends Error {
  constructor(
    readonly raw: string,
    readonly prefix: string,
  ) {
    super(
      `unknown name prefix "${prefix}" in "${raw}": add it to abbreviations or leadingWords in names.config.json (after checking what it means)`,
    );
    this.name = "UnknownPrefixError";
  }
}

const LETTERS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
const DOTTED = new RegExp(`^([${LETTERS}]{1,4})\\.(.*)$`);

/** Apply wordFixes to one word, keeping an all-capitals word in capitals. */
function fixWord(
  word: string,
  cfg: NamesConfig,
  rules: string[],
): string {
  const m = /^([^\p{L}]*)(\p{L}+)([^\p{L}]*)$/u.exec(word);
  if (!m) return word;
  const [, pre = "", core = "", post = ""] = m;
  const fix = cfg.wordFixes[core.toLowerCase()];
  if (!fix || fix === core) return word;
  rules.push(`fix:${core.toLowerCase()}`);
  const caps = core.length > 1 && core === core.toUpperCase();
  return `${pre}${caps ? fix.toUpperCase() : fix}${post}`;
}

/** Expand abbreviations and fix spellings word by word. */
function expandWords(
  text: string,
  cfg: NamesConfig,
  rules: string[],
  unexpanded: string[],
): string {
  const out: string[] = [];
  for (const token of text.split(" ").filter((t) => t !== "")) {
    const dotted = DOTTED.exec(token);
    if (dotted) {
      const [, abbr = "", rest = ""] = dotted;
      const full = cfg.abbreviations[abbr.toLowerCase()];
      if (full) {
        rules.push(`abbr:${abbr.toLowerCase()}`);
        out.push(full);
        if (rest !== "") out.push(expandWords(rest, cfg, rules, unexpanded));
        continue;
      }
      unexpanded.push(`${abbr}.`);
      out.push(token);
      continue;
    }
    const plain = token.toLowerCase();
    const dotless = cfg.dotlessAbbreviations.includes(plain)
      ? cfg.abbreviations[plain]
      : undefined;
    if (dotless) {
      rules.push(`abbr:${plain}`);
      out.push(dotless);
      continue;
    }
    out.push(fixWord(token, cfg, rules));
  }
  return out.join(" ");
}

/**
 * Read one APRHI name. Throws UnknownPrefixError when the name does not start with a known
 * full word once abbreviations are expanded (starred names are blanked before that check).
 */
export function parseAprhiName(
  rawValue: string | null | undefined,
  cfg: NamesConfig,
): ParsedName {
  const raw = cleanName(rawValue);
  const empty: ParsedName = {
    raw,
    starred: false,
    display: null,
    parenthesized: [],
    excluded: [],
    rules: [],
    unexpanded: [],
    unbalanced: false,
  };
  if (raw === null) return empty;
  if (raw.includes("*")) return { ...empty, starred: true };

  const rules: string[] = [];
  const unexpanded: string[] = [];
  const parts = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? "");
  const main = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const unbalanced = /[()]/.test(main);

  const display = expandWords(main, cfg, rules, unexpanded);
  const first = display.split(" ")[0] ?? "";
  const known = new Set(cfg.leadingWords.map(nameKey));
  if (!known.has(nameKey(first)))
    throw new UnknownPrefixError(raw, first || raw);

  const parenthesized: string[] = [];
  const excluded: string[] = [];
  for (const part of parts) {
    // "(o El Manso)", "( Dulce o Santa María)": alternatives joined by a lone "o".
    const text = part.replace(/\s+/g, " ").trim().replace(/^o\s+/i, "");
    for (const alt of text.split(/\s+o\s+/i)) {
      const name = expandWords(alt.trim(), cfg, rules, unexpanded);
      if (nameKey(name) === "") continue;
      if (cfg.aliasExcludeParentheses.includes(name.toLowerCase()))
        excluded.push(name);
      else parenthesized.push(name);
    }
  }
  return {
    raw,
    starred: false,
    display: display === "" ? null : display,
    parenthesized,
    excluded,
    rules,
    unexpanded,
    unbalanced,
  };
}

/** Levenshtein distance between two strings (insert, delete, replace, each 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** An IGN name without its parenthesized part: "Río Tercero (Ctalamochita)" -> "Río Tercero". */
export function ignMainName(name: string): string {
  return name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/** The names inside the parentheses of an IGN name, "o" alternatives split, leading "o" dropped. */
export function ignParenthesized(name: string): string[] {
  return [...name.matchAll(/\(([^)]*)\)/g)].flatMap((m) =>
    (m[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^o\s+/i, "")
      .split(/\s+o\s+/i)
      .map((s) => s.trim())
      .filter((s) => nameKey(s) !== ""),
  );
}

export interface IgnCandidate {
  name: string;
  /** Share (0..1) of the APRHI name's km within the buffer of this IGN name's lines. */
  share: number;
}

export interface Correction {
  name: string;
  share: number;
  distance: number;
}

/**
 * The IGN spelling that corrects a damaged APRHI name, or null. Candidates are the IGN names
 * running along the APRHI name for at least `minShare`; the one taken has the same number of
 * words as the APRHI display name and a nameKey at edit distance 1..maxEditDistance (smallest
 * distance, then the largest share, then the name). No correction when some IGN name already
 * has exactly the APRHI key (the spelling is right) or when the IGN spelling is itself the
 * name of another APRHI line (`otherKeys`): two different rivers are never merged.
 */
export function findCorrection(
  display: string,
  candidates: readonly IgnCandidate[],
  otherKeys: ReadonlySet<string>,
  cfg: Pick<NamesConfig, "aliasMinShare" | "maxEditDistance">,
): Correction | null {
  const key = nameKey(display);
  const words = key.split(" ").length;
  const along = candidates.filter((c) => c.share >= cfg.aliasMinShare);
  if (
    along.some((c) => {
      const main = nameKey(ignMainName(c.name));
      return main === key;
    })
  )
    return null;
  let best: Correction | null = null;
  for (const c of along) {
    const main = ignMainName(c.name);
    const mk = nameKey(main);
    if (mk === "" || mk.split(" ").length !== words) continue;
    if (otherKeys.has(mk)) continue;
    const distance = editDistance(key, mk);
    if (distance < 1 || distance > cfg.maxEditDistance) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (c.share > best.share ||
          (c.share === best.share && main < best.name)))
    )
      best = { name: main, share: c.share, distance };
  }
  return best;
}

/**
 * Does a value look damaged (characters lost or replaced when the source was converted)?
 * A heuristic for the review list only; it never changes a name. Signs: unbalanced
 * parentheses, a capital letter inside a word after a lower-case one ("ParedPn", "CastaMo"),
 * the replacement character, or a question mark.
 */
export function looksDamaged(name: string): boolean {
  if (/�|\?/.test(name)) return true;
  const open = (name.match(/\(/g) ?? []).length;
  const close = (name.match(/\)/g) ?? []).length;
  if (open !== close) return true;
  return /\p{Ll}\p{Lu}/u.test(name) || /\p{L}\(\p{L}/u.test(name);
}
