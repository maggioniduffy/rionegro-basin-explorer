import "server-only";
import { Redis } from "@upstash/redis";
import { getAskEnv, type AskEnv } from "@/lib/env";

/** The ask env, or nothing when it is malformed: the route then fails closed, not 500. */
function readEnv(): AskEnv {
  try {
    return getAskEnv();
  } catch {
    return {};
  }
}

let cached: { url: string; token: string; redis: Redis } | undefined;

/** Upstash REST client, or null when the Upstash variables are not set. */
export function getRedis(): Redis | null {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } =
    readEnv();
  if (!url || !token) return null;
  if (cached?.url !== url || cached.token !== token) {
    cached = { url, token, redis: new Redis({ url, token }) };
  }
  return cached.redis;
}

/** Salt for client-IP keys; null when unset (the rate limit, and so the LLM, stay off). */
export function getIpSalt(): string | null {
  return readEnv().ASK_IP_SALT ?? null;
}
