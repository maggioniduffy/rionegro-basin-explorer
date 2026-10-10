import "server-only";
import { z } from "zod";
import type { AskResult } from "@/lib/ask/contract";
import { getRedis } from "./redis";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** An answer as cached: the same as the response, without where it came from. */
export type AskAnswer = DistributiveOmit<AskResult, "source">;

export const CACHE_MAX_ENTRIES = 500;
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const answerSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("select"),
    kind: z.enum(["river", "subbasin", "stream"]),
    id: z.string().min(1).max(128),
  }),
  z.strictObject({ action: z.literal("no_match") }),
  z.strictObject({ action: z.literal("unsupported") }),
]);

/** Least recently used map: a hit moves the key to the end, the first key is evicted. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

const memory = new LruCache<AskAnswer>(CACHE_MAX_ENTRIES);

/** Memory first, then Upstash. Redis errors and malformed values count as a miss. */
export async function readCache(key: string): Promise<AskAnswer | null> {
  const local = memory.get(key);
  if (local) return local;
  const redis = getRedis();
  if (!redis) return null;
  try {
    const parsed = answerSchema.safeParse(await redis.get<unknown>(key));
    if (!parsed.success) return null;
    memory.set(key, parsed.data);
    return parsed.data;
  } catch {
    return null;
  }
}

/** Writes both tiers (Redis for 7 days); a Redis error is ignored. */
export async function writeCache(
  key: string,
  answer: AskAnswer,
): Promise<void> {
  memory.set(key, answer);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, answer, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Not cached beyond this instance.
  }
}
