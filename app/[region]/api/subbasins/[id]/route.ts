import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseRegion, parseSubbasinId } from "@/lib/data/params";
import { getSubbasin } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/subbasins/[id]">,
) {
  const params = await ctx.params;
  const region = parseRegion(params.region);
  if (!region) return notFound();
  const id = parseSubbasinId(params.id);
  if (!id) return badRequest();
  try {
    const subbasin = await getSubbasin(region, id);
    return subbasin ? json(subbasin) : notFound();
  } catch (error) {
    return serverError("api/subbasins", error);
  }
}
