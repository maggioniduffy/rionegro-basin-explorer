import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { getIpSalt, getRedis } from "./redis";

export type LimitVerdict =
  | { status: "ok" }
  /** Over a limit: answer 429 and tell the client when to come back. */
  | { status: "limited"; retryAfter: number }
  /** No Upstash, no salt, or Redis failed: the LLM must not be called. */
  | { status: "unavailable" };

/** Anonymous rate-limit key: the raw IP is hashed with a secret salt and never stored. */
export function ipKey(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}${ip}`).digest("hex").slice(0, 32);
}

/** First `x-forwarded-for` entry, else `x-real-ip`, else "unknown". */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

interface Limiters {
  minute: Ratelimit;
  day: Ratelimit;
}

const limiters = new WeakMap<Redis, Limiters>();

function getLimiters(redis: Redis): Limiters {
  let found = limiters.get(redis);
  if (!found) {
    found = {
      minute: new Ratelimit({
        redis,
        prefix: "ask:rl:1m",
        limiter: Ratelimit.slidingWindow(10, "1 m"),
      }),
      day: new Ratelimit({
        redis,
        prefix: "ask:rl:1d",
        limiter: Ratelimit.slidingWindow(100, "1 d"),
      }),
    };
    limiters.set(redis, found);
  }
  return found;
}

/** 10 requests a minute and 100 a day per client. Never throws. */
export async function checkRateLimit(ip: string): Promise<LimitVerdict> {
  const redis = getRedis();
  const salt = getIpSalt();
  if (!redis || !salt) return { status: "unavailable" };
  const key = ipKey(ip, salt);
  try {
    const { minute, day } = getLimiters(redis);
    for (const limiter of [minute, day]) {
      const res = await limiter.limit(key);
      // The library lets the request through when Redis is too slow ("timeout").
      if (res.reason === "timeout") return { status: "unavailable" };
      if (!res.success) {
        const seconds = Math.ceil((res.reset - Date.now()) / 1000);
        return { status: "limited", retryAfter: Math.max(1, seconds) };
      }
    }
    return { status: "ok" };
  } catch {
    return { status: "unavailable" };
  }
}
