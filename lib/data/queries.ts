import "server-only";
import { getDb } from "@/lib/mongo";
import { searchPattern, SEARCH_LIMIT } from "./params";
import type { Reach, River, RiverDoc } from "./schemas";

/** River as served by /api/rivers/[id]: the stored document plus names it refers to. */
export type RiverResponse = River & { flowsIntoName: string | null };

/** Reach as served by /api/reaches/[id]. */
export type ReachResponse = Reach & { riverName: string | null };

export interface SearchHit {
  id: string;
  name: string;
}

const rivers = () => getDb().collection<RiverDoc>("rivers");
const reaches = () => getDb().collection<Reach>("reaches");

async function riverName(id: string | null): Promise<string | null> {
  if (!id || id === "sea") return null;
  const doc = await rivers().findOne(
    { _id: id },
    { projection: { name: 1 } },
  );
  return doc?.name ?? null;
}

export async function getRiver(id: string): Promise<RiverResponse | null> {
  const doc = await rivers().findOne(
    { _id: id },
    { projection: { searchTerms: 0 } },
  );
  if (!doc) return null;
  return { ...doc, flowsIntoName: await riverName(doc.flowsInto) };
}

export async function getReach(id: number): Promise<ReachResponse | null> {
  const doc = await reaches().findOne({ _id: id });
  if (!doc) return null;
  return { ...doc, riverName: await riverName(doc.river) };
}

/** Rivers whose name has a word starting with the normalized query; longest first. */
export async function searchRivers(q: string): Promise<SearchHit[]> {
  const docs = await rivers()
    .find(
      { searchTerms: { $regex: searchPattern(q) } },
      { projection: { name: 1 } },
    )
    .sort({ lengthKm: -1 })
    .limit(SEARCH_LIMIT)
    .toArray();
  return docs.map((d) => ({ id: d._id, name: d.name }));
}
