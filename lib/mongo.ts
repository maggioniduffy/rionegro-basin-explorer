import "server-only";
import { MongoClient, type Db } from "mongodb";
import { getServerEnv } from "./env";

// Reuse one client per server instance (and across dev hot reloads),
// so serverless invocations don't open a new connection pool each time.
const globalForMongo = globalThis as typeof globalThis & {
  _mongoClient?: MongoClient;
};

export function getMongoClient(): MongoClient {
  globalForMongo._mongoClient ??= new MongoClient(getServerEnv().MONGODB_URI, {
    serverSelectionTimeoutMS: 5_000,
  });
  return globalForMongo._mongoClient;
}

export function getDb(): Db {
  return getMongoClient().db(getServerEnv().MONGODB_DB);
}
