import "server-only";
import { getDb } from "@/lib/mongo";
import { parseReachId, searchPattern, SEARCH_LIMIT } from "./params";
import type {
  Bbox,
  Reach,
  River,
  RiverDoc,
  Stream,
  StreamDoc,
  Subbasin,
} from "./schemas";

/** River as served by /api/rivers/[id]: the stored document plus names it refers to. */
export type RiverResponse = River & { flowsIntoName: string | null };

/**
 * Stream as served by /api/streams/[id]: the stored document plus the names it refers to.
 * `subbasinRef` is the sub-basin that holds its mouth; `receivingRiverRef` the approved
 * river downstream of it.
 */
export type StreamResponse = Stream & {
  subbasinRef: SubbasinRef | null;
  receivingRiverRef: NamedRef | null;
};

/** Reach as served by /api/reaches/[id]. */
export type ReachResponse = Reach & {
  riverName: string | null;
  streamName: string | null;
};

export interface NamedRef {
  id: string;
  name: string;
}

/** Link to a sub-basin; endorheic land has no name (the app labels it). */
export type SubbasinRef = Pick<Subbasin, "kind" | "name"> & { id: string };

/** Sub-basin as served by /api/subbasins/[id], with the names of what it links to. */
export type SubbasinResponse = Subbasin & {
  parent: SubbasinRef | null;
  /** From the root down to the parent, for the breadcrumb. */
  ancestors: SubbasinRef[];
  children: SubbasinRef[];
  riverRefs: NamedRef[];
};

/** A node of the sub-basin tree served by /api/subbasins, in hierarchy order. */
export type SubbasinTreeNode = SubbasinRef &
  Pick<Subbasin, "level" | "parentId" | "childIds" | "areaKm2">;

/**
 * A search result: a named river (id = slug), an IGN stream (id = stream id, bbox = all
 * its reaches; `subbasin` tells same-name streams apart) or a typed HYRIV_ID.
 */
export type SearchHit =
  | { kind: "river"; id: string; name: string }
  | {
      kind: "stream";
      id: string;
      name: string;
      bbox: Bbox;
      subbasin: SubbasinRef | null;
    }
  /** A typed HYRIV_ID; name is its IGN name or its river's, null for neither. */
  | { kind: "reachId"; id: string; name: string | null; bbox: Bbox };

const rivers = async () => (await getDb()).collection<RiverDoc>("rivers");
const streams = async () => (await getDb()).collection<StreamDoc>("streams");
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
export async function subbasinRefs(
  ids: string[],
): Promise<SubbasinRef[]> {
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

export async function getStream(id: string): Promise<StreamResponse | null> {
  const doc = await (await streams()).findOne(
    { _id: id },
    { projection: { searchTerms: 0 } },
  );
  if (!doc) return null;
  const [[subbasinRef], [receivingRiverRef]] = await Promise.all([
    subbasinRefs(doc.subbasin ? [doc.subbasin] : []),
    namedRivers(doc.receivingRiver ? [doc.receivingRiver] : []),
  ]);
  return {
    ...doc,
    subbasinRef: subbasinRef ?? null,
    receivingRiverRef: receivingRiverRef ?? null,
  };
}

export async function getReach(id: number): Promise<ReachResponse | null> {
  const doc = await (await reaches()).findOne({ _id: id });
  if (!doc) return null;
  const [river, stream] = await Promise.all([
    riverName(doc.river),
    doc.stream
      ? (await streams()).findOne(
          { _id: doc.stream },
          { projection: { name: 1 } },
        )
      : null,
  ]);
  return { ...doc, riverName: river, streamName: stream?.name ?? null };
}

export async function getSubbasin(
  id: string,
): Promise<SubbasinResponse | null> {
  const doc = await (await subbasins()).findOne({ _id: id });
  if (!doc) return null;
  const [ancestors, children, riverRefs] = await Promise.all([
    subbasinRefs(doc.path.slice(0, -1)),
    subbasinRefs(doc.childIds),
    namedRivers(doc.rivers),
  ]);
  return {
    ...doc,
    parent: ancestors.at(-1) ?? null,
    ancestors,
    children,
    riverRefs,
  };
}

/** Every sub-basin, without metrics; the seed keeps the pipeline's hierarchy order. */
export async function getSubbasinTree(): Promise<SubbasinTreeNode[]> {
  const docs = await (await subbasins())
    .find(
      {},
      {
        projection: {
          name: 1,
          kind: 1,
          level: 1,
          parentId: 1,
          childIds: 1,
          areaKm2: 1,
        },
      },
    )
    .toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}

/**
 * Rivers and IGN streams with a word starting with the normalized query, longest first.
 * Both collections are asked for the limit, then merged by total length. Each stream hit
 * carries the sub-basin of its mouth, so streams with the same name can be told apart.
 */
export async function searchNames(q: string): Promise<SearchHit[]> {
  // A number is a HydroRIVERS HYRIV_ID: open that reach (names have no digits only).
  if (/^\d+$/.test(q)) {
    const id = parseReachId(q);
    return id === null ? [] : reachIdHit(id);
  }
  const filter = { searchTerms: { $regex: searchPattern(q) } };
  const [riverDocs, streamDocs] = await Promise.all([
    (await rivers())
      .find(filter, { projection: { name: 1, lengthKm: 1 } })
      .sort({ lengthKm: -1 })
      .limit(SEARCH_LIMIT)
      .toArray(),
    (await streams())
      .find(filter, {
        projection: { name: 1, lengthKm: 1, bbox: 1, subbasin: 1 },
      })
      .sort({ lengthKm: -1 })
      .limit(SEARCH_LIMIT)
      .toArray(),
  ]);
  const merged: { lengthKm: number; hit: SearchHit; subbasin?: string | null }[] =
    [
      ...riverDocs.map((d) => ({
        lengthKm: d.lengthKm,
        hit: { kind: "river" as const, id: d._id, name: d.name },
      })),
      ...streamDocs.map((d) => ({
        lengthKm: d.lengthKm,
        subbasin: d.subbasin,
        hit: {
          kind: "stream" as const,
          id: d._id,
          name: d.name,
          bbox: d.bbox,
          subbasin: null,
        },
      })),
    ]
      .sort((a, b) => b.lengthKm - a.lengthKm)
      .slice(0, SEARCH_LIMIT);
  const wanted = [
    ...new Set(merged.flatMap((m) => (m.subbasin ? [m.subbasin] : []))),
  ];
  const refs = new Map((await subbasinRefs(wanted)).map((r) => [r.id, r]));
  return merged.map((m) =>
    m.hit.kind === "stream" && m.subbasin
      ? { ...m.hit, subbasin: refs.get(m.subbasin) ?? null }
      : m.hit,
  );
}

/** Names, links and sizes of every river, sub-basin and stream, for the fuzzy catalog. */
export async function getCatalogDocs(): Promise<CatalogDocs> {
  const [riverDocs, subbasinDocs, streamDocs] = await Promise.all([
    (await rivers())
      .find(
        {},
        {
          projection: {
            name: 1,
            shortName: 1,
            aliases: 1,
            flowsInto: 1,
            lengthKm: 1,
            "mouth.uplandKm2": 1,
          },
        },
      )
      .toArray(),
    (await subbasins())
      .find(
        {},
        { projection: { kind: 1, name: 1, parentId: 1, river: 1, areaKm2: 1 } },
      )
      .toArray(),
    (await streams())
      .find(
        {},
        { projection: { name: 1, lengthKm: 1, bbox: 1, subbasin: 1 } },
      )
      .toArray(),
  ]);
  // The projections above select exactly these fields.
  return {
    rivers: riverDocs as CatalogRiver[],
    subbasins: subbasinDocs as CatalogSubbasin[],
    streams: streamDocs as CatalogStream[],
  };
}

/** One document's value of an ask metric, as stored (never computed). */
export interface MetricDoc {
  id: string;
  name: string | null;
  /** Null when the document has no finite number at the path (rule 2). */
  value: number | null;
  /** The document lists the path in `modeled`. */
  modeled: boolean;
  /** The document's provenance text for the path. */
  provenance: string | null;
}

function valueAt(doc: unknown, path: string): number | null {
  let node: unknown = doc;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "number" && Number.isFinite(node) ? node : null;
}

/**
 * The value at `path` (a dotted document path from lib/ask/metrics.ts) of the rivers or
 * sub-basins `ids`, with its modeled flag and provenance. Unknown ids are left out.
 */
export async function getMetricDocs(
  kind: "river" | "subbasin",
  ids: string[],
  path: string,
): Promise<MetricDoc[]> {
  if (ids.length === 0) return [];
  const projection = { name: 1, modeled: 1, provenance: 1, [path]: 1 };
  const filter = { _id: { $in: ids } };
  const docs =
    kind === "river"
      ? await (await rivers()).find(filter, { projection }).toArray()
      : await (await subbasins()).find(filter, { projection }).toArray();
  return docs.map((doc) => ({
    id: doc._id,
    name: doc.name ?? null,
    value: valueAt(doc, path),
    modeled: Array.isArray(doc.modeled) && doc.modeled.includes(path),
    provenance: doc.provenance?.[path] ?? null,
  }));
}

export type CatalogRiver = Pick<
  River,
  "_id" | "name" | "shortName" | "aliases" | "flowsInto" | "lengthKm"
> & { mouth: Pick<River["mouth"], "uplandKm2"> };
export type CatalogSubbasin = Pick<
  Subbasin,
  "_id" | "kind" | "name" | "parentId" | "river" | "areaKm2"
>;
export type CatalogStream = Pick<
  Stream,
  "_id" | "name" | "lengthKm" | "bbox" | "subbasin"
>;
export interface CatalogDocs {
  rivers: CatalogRiver[];
  subbasins: CatalogSubbasin[];
  streams: CatalogStream[];
}

async function reachIdHit(id: number): Promise<SearchHit[]> {
  const doc = await (await reaches()).findOne(
    { _id: id },
    { projection: { river: 1, ign: 1, bbox: 1 } },
  );
  if (!doc) return [];
  const [river] = doc.river ? await namedRivers([doc.river]) : [];
  return [
    {
      kind: "reachId",
      id: String(id),
      name: doc.ign?.name ?? river?.name ?? null,
      bbox: doc.bbox,
    },
  ];
}
