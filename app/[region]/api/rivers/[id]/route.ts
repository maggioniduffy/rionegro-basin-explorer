import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseRegion, parseRiverId } from "@/lib/data/params";
import { getRiver } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/rivers/[id]">,
) {
  const params = await ctx.params;
  const region = parseRegion(params.region);
  if (!region) return notFound();
  const id = parseRiverId(params.id);
  if (!id) return badRequest();
  try {
    const river = await getRiver(region, id);
    return river ? json(river) : notFound();
  } catch (error) {
    return serverError("api/rivers", error);
  }
}
