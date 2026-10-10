import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseRegion, parseStreamId } from "@/lib/data/params";
import { getStream } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/streams/[id]">,
) {
  const params = await ctx.params;
  const region = parseRegion(params.region);
  if (!region) return notFound();
  const id = parseStreamId(params.id);
  if (!id) return badRequest();
  try {
    const stream = await getStream(region, id);
    return stream ? json(stream) : notFound();
  } catch (error) {
    return serverError("api/streams", error);
  }
}
