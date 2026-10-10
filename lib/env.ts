import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  MONGODB_URI: z.string().startsWith("mongodb"),
  MONGODB_DB: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Server-only env, validated lazily so `next build` works without secrets.
 * Throws if a required variable is missing or malformed.
 */
export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
  });
  return cached;
}

const llmEnvSchema = z.discriminatedUnion("LLM_PROVIDER", [
  z.object({ LLM_PROVIDER: z.undefined() }),
  z.object({
    LLM_PROVIDER: z.literal("groq"),
    GROQ_API_KEY: z.string().min(1),
    LLM_MODEL: z.string().min(1).optional(),
  }),
  z.object({
    LLM_PROVIDER: z.literal("gemini"),
    GEMINI_API_KEY: z.string().min(1),
    LLM_MODEL: z.string().min(1).optional(),
  }),
]);

export type LlmEnv = z.infer<typeof llmEnvSchema>;

/**
 * The ask box's LLM. LLM_PROVIDER unset turns it off: queries the fuzzy match can't resolve
 * are `unsupported`. Throws if a provider is set without its key.
 */
export function getLlmEnv(): LlmEnv {
  const empty = (v: string | undefined) => (v === "" ? undefined : v);
  return llmEnvSchema.parse({
    LLM_PROVIDER: empty(process.env.LLM_PROVIDER),
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    LLM_MODEL: empty(process.env.LLM_MODEL),
  });
}

const askEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  /** Salt for hashing client IPs into rate-limit keys; raw IPs are never stored. */
  ASK_IP_SALT: z.string().min(16).optional(),
});

export type AskEnv = z.infer<typeof askEnvSchema>;

/**
 * Rate limit and shared cache for /api/ask (Upstash Redis). Without them the route still
 * answers fuzzy matches but never calls the LLM (fails closed, so the quota can't be burned).
 */
export function getAskEnv(): AskEnv {
  const empty = (v: string | undefined) => (v === "" ? undefined : v);
  return askEnvSchema.parse({
    UPSTASH_REDIS_REST_URL: empty(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: empty(process.env.UPSTASH_REDIS_REST_TOKEN),
    ASK_IP_SALT: empty(process.env.ASK_IP_SALT),
  });
}
