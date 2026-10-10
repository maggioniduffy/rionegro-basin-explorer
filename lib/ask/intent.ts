import { z } from "zod";
import { METRIC_IDS, metricPath } from "./metrics";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const kindSchema = z.enum(["river", "subbasin"]);
const metricSchema = z.enum(METRIC_IDS);
const orderSchema = z.enum(["max", "min"]);

/** Most items a comparison may name. */
export const COMPARE_MAX = 5;

/**
 * What the LLM may answer: a route to an id, a name to search, a comparison / ranking /
 * single value of a whitelisted metric (lib/ask/metrics.ts), or nothing. Never a fact or a
 * number: values are read from Mongo afterwards. Parsed strictly; anything else becomes
 * `unsupported`.
 */
export const intentSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("select_river"), slug: slugSchema }),
  z.strictObject({ action: z.literal("select_subbasin"), slug: slugSchema }),
  z.strictObject({
    action: z.literal("search"),
    query: z.string().trim().min(1).max(64),
  }),
  /** "¿Qué río es más largo, Caleufú o Agrio?" */
  z.strictObject({
    action: z.literal("compare"),
    kind: kindSchema,
    slugs: z
      .array(slugSchema)
      .min(2)
      .max(COMPARE_MAX)
      .refine((s) => new Set(s).size === s.length),
    metric: metricSchema,
    order: orderSchema,
  }),
  /** "The longest tributary of the Limay" (scope tributaries, slug limay), "la subcuenca más grande". */
  z.strictObject({
    action: z.literal("rank"),
    kind: kindSchema,
    scope: z.enum(["all", "tributaries"]),
    slug: slugSchema.optional(),
    metric: metricSchema,
    order: orderSchema,
  }),
  /** "How long is the Limay?" */
  z.strictObject({
    action: z.literal("fact"),
    kind: kindSchema,
    slug: slugSchema,
    metric: metricSchema,
  }),
  z.strictObject({ action: z.literal("unsupported") }),
]);
export type Intent = z.infer<typeof intentSchema>;

export const UNSUPPORTED: Intent = { action: "unsupported" };

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
});

/**
 * JSON Schema sent to the providers. Strict structured output (Groq) needs every property
 * required and no extras, so the fields an action doesn't use are null instead of absent;
 * toIntent turns this flat shape back into an Intent.
 */
export const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "select_river",
        "select_subbasin",
        "search",
        "compare",
        "rank",
        "fact",
        "unsupported",
      ],
    },
    kind: nullable({ type: "string", enum: ["river", "subbasin"] }),
    slug: nullable({ type: "string" }),
    slugs: nullable({ type: "array", items: { type: "string" } }),
    metric: nullable({ type: "string", enum: [...METRIC_IDS] }),
    order: nullable({ type: "string", enum: ["max", "min"] }),
    scope: nullable({ type: "string", enum: ["all", "tributaries"] }),
    query: nullable({ type: "string" }),
  },
  required: [
    "action",
    "kind",
    "slug",
    "slugs",
    "metric",
    "order",
    "scope",
    "query",
  ],
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

/** Every id is a known one of `kind`, and `metric` exists for `kind`. */
function isGrounded(intent: Intent, known: KnownIds): boolean {
  const ids = (kind: "river" | "subbasin") =>
    kind === "river" ? known.rivers : known.subbasins;
  switch (intent.action) {
    case "select_river":
      return known.rivers.has(intent.slug);
    case "select_subbasin":
      return known.subbasins.has(intent.slug);
    case "compare":
      return (
        metricPath(intent.metric, intent.kind) !== null &&
        intent.slugs.every((s) => ids(intent.kind).has(s))
      );
    case "rank":
      return (
        metricPath(intent.metric, intent.kind) !== null &&
        (intent.scope === "all"
          ? intent.slug === undefined
          : intent.slug !== undefined && ids(intent.kind).has(intent.slug))
      );
    case "fact":
      return (
        metricPath(intent.metric, intent.kind) !== null &&
        ids(intent.kind).has(intent.slug)
      );
    case "search":
    case "unsupported":
      return true;
  }
}

/**
 * The only way an LLM answer reaches the client: it must parse, every slug must be a known
 * river or sub-basin of the right kind, and the metric must exist for that kind. Anything
 * else is `unsupported`.
 */
export function validateIntent(raw: unknown, known: KnownIds): Intent {
  const intent = toIntent(raw);
  return intent && isGrounded(intent, known) ? intent : UNSUPPORTED;
}

/** Parses an LLM's text output; invalid JSON is `unsupported`. */
export function validateIntentText(text: string, known: KnownIds): Intent {
  try {
    return validateIntent(JSON.parse(text) as unknown, known);
  } catch {
    return UNSUPPORTED;
  }
}
