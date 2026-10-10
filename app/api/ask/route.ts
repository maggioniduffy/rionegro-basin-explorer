import { handleAsk } from "@/lib/ask/server/handler";
// The request's region arrives with app/[region] (PLAN.md R1, step 5b).
import { DEFAULT_REGION } from "@/regions";

/**
 * POST /api/ask `{ q, locale }` → AskResult (see lib/ask/contract.ts): a fuzzy match, else
 * the LLM (rate limited per client), routed to a river, sub-basin or stream id.
 */
export async function POST(req: Request) {
  return handleAsk(req, DEFAULT_REGION);
}
