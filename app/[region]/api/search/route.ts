import type { NextRequest } from "next/server";
import { fuzzySearchHits } from "@/lib/ask/search";
import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseRegion, parseSearchQuery } from "@/lib/data/params";
import { searchNames } from "@/lib/data/queries";

/**
 * GET /api/search?q=neuq → named rivers and IGN streams: [{ kind, id, name, bbox?, subbasin? }].
 * Names that start with `q` come first; only when there are none, names close to it
 * (typos: "collon cra", "limai").
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/[region]/api/search">,
) {
  const region = parseRegion((await ctx.params).region);
  if (!region) return notFound();
  const q = parseSearchQuery(req.nextUrl.searchParams.get("q"));
  if (!q) return badRequest();
  try {
    const hits = await searchNames(region, q);
    if (hits.length > 0 || /^\d+$/.test(q)) return json(hits);
    return json(await fuzzySearchHits(region, q));
  } catch (error) {
    return serverError("api/search", error);
  }
}
