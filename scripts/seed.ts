/**
 * npm run seed — load rivers.ndjson, reaches.ndjson, subbasins.ndjson and streams.ndjson
 * from data/out/<region>/ into Mongo (`npm run seed -- --region <id>`, default nqn).
 *
 * Idempotent: whole-document upserts keyed on _id, documents no longer in the files
 * are deleted, indexes are created only if missing. Re-run after the pipeline changes
 * data/out/<region>/, into the region's database (regions/index.ts regionDbName). Needs a user
 * with write access and MONGODB_DB (the base name), read from .env.local:
 * MONGODB_SEED_URI, or MONGODB_URI when it is not set. The deployed app's MONGODB_URI
 * is a read-only user (Phase 8), so the seed has its own. Writes
 * data/work/<region>/seed/report.json.
 *
 * The ignNames collection (one document per IGN name, before streams) is dropped if found.
 *
 * Indexes:
 *   rivers   _id is the slug (unique by definition); text index on name/shortName;
 *            searchTerms (normalized names) for prefix search
 *   reaches  river (reaches of a named river)
 *   subbasins _id is the slug; parentId (children of a sub-basin)
 *   streams  _id is the stream id (name slug + mouth reach); searchTerms (normalized name) for
 *            prefix search; subbasin (streams of a sub-basin)
 */
import { readFile } from "node:fs/promises";
import {
  MongoClient,
  type Collection,
  type Document,
  type Filter,
} from "mongodb";
import { z } from "zod";
import {
  reachSchema,
  riverSchema,
  streamSchema,
  subbasinSchema,
} from "../lib/data/schemas";
import { OUT_DIR, REGION_ID } from "../pipeline/lib/paths";
import { regionDbName } from "../regions";
import { writeReport } from "../pipeline/lib/report";
import {
  chunk,
  parseNdjson,
  toRiverDoc,
  toStreamDoc,
  upsertOps,
} from "./seed-lib";

const BATCH = 1000;

const env = z
  .object({
    MONGODB_SEED_URI: z.string().startsWith("mongodb").optional(),
    MONGODB_URI: z.string().startsWith("mongodb").optional(),
    MONGODB_DB: z.string().min(1),
  })
  .parse(process.env);
const DB_NAME = regionDbName(env.MONGODB_DB, REGION_ID);
const seedUri = (() => {
  const uri = env.MONGODB_SEED_URI ?? env.MONGODB_URI;
  if (!uri) throw new Error("set MONGODB_SEED_URI (or MONGODB_URI)");
  return uri;
})();

async function sync<T extends Document & { _id: string | number }>(
  coll: Collection<T>,
  docs: T[],
) {
  const totals = { upserted: 0, modified: 0, matched: 0 };
  for (const batch of chunk(docs, BATCH)) {
    const r = await coll.bulkWrite(upsertOps(batch), { ordered: false });
    totals.upserted += r.upsertedCount;
    totals.modified += r.modifiedCount;
    totals.matched += r.matchedCount;
  }
  const ids = docs.map((d) => d._id);
  const { deletedCount } = await coll.deleteMany({
    _id: { $nin: ids },
  } as Filter<T>);
  const count = await coll.countDocuments();
  return { input: docs.length, ...totals, deleted: deletedCount, count };
}

async function main() {
  const rivers = parseNdjson(
    await readFile(`${OUT_DIR}/rivers.ndjson`, "utf8"),
    riverSchema,
  ).map(toRiverDoc);
  const reaches = parseNdjson(
    await readFile(`${OUT_DIR}/reaches.ndjson`, "utf8"),
    reachSchema,
  );
  const subbasins = parseNdjson(
    await readFile(`${OUT_DIR}/subbasins.ndjson`, "utf8"),
    subbasinSchema,
  );

  const streams = parseNdjson(
    await readFile(`${OUT_DIR}/streams.ndjson`, "utf8"),
    streamSchema,
  ).map(toStreamDoc);

  const client = new MongoClient(seedUri, {
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const db = client.db(DB_NAME);
    const riversColl = db.collection<(typeof rivers)[number]>("rivers");
    const reachesColl = db.collection<(typeof reaches)[number]>("reaches");
    const subbasinsColl =
      db.collection<(typeof subbasins)[number]>("subbasins");

    const streamsColl = db.collection<(typeof streams)[number]>("streams");

    const riverResult = await sync(riversColl, rivers);
    const reachResult = await sync(reachesColl, reaches);
    const subbasinResult = await sync(subbasinsColl, subbasins);
    const streamResult = await sync(streamsColl, streams);
    // ignNames held one document per IGN name before streams replaced it; nothing reads
    // it any more, so drop it once (later runs find nothing to drop).
    const legacyIgnNamesDropped =
      (
        await db
          .listCollections({ name: "ignNames" }, { nameOnly: true })
          .toArray()
      ).length > 0 && (await db.dropCollection("ignNames"));

    await riversColl.createIndex(
      { name: "text", shortName: "text" },
      { name: "names_text", default_language: "none" },
    );
    await riversColl.createIndex({ searchTerms: 1 }, { name: "searchTerms" });
    await streamsColl.createIndex({ searchTerms: 1 }, { name: "searchTerms" });
    await streamsColl.createIndex({ subbasin: 1 }, { name: "subbasin" });
    await reachesColl.createIndex({ stream: 1 }, { name: "stream" });
    await reachesColl.createIndex({ river: 1 }, { name: "river" });
    await subbasinsColl.createIndex({ parentId: 1 }, { name: "parentId" });

    const reachById = new Map(reaches.map((r) => [r._id, r]));
    const reachesPerStream = new Map<string, number>();
    for (const r of reaches)
      if (r.stream !== null)
        reachesPerStream.set(
          r.stream,
          (reachesPerStream.get(r.stream) ?? 0) + 1,
        );
    const streamIds = new Set(streams.map((st) => st._id));
    const subbasinIds = new Set(subbasins.map((b) => b._id));
    const riverIds = new Set(rivers.map((v) => v._id));
    const checks = {
      riversCountMatchesFile: riverResult.count === rivers.length,
      reachesCountMatchesFile: reachResult.count === reaches.length,
      everyNamedReachRiverExists: reaches.every(
        (r) => r.river === null || rivers.some((v) => v._id === r.river),
      ),
      streamsCountMatchesFile: streamResult.count === streams.length,
      // Search opens the stream and the panel links to its mouth: both must resolve, and
      // the mouth reach must belong to the stream.
      everyStreamResolves: streams.every(
        (st) => reachById.get(st.mouthReach)?.stream === st._id,
      ),
      everyStreamReachCountMatches: streams.every(
        (st) => (reachesPerStream.get(st._id) ?? 0) === st.reachCount,
      ),
      everyReachStreamExists: reaches.every(
        (r) => r.stream === null || streamIds.has(r.stream),
      ),
      everyStreamSubbasinExists: streams.every(
        (st) =>
          (st.subbasin === null || subbasinIds.has(st.subbasin)) &&
          (st.receivingRiver === null || riverIds.has(st.receivingRiver)),
      ),
      subbasinsCountMatchesFile: subbasinResult.count === subbasins.length,
      everySubbasinRiverExists: subbasins.every((b) =>
        [...(b.river === null ? [] : [b.river]), ...b.rivers].every((id) =>
          rivers.some((v) => v._id === id),
        ),
      ),
      subbasinLinksResolve: subbasins.every((b) =>
        [...(b.parentId === null ? [] : [b.parentId]), ...b.childIds].every(
          (id) => subbasins.some((o) => o._id === id),
        ),
      ),
      subbasinPathsMatchParents: subbasins.every(
        (b) =>
          b.path.at(-1) === b._id &&
          b.path.length === b.level + 1 &&
          b.path.at(-2) === (b.parentId ?? undefined),
      ),
    };
    await writeReport("seed", {
      ok: Object.values(checks).every(Boolean),
      checks,
      region: REGION_ID,
      db: DB_NAME,
      rivers: riverResult,
      reaches: reachResult,
      subbasins: subbasinResult,
      streams: streamResult,
      legacyIgnNamesDropped,
      indexes: {
        rivers: (await riversColl.indexes()).map((i) => i.name),
        reaches: (await reachesColl.indexes()).map((i) => i.name),
        subbasins: (await subbasinsColl.indexes()).map((i) => i.name),
        streams: (await streamsColl.indexes()).map((i) => i.name),
      },
    });
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  // Driver errors can echo the connection string; print only the message head.
  const message =
    err instanceof Error ? err.message.split("\n")[0] : String(err);
  console.error(`seed failed: ${message}`);
  process.exit(1);
});
