import "server-only";
import type { Catalog } from "@/lib/ask/catalog";
import { fuzzyMatch, type CatalogKind } from "@/lib/ask/fuzzy";
import type { AskLocale, ParsedAsk } from "@/lib/ask/query";
import { isLlmEnabled, resolveIntent } from "@/lib/llm";
import type { AskAnswer } from "./cache";

/** At or above this a typed name is trusted without asking the LLM. */
export const ASK_FUZZY_THRESHOLD = 0.8;
/** Lowest confidence at which the name the LLM extracted is opened. */
export const ASK_SEARCH_MIN_CONFIDENCE = 0.7;

export interface Resolved {
  answer: AskAnswer;
  source: "fuzzy" | "llm";
  /** Worth keeping for 7 days: not a result of the LLM being off, over quota or down. */
  cacheable: boolean;
}

function selectOf(
  entry: { kind: CatalogKind; id: string } | undefined,
): AskAnswer | null {
  return entry ? { action: "select", kind: entry.kind, id: entry.id } : null;
}

/** Best entry for the question as a name or as a whole, at or above the threshold. */
export function fuzzyAnswer(
  parsed: ParsedAsk,
  catalog: Catalog,
): AskAnswer | null {
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
): Promise<AskAnswer> {
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
    case "unsupported":
      return { action: "unsupported" };
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
  if (fuzzy) return { answer: fuzzy, source: "fuzzy", cacheable: true };
  if (!llmAllowed || !isLlmEnabled()) {
    return {
      answer: { action: "unsupported" },
      source: "fuzzy",
      cacheable: false,
    };
  }
  const answer = await llmAnswer(parsed, locale, catalog);
  // resolveIntent turns a timeout or outage into `unsupported` too, so that answer is
  // never cached: it could pin a transient failure for 7 days.
  return {
    answer,
    source: "llm",
    cacheable: answer.action !== "unsupported",
  };
}
