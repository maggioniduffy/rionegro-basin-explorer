import "server-only";
import { z } from "zod";
import { getCatalog, type Catalog } from "@/lib/ask/catalog";
import type { AskResult } from "@/lib/ask/contract";
import { ASK_MAX_LENGTH, askCacheKey, parseAsk } from "@/lib/ask/query";
import { badRequest, json, serverError } from "@/lib/data/http";
import { readCache, writeCache, type AskAnswer } from "./cache";
import { checkRateLimit, clientIp } from "./limiter";
import { resolveAsk } from "./resolve";

const bodySchema = z.object({
  q: z.string().max(ASK_MAX_LENGTH),
  locale: z.enum(["en", "es"]),
});

// A question is at most 120 characters; anything much larger is not one.
const MAX_BODY_CHARS = 1024;

async function readBody(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const parsed = bodySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A cached answer may only point at something the current catalog has. */
function isInCatalog(answer: AskAnswer, catalog: Catalog): boolean {
  if (answer.action !== "select") return true;
  return catalog.entries.some(
    (e) => e.kind === answer.kind && e.id === answer.id,
  );
}

const respond = (result: AskResult) => json(result, { cache: "no-store" });

/**
 * POST /api/ask logic. Neither the question nor the client's address is ever logged:
 * errors are reported by name only.
 */
export async function handleAsk(req: Request): Promise<Response> {
  const body = await readBody(req);
  const parsed = body && parseAsk(body.q);
  if (!body || !parsed) return badRequest();

  try {
    const limit = await checkRateLimit(clientIp(req.headers));
    if (limit.status === "limited") {
      return Response.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(limit.retryAfter),
          },
        },
      );
    }
    const llmAllowed = limit.status === "ok";

    const catalog = await getCatalog();
    const key = askCacheKey(parsed.normalized, body.locale, catalog.version);
    const hit = await readCache(key);
    if (hit && isInCatalog(hit, catalog)) {
      return respond({ ...hit, source: "cache" });
    }

    const { answer, source, cacheable } = await resolveAsk(
      parsed,
      body.locale,
      catalog,
      llmAllowed,
    );
    if (cacheable) await writeCache(key, answer);
    return respond({ ...answer, source });
  } catch (error) {
    return serverError(
      "api/ask",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
