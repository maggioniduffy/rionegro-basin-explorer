import "server-only";
import type { Catalog } from "@/lib/ask/catalog";
import { fuzzyMatch, type CatalogKind } from "@/lib/ask/fuzzy";
import type { AskLocale, ParsedAsk } from "@/lib/ask/query";
import { isLlmEnabled, resolveIntent } from "@/lib/llm";
import type { AskAnswer, AskResult, AskSource } from "@/lib/ask/contract";
import { validateIntent } from "@/lib/ask/intent";
import { computeAnswer } from "./answer";
import type { AskResolution } from "./cache";

/** At or above this a typed name is trusted without asking the LLM. */
export const ASK_FUZZY_THRESHOLD = 0.8;
/** Lowest confidence at which the name the LLM extracted is opened. */
export const ASK_SEARCH_MIN_CONFIDENCE = 0.7;

export interface Resolved {
  resolution: AskResolution;
  source: "fuzzy" | "llm";
  /** Worth keeping for 7 days: not a result of the LLM being off, over quota or down. */
  cacheable: boolean;
}

function selectOf(
  entry: { kind: CatalogKind; id: string } | undefined,
): AskResolution | null {
  return entry ? { action: "select", kind: entry.kind, id: entry.id } : null;
}

/** Best entry for the question as a name or as a whole, at or above the threshold. */
export function fuzzyAnswer(
  parsed: ParsedAsk,
  catalog: Catalog,
): AskResolution | null {
  const best = (kinds?: CatalogKind[]) => {
    const matches = [parsed.name, parsed.normalized]
      .filter((q) => q !== "")
      .flatMap((q) => fuzzyMatch(catalog.index, q, { kinds, limit: 1 }))
      .filter((m) => m.confidence >= ASK_FUZZY_THRESHOLD);
    return matches.sort((a, b) => b.confidence - a.confidence)[0]?.entry;
  };
  const entry =
    (parsed.wantsSubbasin ? best(["subbasin"]) : undefined) ?? best();
  return selectOf(entry);
}

async function llmAnswer(
  parsed: ParsedAsk,
  locale: AskLocale,
  catalog: Catalog,
): Promise<AskResolution> {
  const intent = await resolveIntent(parsed.normalized, locale, catalog);
  switch (intent.action) {
    case "select_river":
      return { action: "select", kind: "river", id: intent.slug };
    case "select_subbasin":
      return { action: "select", kind: "subbasin", id: intent.slug };
    case "search": {
      const top = fuzzyMatch(catalog.index, intent.query, { limit: 1 })[0];
      return (
        (top && top.confidence >= ASK_SEARCH_MIN_CONFIDENCE
          ? selectOf(top.entry)
          : null) ?? { action: "no_match" }
      );
    }
    // Kept as the intent: values are read from Mongo each time (see materialize).
    case "compare":
    case "rank":
    case "fact":
      return intent;
    case "unsupported":
      return { action: "unsupported" };
  }
}

/** The single winner, if exactly one, to open on the map. */
function winnerSelect(
  answer: AskAnswer,
): { kind: "river" | "subbasin"; id: string } | null {
  const [only, ...rest] = answer.winnerIds;
  return only !== undefined && rest.length === 0
    ? { kind: answer.kind, id: only }
    : null;
}

/**
 * A cached resolution may only point at ids the current catalog has; else null (a miss).
 * `question` is the text the cache key was made from, so a threshold's number is checked
 * against it again.
 */
export function revalidate(
  hit: AskResolution,
  catalog: Catalog,
  question: string,
): AskResolution | null {
  switch (hit.action) {
    case "select":
      return catalog.entries.some((e) => e.kind === hit.kind && e.id === hit.id)
        ? hit
        : null;
    case "compare":
    case "rank":
    case "fact": {
      const checked = validateIntent(hit, catalog.known, question);
      return checked.action === hit.action ? checked : null;
    }
    default:
      return hit;
  }
}

/**
 * Turns a resolution into the response body. Comparisons, rankings and facts read their
 * values from Mongo here, on every request, including cache hits.
 */
export async function materialize(
  resolution: AskResolution,
  source: AskSource,
  catalog: Catalog,
): Promise<AskResult> {
  switch (resolution.action) {
    case "compare":
    case "rank":
    case "fact": {
      const answer = await computeAnswer(resolution, catalog);
      return { action: "answer", answer, select: winnerSelect(answer), source };
    }
    default:
      return { ...resolution, source };
  }
}

/** Fuzzy match first (no LLM call); else at most one LLM call, when allowed. */
export async function resolveAsk(
  parsed: ParsedAsk,
  locale: AskLocale,
  catalog: Catalog,
  llmAllowed: boolean,
): Promise<Resolved> {
  const fuzzy = fuzzyAnswer(parsed, catalog);
  if (fuzzy) return { resolution: fuzzy, source: "fuzzy", cacheable: true };
  if (!llmAllowed || !isLlmEnabled()) {
    return {
      resolution: { action: "unsupported" },
      source: "fuzzy",
      cacheable: false,
    };
  }
  const resolution = await llmAnswer(parsed, locale, catalog);
  // resolveIntent turns a timeout or outage into `unsupported` too, so that resolution is
  // never cached: it could pin a transient failure for 7 days.
  return {
    resolution,
    source: "llm",
    cacheable: resolution.action !== "unsupported",
  };
}
