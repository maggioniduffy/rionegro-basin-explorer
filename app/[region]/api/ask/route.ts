import { handleAsk } from "@/lib/ask/server/handler";
import { notFound } from "@/lib/data/http";
import { parseRegion } from "@/lib/data/params";

/**
 * POST /api/ask `{ q, locale }` → AskResult (see lib/ask/contract.ts): a fuzzy match, else
 * the LLM (rate limited per client), routed to a river, sub-basin or stream id.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/[region]/api/ask">,
) {
  const region = parseRegion((await ctx.params).region);
  if (!region) return notFound();
  return handleAsk(req, region);
}
