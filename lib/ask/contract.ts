/**
 * POST /api/ask: shared between the route and AskBox. Kept free of server imports.
 *
 * Request: `{ q: string (≤ ASK_MAX_LENGTH), locale: "en" | "es" }`.
 * 200: AskResult. 400 `{ error: "bad_request" }`, 429 `{ error: "rate_limited" }` with a
 * `Retry-After` header, 500 `{ error: "server_error" }`. The UI translates the codes.
 */
export type AskSource = "fuzzy" | "llm" | "cache";

export type AskResult =
  /** Open this on the map (store `select`, with fit). */
  | {
      action: "select";
      kind: "river" | "subbasin" | "stream";
      id: string;
      source: AskSource;
    }
  /** The question named something, but no river, sub-basin or stream matches it. */
  | { action: "no_match"; source: AskSource }
  /** Not a question the map can answer. */
  | { action: "unsupported"; source: AskSource };

export type AskError = {
  error: "bad_request" | "rate_limited" | "server_error";
};
