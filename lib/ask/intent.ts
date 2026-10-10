import { z } from "zod";
import { METRIC_IDS, metricPath } from "./metrics";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const kindSchema = z.enum(["river", "subbasin"]);
const metricSchema = z.enum(METRIC_IDS);
const orderSchema = z.enum(["max", "min"]);

/** Most items a comparison may name. */
export const COMPARE_MAX = 5;
/** Most filters a ranking may combine. */
export const FILTERS_MAX = 4;

/**
 * Conditions a ranking may apply; each one is evaluated on seeded fields (lib/ask/server/
 * answer.ts), never on values from the LLM. `threshold.number` is the user's own number,
 * accepted only if it appears in the question (see numberInQuestion).
 */
export const filterSchema = z.discriminatedUnion("type", [
  /** Same rule as the map's blue/orange line (GIRES predcat1), over every reach. */
  z.strictObject({
    type: z.literal("regime"),
    value: z.enum(["perennial", "nonPerennial"]),
  }),
  /** Reservoir storage upstream (GRanD) above zero, or not. */
  z.strictObject({
    type: z.literal("regulated"),
    value: z.enum(["yes", "no"]),
  }),
  /** Rivers or sub-basins inside a sub-basin. */
  z.strictObject({ type: z.literal("within"), slug: slugSchema }),
  /** A metric above / below a number the user wrote, in the metric's stored unit. */
  z.strictObject({
    type: z.literal("threshold"),
    metric: metricSchema,
    op: z.enum(["gt", "lt"]),
    number: z.number().finite().nonnegative(),
  }),
]);
export type Filter = z.infer<typeof filterSchema>;

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
    filters: z.array(filterSchema).max(FILTERS_MAX).optional(),
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
    filters: nullable({
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["regime", "regulated", "within", "threshold"],
          },
          value: nullable({
            type: "string",
            enum: ["perennial", "nonPerennial", "yes", "no"],
          }),
          slug: nullable({ type: "string" }),
          metric: nullable({ type: "string", enum: [...METRIC_IDS] }),
          op: nullable({ type: "string", enum: ["gt", "lt"] }),
          number: nullable({ type: "number" }),
        },
        required: ["type", "value", "slug", "metric", "op", "number"],
        additionalProperties: false,
      },
    }),
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
    "filters",
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
  const dropNulls = (o: object) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const flat = dropNulls(raw);
  if (Array.isArray(flat.filters))
    flat.filters = flat.filters.map((f: unknown) =>
      typeof f === "object" && f !== null && !Array.isArray(f)
        ? dropNulls(f)
        : f,
    );
  const parsed = intentSchema.safeParse(flat);
  return parsed.success ? parsed.data : null;
}

/**
 * True when `n` is written in the question: as digits, with "." or "," decimals, or with
 * thousands grouped by ".", "," or a space ("1.000", "1 000"). Normalization turns
 * punctuation into spaces, so "1,5" may arrive as "1 5".
 */
export function numberInQuestion(n: number, question: string): boolean {
  const groups = question.match(/\d+(?:[ .,]\d+)*/g) ?? [];
  return groups.some((g) => {
    const parts = g.split(/[ .,]/);
    const candidates = [Number(parts.join(""))];
    for (let i = 1; i < parts.length; i++)
      candidates.push(
        Number(`${parts.slice(0, i).join("")}.${parts.slice(i).join("")}`),
      );
    for (const p of parts) candidates.push(Number(p));
    return candidates.includes(n);
  });
}

/** Every filter is grounded: a known sub-basin, a metric of the kind, a number the user wrote. */
function filtersGrounded(
  filters: Filter[],
  kind: "river" | "subbasin",
  known: KnownIds,
  question: string | undefined,
): boolean {
  return filters.every((f) => {
    switch (f.type) {
      case "regime":
      case "regulated":
        return true;
      case "within":
        return known.subbasins.has(f.slug);
      case "threshold":
        return (
          metricPath(f.metric, kind) !== null &&
          question !== undefined &&
          numberInQuestion(f.number, question)
        );
    }
  });
}

/** Every id is a known one of `kind`, and `metric` exists for `kind`. */
function isGrounded(
  intent: Intent,
  known: KnownIds,
  question: string | undefined,
): boolean {
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
          : intent.slug !== undefined && ids(intent.kind).has(intent.slug)) &&
        filtersGrounded(intent.filters ?? [], intent.kind, known, question)
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
 * river or sub-basin of the right kind, the metric must exist for that kind, and a
 * threshold's number must appear in `question` (without it, a threshold is rejected).
 * Anything else is `unsupported`.
 */
export function validateIntent(
  raw: unknown,
  known: KnownIds,
  question?: string,
): Intent {
  const intent = toIntent(raw);
  return intent && isGrounded(intent, known, question) ? intent : UNSUPPORTED;
}

/** Parses an LLM's text output; invalid JSON is `unsupported`. */
export function validateIntentText(
  text: string,
  known: KnownIds,
  question?: string,
): Intent {
  try {
    return validateIntent(JSON.parse(text) as unknown, known, question);
  } catch {
    return UNSUPPORTED;
  }
}
