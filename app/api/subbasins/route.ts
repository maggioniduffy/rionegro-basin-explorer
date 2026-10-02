import { json, serverError } from "@/lib/data/http";
import { getSubbasinTree } from "@/lib/data/queries";

/** GET /api/subbasins → every sub-basin as [{ id, kind, name, level, parentId, childIds, areaKm2 }]. */
export async function GET() {
  try {
    return json(await getSubbasinTree());
  } catch (error) {
    return serverError("api/subbasins", error);
  }
}
