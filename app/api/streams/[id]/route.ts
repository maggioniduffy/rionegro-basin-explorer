import { badRequest, json, notFound, serverError } from "@/lib/data/http";
import { parseStreamId } from "@/lib/data/params";
import { getStream } from "@/lib/data/queries";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/streams/[id]">,
) {
  const id = parseStreamId((await ctx.params).id);
  if (!id) return badRequest();
  try {
    const stream = await getStream(id);
    return stream ? json(stream) : notFound();
  } catch (error) {
    return serverError("api/streams", error);
  }
}
