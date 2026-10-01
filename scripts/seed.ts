/**
 * npm run seed — load data/out/rivers.ndjson, reaches.ndjson and subbasins.ndjson into Mongo.
 *
 * Idempotent: whole-document upserts keyed on _id, documents no longer in the files
 * are deleted, indexes are created only if missing. Re-run after the pipeline changes
 * data/out/. Needs MONGODB_URI (a user with write access) and MONGODB_DB, read from
 * .env.local. Writes data/work/seed/report.json.
 *
 * Indexes:
 *   rivers   _id is the slug (unique by definition); text index on name/shortName;
 *            searchTerms (normalized names) for prefix search
 *   reaches  river (reaches of a named river)
 *   subbasins _id is the slug; parentId (children of a sub-basin)
 */
import { readFile } from "node:fs/promises";
import {
  MongoClient,
  type Collection,
  type Document,
  type Filter,
} from "mongodb";
import { z } from "zod";
import { reachSchema, riverSchema, subbasinSchema } from "../lib/data/schemas";
import { OUT_DIR } from "../pipeline/lib/paths";
import { writeReport } from "../pipeline/lib/report";
import { chunk, parseNdjson, toRiverDoc, upsertOps } from "./seed-lib";

const BATCH = 1000;

const env = z
  .object({
    MONGODB_URI: z.string().startsWith("mongodb"),
    MONGODB_DB: z.string().min(1),
  })
  .parse(process.env);

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

  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const db = client.db(env.MONGODB_DB);
    const riversColl = db.collection<(typeof rivers)[number]>("rivers");
    const reachesColl = db.collection<(typeof reaches)[number]>("reaches");
    const subbasinsColl =
      db.collection<(typeof subbasins)[number]>("subbasins");

    const riverResult = await sync(riversColl, rivers);
    const reachResult = await sync(reachesColl, reaches);
    const subbasinResult = await sync(subbasinsColl, subbasins);

    await riversColl.createIndex(
      { name: "text", shortName: "text" },
      { name: "names_text", default_language: "none" },
    );
    await riversColl.createIndex({ searchTerms: 1 }, { name: "searchTerms" });
    await reachesColl.createIndex({ river: 1 }, { name: "river" });
    await subbasinsColl.createIndex({ parentId: 1 }, { name: "parentId" });

    const checks = {
      riversCountMatchesFile: riverResult.count === rivers.length,
      reachesCountMatchesFile: reachResult.count === reaches.length,
      everyNamedReachRiverExists: reaches.every(
        (r) => r.river === null || rivers.some((v) => v._id === r.river),
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
    };
    await writeReport("seed", {
      ok: Object.values(checks).every(Boolean),
      checks,
      db: env.MONGODB_DB,
      rivers: riverResult,
      reaches: reachResult,
      subbasins: subbasinResult,
      indexes: {
        rivers: (await riversColl.indexes()).map((i) => i.name),
        reaches: (await reachesColl.indexes()).map((i) => i.name),
        subbasins: (await subbasinsColl.indexes()).map((i) => i.name),
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
