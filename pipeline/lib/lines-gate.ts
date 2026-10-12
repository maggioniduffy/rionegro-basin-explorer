/**
 * Pure helpers of pipeline:lines-gate: rounding, the detail verdict rule and the name
 * comparison between the provincial (APRHI) and IGN line names. No file or database access.
 */
import { nameKey } from "./names";

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** `a` as a percentage of `b`, one decimal; null when `b` is not positive or either is not finite. */
export function pctOf(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return round((a / b) * 100);
}

/** Gate rule of the nqn IGN gate: real extra detail if both hold (PLAN.md, agreed 2026-10-01). */
export const MIN_EXTRA_PCT_OF_SOURCE = 20;
export const MIN_ADD_PCT_OF_BASELINE = 10;

export interface DetailVerdict {
  extraDetailKm: number;
  /** Extra km as a share of the candidate source's own km. */
  extraPctOfSource: number | null;
  /** Extra km as a share of the baseline (HydroRIVERS) km. */
  addsPctOverBaseline: number | null;
  realExtraDetail: boolean;
}

/**
 * Does a candidate source add real detail over a baseline? `farKm` is the candidate's km
 * farther than the buffer from every baseline line. Both shares must reach their threshold
 * on unrounded values; a missing share (zero or unknown denominator) never passes.
 */
export function detailVerdict(
  farKm: number,
  sourceKm: number,
  baselineKm: number,
  minExtraPctOfSource = MIN_EXTRA_PCT_OF_SOURCE,
  minAddPctOfBaseline = MIN_ADD_PCT_OF_BASELINE,
): DetailVerdict {
  const share = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && b > 0 ? (a / b) * 100 : null;
  const extra = share(farKm, sourceKm);
  const adds = share(farKm, baselineKm);
  return {
    extraDetailKm: round(farKm),
    extraPctOfSource: extra === null ? null : round(extra),
    addsPctOverBaseline: adds === null ? null : round(adds),
    realExtraDetail:
      extra !== null &&
      adds !== null &&
      extra >= minExtraPctOfSource &&
      adds >= minAddPctOfBaseline,
  };
}

/** Grouping key for a categorical value with case variants ("Vigente"/"VIGENTE"). */
export function normalizeLabel(v: string | null | undefined): string {
  const s = (v ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s === "" ? "(none)" : s;
}

/**
 * Abbreviations seen as the leading token of APRHI NOMBRE_COM in the province (top-30
 * leading tokens, 2026-10-11): A. (arroyo), R. (río), C. and Cda. (cañada), Q. (quebrada).
 * Keys are lower case without the dot.
 */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  a: "arroyo",
  r: "río",
  c: "cañada",
  cda: "cañada",
  q: "quebrada",
};

/** Generic type words that start a full name ("Río Suquía", "Arroyo del Gato"). */
const TYPE_WORDS = new Set([
  "rio",
  "arroyo",
  "canada",
  "quebrada",
  "vertiente",
  "brazo",
  "paleocauce",
  "banado",
]);

const firstWord = (s: string) => nameKey(s).split(" ")[0] ?? "";

const tidy = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Expand "R. Primero" / "A.Yerutí" / "Brazo R. Carnero" abbreviations to full words. */
function expandAbbreviations(s: string): string {
  return s.replace(
    /(^|\s)([A-Za-zÁÉÍÓÚáéíóú]{1,3})\.\s*/g,
    (whole, pre: string, abbr: string) => {
      const full = ABBREVIATIONS[abbr.toLowerCase()];
      return full ? `${pre}${full} ` : whole;
    },
  );
}

/**
 * The names a line can be known by. Abbreviations are expanded ("R. Primero (Suquía)" →
 * "río Primero"), a parenthesised alternative becomes a variant of its own, and when it
 * lacks a type word it is also given the main name's ("río Suquía"). A trailing "*" (the
 * source's own marker) and a leading "o " inside the parentheses ("(o El Manso)") are
 * dropped; "X o Y" outside parentheses makes Y an alternative too. Returns distinct strings, main name first; empty for an empty name.
 */
export function nameVariants(name: string | null | undefined): string[] {
  const cleaned = (name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (nameKey(cleaned) === "") return [];
  const alternatives = [...cleaned.matchAll(/\(([^)]*)\)/g)].map((m) =>
    tidy(expandAbbreviations(tidy(m[1] ?? "")).replace(/^o\s+/i, "")),
  );
  // "Arroyo Las Saladas o de las Mojarras": the part after a lone "o" is an alternative.
  const [head = "", ...afterO] = expandAbbreviations(
    cleaned.replace(/\([^)]*\)/g, " "),
  ).split(/\s+o\s+/i);
  const main = tidy(head);
  alternatives.push(...afterO.map(tidy));
  const mainKey = nameKey(main);
  const typeWord = TYPE_WORDS.has(firstWord(main))
    ? (main.split(" ")[0] ?? null)
    : null;
  const variants: string[] = mainKey === "" ? [] : [main];
  for (const alt of alternatives) {
    const altKey = nameKey(alt);
    if (altKey === "") continue;
    variants.push(alt);
    if (typeWord && !TYPE_WORDS.has(firstWord(alt)))
      variants.push(`${typeWord} ${alt}`);
  }
  const seen = new Set<string>();
  return variants.filter((v) => {
    const k = nameKey(v);
    if (k === "" || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The comparison keys of all variants of a name (accent-, case- and punctuation-free). */
export function variantKeys(name: string | null | undefined): string[] {
  return [...new Set(nameVariants(name).map(nameKey))];
}

/** Names agree strictly: the same `nameKey` after no expansion at all. */
export function exactKeyAgree(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = nameKey(a ?? "");
  return ka !== "" && ka === nameKey(b ?? "");
}

/** Names agree through variants: any variant key of `a` equals any variant key of `b`. */
export function variantAgree(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const kb = new Set(variantKeys(b));
  return variantKeys(a).some((k) => kb.has(k));
}

/** Articles and prepositions that sources add or drop ("Río de Soto" / "R. Soto"). */
const STOP_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y"]);

/** Variant keys with articles and prepositions removed: the lenient comparison. */
export function lenientKeys(name: string | null | undefined): string[] {
  const keys = nameVariants(name)
    .map((v) =>
      nameKey(v)
        .split(" ")
        .filter((w) => !STOP_WORDS.has(w))
        .join(" "),
    )
    .filter((k) => k !== "");
  return [...new Set(keys)];
}

/** Names agree leniently: any lenient key of `a` equals any lenient key of `b`. */
export function lenientAgree(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const kb = new Set(lenientKeys(b));
  return lenientKeys(a).some((k) => kb.has(k));
}

/** First whitespace-separated token of each name, counted, most frequent first (stable). */
export function leadingTokens(
  names: readonly string[],
  top = 30,
): { token: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of names) {
    const token = n.trim().split(/\s+/)[0];
    if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((x, y) => y.count - x.count || x.token.localeCompare(y.token))
    .slice(0, top);
}
