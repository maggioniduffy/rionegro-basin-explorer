import { json, serverError } from "@/lib/data/http";
import { getSubbasinTree } from "@/lib/data/queries";
// The request's region arrives with app/[region] (PLAN.md R1, step 5b).
import { DEFAULT_REGION } from "@/regions";

/** GET /api/subbasins → every sub-basin as [{ id, kind, name, level, parentId, childIds, areaKm2 }]. */
export async function GET() {
  try {
    return json(await getSubbasinTree(DEFAULT_REGION));
  } catch (error) {
    return serverError("api/subbasins", error);
  }
}
