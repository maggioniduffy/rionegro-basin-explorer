import { json, notFound, serverError } from "@/lib/data/http";
import { parseRegion } from "@/lib/data/params";
import { getSubbasinTree } from "@/lib/data/queries";

/** GET /api/subbasins → every sub-basin as [{ id, kind, name, level, parentId, childIds, areaKm2 }]. */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/subbasins">,
) {
  const region = parseRegion((await ctx.params).region);
  if (!region) return notFound();
  try {
    return json(await getSubbasinTree(region));
  } catch (error) {
    return serverError("api/subbasins", error);
  }
}
