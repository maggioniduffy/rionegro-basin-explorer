import "server-only";
import { getDb } from "@/lib/mongo";
import { searchPattern, SEARCH_LIMIT } from "./params";
import type { Reach, River, RiverDoc, Subbasin } from "./schemas";

/** River as served by /api/rivers/[id]: the stored document plus names it refers to. */
export type RiverResponse = River & { flowsIntoName: string | null };

/** Reach as served by /api/reaches/[id]. */
export type ReachResponse = Reach & { riverName: string | null };

export interface NamedRef {
  id: string;
  name: string;
}

/** Link to a sub-basin; endorheic land has no name (the app labels it). */
export type SubbasinRef = Pick<Subbasin, "kind" | "name"> & { id: string };

/** Sub-basin as served by /api/subbasins/[id], with the names of what it links to. */
export type SubbasinResponse = Subbasin & {
  parent: SubbasinRef | null;
  children: SubbasinRef[];
  riverRefs: NamedRef[];
};

export interface SearchHit {
  id: string;
  name: string;
}

const rivers = async () => (await getDb()).collection<RiverDoc>("rivers");
const reaches = async () => (await getDb()).collection<Reach>("reaches");
const subbasins = async () =>
  (await getDb()).collection<Subbasin>("subbasins");

/** Refs of the rivers `ids`, in the order given; unknown ids are left out. */
async function namedRivers(ids: string[]): Promise<NamedRef[]> {
  if (ids.length === 0) return [];
  const docs = await (await rivers())
    .find({ _id: { $in: ids } }, { projection: { name: 1 } })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id, d.name]));
  return ids.flatMap((id) => {
    const name = byId.get(id);
    return name === undefined ? [] : [{ id, name }];
  });
}

/** Refs of the sub-basins `ids`, in the order given; unknown ids are left out. */
async function subbasinRefs(ids: string[]): Promise<SubbasinRef[]> {
  if (ids.length === 0) return [];
  const docs = await (await subbasins())
    .find({ _id: { $in: ids } }, { projection: { name: 1, kind: 1 } })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.flatMap((id) => {
    const d = byId.get(id);
    return d ? [{ id, name: d.name, kind: d.kind }] : [];
  });
}

async function riverName(id: string | null): Promise<string | null> {
  if (!id || id === "sea") return null;
  const doc = await (await rivers()).findOne(
    { _id: id },
    { projection: { name: 1 } },
  );
  return doc?.name ?? null;
}

export async function getRiver(id: string): Promise<RiverResponse | null> {
  const doc = await (await rivers()).findOne(
    { _id: id },
    { projection: { searchTerms: 0 } },
  );
  if (!doc) return null;
  return { ...doc, flowsIntoName: await riverName(doc.flowsInto) };
}

export async function getReach(id: number): Promise<ReachResponse | null> {
  const doc = await (await reaches()).findOne({ _id: id });
  if (!doc) return null;
  return { ...doc, riverName: await riverName(doc.river) };
}

export async function getSubbasin(
  id: string,
): Promise<SubbasinResponse | null> {
  const doc = await (await subbasins()).findOne({ _id: id });
  if (!doc) return null;
  const [parent, children, riverRefs] = await Promise.all([
    doc.parentId === null ? [] : subbasinRefs([doc.parentId]),
    subbasinRefs(doc.childIds),
    namedRivers(doc.rivers),
  ]);
  return { ...doc, parent: parent[0] ?? null, children, riverRefs };
}

/** Rivers whose name has a word starting with the normalized query; longest first. */
export async function searchRivers(q: string): Promise<SearchHit[]> {
  const docs = await (await rivers())
    .find(
      { searchTerms: { $regex: searchPattern(q) } },
      { projection: { name: 1 } },
    )
    .sort({ lengthKm: -1 })
    .limit(SEARCH_LIMIT)
    .toArray();
  return docs.map((d) => ({ id: d._id, name: d.name }));
}
