import type { NextRequest } from "next/server";
import { badRequest, json, serverError } from "@/lib/data/http";
import { parseSearchQuery } from "@/lib/data/params";
import { searchNames } from "@/lib/data/queries";

/** GET /api/search?q=neuq → named rivers and IGN names: [{ kind, id, name, bbox? }]. */
export async function GET(req: NextRequest) {
  const q = parseSearchQuery(req.nextUrl.searchParams.get("q"));
  if (!q) return badRequest();
  try {
    return json(await searchNames(q));
  } catch (error) {
    return serverError("api/search", error);
  }
}
