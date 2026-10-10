import { getDb } from "@/lib/mongo";
import { DEFAULT_REGION } from "@/regions";

export async function GET() {
  let db: "up" | "down";
  try {
    await (await getDb(DEFAULT_REGION)).command({ ping: 1 });
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
