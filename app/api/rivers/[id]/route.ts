import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseRiverId } from "@/lib/data/params";
import { getRiver } from "@/lib/data/queries";
// The request's region arrives with app/[region] (PLAN.md R1, step 5b).
import { DEFAULT_REGION } from "@/regions";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/rivers/[id]">,
) {
  const id = parseRiverId((await ctx.params).id);
  if (!id) return badRequest();
  try {
    const river = await getRiver(DEFAULT_REGION, id);
    return river ? json(river) : notFound();
  } catch (error) {
    return serverError("api/rivers", error);
  }
}
