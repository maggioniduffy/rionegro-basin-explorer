import type { Filter } from "./intent";
import type { MetricId, MetricKind } from "./metrics";

/**
 * POST /api/ask: shared between the route and the search bar. Kept free of server imports.
 *
 * Request: `{ q: string (≤ ASK_MAX_LENGTH), locale: "en" | "es" }`.
 * 200: AskResult. 400 `{ error: "bad_request" }`, 429 `{ error: "rate_limited" }` with a
 * `Retry-After` header, 500 `{ error: "server_error" }`. The UI translates the codes.
 */
export type AskSource = "fuzzy" | "llm" | "cache";

export type SelectKind = "river" | "subbasin" | "stream";

/** One river or sub-basin of an answer, with the value read from its Mongo document. */
export interface AnswerItem {
  id: string;
  /** Null for the endorheic sub-basin (the client labels it). */
  name: string | null;
  /** The stored value, in the metric's stored unit; null when the document has none (rule 2). */
  value: number | null;
  /** The document lists this field in `modeled` (show the caveat). */
  modeled: boolean;
  /**
   * Share of the length on reaches the map draws orange (GIRES, modeled); only when the
   * ranking filters by regime, so the card can show it for mixed rivers.
   */
  nonPerennialPct?: number | null;
}

/**
 * A comparison, ranking or single value, computed on the server from seeded documents.
 * The client writes the sentence from i18n templates and formats values with the km/mi
 * toggle; no number comes from the LLM.
 */
export interface AskAnswer {
  type: "compare" | "rank" | "fact";
  kind: MetricKind;
  metric: MetricId;
  /** compare / rank only. */
  order: "max" | "min" | null;
  /** rank with scope tributaries: the parent river or sub-basin. */
  parent: { id: string; name: string | null } | null;
  /** Best first (by `order`); items without a value last. rank: at most 5, 10 with filters. */
  items: AnswerItem[];
  /** Ids sharing the best value (more than one on a tie); empty when no item has a value. */
  winnerIds: string[];
  /** The document field's provenance text (data/out provenance map), shown as the source. */
  provenance: string | null;
  /** rank only: the conditions applied (echoed for the card); empty without filters. */
  filters: Filter[];
  /** rank only: how many rivers or sub-basins met the filters (items shows the first ones). */
  total: number | null;
  /** Caveats the filters bring (regime: GIRES, regulated: GRanD), besides the metric's. */
  filterCaveats: ("nonPerennial" | "regulation")[];
}

export type AskResult =
  /** Open this on the map (store `select`, with fit). */
  | { action: "select"; kind: SelectKind; id: string; source: AskSource }
  /** Show the answer card; `select` (the winner, or the fact's item) is opened too. */
  | {
      action: "answer";
      answer: AskAnswer;
      select: { kind: MetricKind; id: string } | null;
      source: AskSource;
    }
  /** The question named something, but no river, sub-basin or stream matches it. */
  | { action: "no_match"; source: AskSource }
  /** Not a question the map can answer. */
  | { action: "unsupported"; source: AskSource };

export type AskError = {
  error: "bad_request" | "rate_limited" | "server_error";
};
