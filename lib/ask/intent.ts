import { z } from "zod";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

/**
 * What the LLM may answer: a route to an id, a name to search, or nothing. Never a fact
 * or a number. Parsed strictly; anything else becomes `unsupported`.
 */
export const intentSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("select_river"), slug: slugSchema }),
  z.strictObject({ action: z.literal("select_subbasin"), slug: slugSchema }),
  z.strictObject({
    action: z.literal("search"),
    query: z.string().trim().min(1).max(64),
  }),
  z.strictObject({ action: z.literal("unsupported") }),
]);
export type Intent = z.infer<typeof intentSchema>;

export const UNSUPPORTED: Intent = { action: "unsupported" };

/**
 * JSON Schema sent to the providers. Strict structured output (Groq) needs every property
 * required and no extras, so `slug` and `query` are nullable instead of optional;
 * toIntent turns this flat shape back into an Intent.
 */
export const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["select_river", "select_subbasin", "search", "unsupported"],
    },
    slug: { type: ["string", "null"] },
    query: { type: ["string", "null"] },
  },
  required: ["action", "slug", "query"],
  additionalProperties: false,
} as const;

/** Ids the intent may point at (from the catalog, i.e. from Mongo). */
export interface KnownIds {
  rivers: ReadonlySet<string>;
  subbasins: ReadonlySet<string>;
}

/** Drops the provider's null fields, then parses. */
function toIntent(raw: unknown): Intent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const flat = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null),
  );
  const parsed = intentSchema.safeParse(flat);
  return parsed.success ? parsed.data : null;
}

/**
 * The only way an LLM answer reaches the client: it must parse, and a slug must be a
 * known river or sub-basin of the right kind. Anything else is `unsupported`.
 */
export function validateIntent(raw: unknown, known: KnownIds): Intent {
  const intent = toIntent(raw);
  if (!intent) return UNSUPPORTED;
  if (intent.action === "select_river" && !known.rivers.has(intent.slug))
    return UNSUPPORTED;
  if (intent.action === "select_subbasin" && !known.subbasins.has(intent.slug))
    return UNSUPPORTED;
  return intent;
}

/** Parses an LLM's text output; invalid JSON is `unsupported`. */
export function validateIntentText(text: string, known: KnownIds): Intent {
  try {
    return validateIntent(JSON.parse(text) as unknown, known);
  } catch {
    return UNSUPPORTED;
  }
}
