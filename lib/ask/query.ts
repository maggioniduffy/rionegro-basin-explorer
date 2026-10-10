import { createHash } from "node:crypto";
import { normalizeSearch } from "@/lib/data/search";

export type AskLocale = "en" | "es";

/** Longest question the ask box sends. */
export const ASK_MAX_LENGTH = 120;

// "cuenca del Neuquén", "Limay sub-basin": the user wants the sub-basin, not the river.
const BASIN_WORDS =
  /\b(sub ?cuencas?|cuencas?|sub ?basins?|basins?|watersheds?|catchments?)\b/g;
// Words around a name that carry no meaning for the match.
const FILLER =
  /\b(the|of|show|me|go|to|find|open|del?|la|el|los|las|mostrame|muestra|mostrar|ver|ir|al?)\b/g;

export interface ParsedAsk {
  /** Normalized question: the cache key and what the LLM sees. */
  normalized: string;
  /** The question reduced to a name, for the fuzzy match. */
  name: string;
  /** It mentions a basin, so a sub-basin wins over a river of the same name. */
  wantsSubbasin: boolean;
}

/** Null when nothing is left after normalizing, or when it is too long. */
export function parseAsk(raw: string): ParsedAsk | null {
  if (raw.length > ASK_MAX_LENGTH) return null;
  const normalized = normalizeSearch(raw.replace(/[^\p{L}\p{N}\s-]/gu, " "));
  if (normalized === "") return null;
  const wantsSubbasin = new RegExp(BASIN_WORDS.source).test(normalized);
  const name = normalized
    .replace(BASIN_WORDS, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { normalized, name, wantsSubbasin };
}

/**
 * Cache key of a question. The text is hashed, so the store holds no readable questions;
 * the region and locale are part of it, and `version` changes when the catalog does.
 */
export function askCacheKey(
  normalized: string,
  locale: AskLocale,
  region: string,
  version: string,
): string {
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `ask:v2:${region}:${version}:${locale}:${hash.slice(0, 32)}`;
}
