import { getDb } from "@/lib/mongo";

export async function GET() {
  let db: "up" | "down";
  try {
    await (await getDb()).command({ ping: 1 });
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
