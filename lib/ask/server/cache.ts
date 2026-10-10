import "server-only";
import { z } from "zod";
import { intentSchema } from "@/lib/ask/intent";
import type { AnswerIntent } from "./answer";
import { getRedis } from "./redis";

/**
 * What a question resolved to, before any value is read: a place to open, nothing, or the
 * validated intent of a comparison / ranking / fact. The numbers are never cached; a hit
 * re-reads them from Mongo, so a reseed cannot serve stale values.
 */
export type AskResolution =
  | { action: "select"; kind: "river" | "subbasin" | "stream"; id: string }
  | { action: "no_match" }
  | { action: "unsupported" }
  | AnswerIntent;

export const CACHE_MAX_ENTRIES = 500;
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const simpleSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("select"),
    kind: z.enum(["river", "subbasin", "stream"]),
    id: z.string().min(1).max(128),
  }),
  z.strictObject({ action: z.literal("no_match") }),
  z.strictObject({ action: z.literal("unsupported") }),
]);

/** A cached value: one of the simple resolutions, or a compare / rank / fact intent. */
function parseResolution(value: unknown): AskResolution | null {
  const simple = simpleSchema.safeParse(value);
  if (simple.success) return simple.data;
  const intent = intentSchema.safeParse(value);
  if (!intent.success) return null;
  const { data } = intent;
  return data.action === "compare" ||
    data.action === "rank" ||
    data.action === "fact"
    ? data
    : null;
}

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

const memory = new LruCache<AskResolution>(CACHE_MAX_ENTRIES);

/** Memory first, then Upstash. Redis errors and malformed values count as a miss. */
export async function readCache(key: string): Promise<AskResolution | null> {
  const local = memory.get(key);
  if (local) return local;
  const redis = getRedis();
  if (!redis) return null;
  try {
    const parsed = parseResolution(await redis.get<unknown>(key));
    if (!parsed) return null;
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Writes both tiers (Redis for 7 days); a Redis error is ignored. */
export async function writeCache(
  key: string,
  resolution: AskResolution,
): Promise<void> {
  memory.set(key, resolution);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, resolution, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Not cached beyond this instance.
  }
}
