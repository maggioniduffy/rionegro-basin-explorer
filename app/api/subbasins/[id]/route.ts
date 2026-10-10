import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseSubbasinId } from "@/lib/data/params";
import { getSubbasin } from "@/lib/data/queries";
// The request's region arrives with app/[region] (PLAN.md R1, step 5b).
import { DEFAULT_REGION } from "@/regions";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/subbasins/[id]">,
) {
  const id = parseSubbasinId((await ctx.params).id);
  if (!id) return badRequest();
  try {
    const subbasin = await getSubbasin(DEFAULT_REGION, id);
    return subbasin ? json(subbasin) : notFound();
  } catch (error) {
    return serverError("api/subbasins", error);
  }
}
