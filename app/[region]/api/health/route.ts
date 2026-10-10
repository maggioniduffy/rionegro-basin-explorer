import { getDb } from "@/lib/mongo";
import { parseRegion } from "@/lib/data/params";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/health">,
) {
  const region = parseRegion((await ctx.params).region);
  if (!region) return new Response(null, { status: 404 });
  let db: "up" | "down";
  try {
    await (await getDb(region)).command({ ping: 1 });
    db = "up";
  } catch (error) {
    // Log server-side only; the response never includes error details.
    console.error("health: mongo ping failed", error);
    db = "down";
  }

  return Response.json(
    { ok: db === "up", db },
    {
      status: db === "up" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
