import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseReachId } from "@/lib/data/params";
import { getReach } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/reaches/[id]">,
) {
  const id = parseReachId((await ctx.params).id);
  if (!id) return badRequest();
  try {
    const reach = await getReach(id);
    return reach ? json(reach) : notFound();
  } catch (error) {
    return serverError("api/reaches", error);
  }
}
