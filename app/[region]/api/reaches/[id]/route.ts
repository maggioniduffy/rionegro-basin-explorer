import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseReachId, parseRegion } from "@/lib/data/params";
import { getReach } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/reaches/[id]">,
) {
  const params = await ctx.params;
  const region = parseRegion(params.region);
  if (!region) return notFound();
  const id = parseReachId(params.id);
  if (!id) return badRequest();
  try {
    const reach = await getReach(region, id);
    return reach ? json(reach) : notFound();
  } catch (error) {
    return serverError("api/reaches", error);
  }
}
