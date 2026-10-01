import "server-only";
import { MongoClient, type Db } from "mongodb";
import { getServerEnv } from "./env";

// Reuse one connected client per server instance (and across dev hot reloads),
// so serverless invocations don't open a new connection pool each time.
// The cached value is the connect promise, so concurrent callers share one
// attempt. A failed connect is dropped from the cache: the driver keeps the
// closed topology on the client after a failed connect (mongodb 7.x), so
// reusing that client would fail every later operation with
// MongoTopologyClosedError.
const globalForMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

async function connect(): Promise<MongoClient> {
  let client: MongoClient | undefined;
  try {
    client = new MongoClient(getServerEnv().MONGODB_URI, {
      serverSelectionTimeoutMS: 5_000,
    });
    return await client.connect();
  } catch (error) {
    globalForMongo._mongoClientPromise = undefined;
    await client?.close().catch(() => {});
    throw error;
  }
}

export function getMongoClient(): Promise<MongoClient> {
  globalForMongo._mongoClientPromise ??= connect();
  return globalForMongo._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  return (await getMongoClient()).db(getServerEnv().MONGODB_DB);
}
