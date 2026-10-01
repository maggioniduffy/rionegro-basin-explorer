import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a react-server bundle; it is only a marker here.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ MONGODB_URI: "mongodb://test", MONGODB_DB: "test" }),
}));

// Each constructed client resolves or rejects connect() per the queue below.
const connectResults: Array<() => Promise<void>> = [];
const instances: FakeClient[] = [];

class FakeClient {
  close = vi.fn(async () => {});
  db = vi.fn((name: string) => ({ name, client: this }));
  connect = vi.fn(async () => {
    const next = connectResults.shift() ?? (async () => {});
    await next();
    return this;
  });
  constructor() {
    instances.push(this);
  }
}

vi.mock("mongodb", () => ({ MongoClient: FakeClient }));

const { getDb, getMongoClient } = await import("@/lib/mongo");

beforeEach(() => {
  delete (globalThis as { _mongoClientPromise?: unknown })._mongoClientPromise;
  connectResults.length = 0;
  instances.length = 0;
});

describe("getMongoClient", () => {
  it("retries with a new client after a failed connect", async () => {
    connectResults.push(async () => {
      throw new Error("server selection timed out");
    });

    await expect(getMongoClient()).rejects.toThrow("timed out");
    expect(instances).toHaveLength(1);
    expect(instances[0]?.close).toHaveBeenCalledOnce();

    const client = await getMongoClient();
    expect(instances).toHaveLength(2);
    expect(client).toBe(instances[1]);
  });

  it("reuses a connected client", async () => {
    const a = await getMongoClient();
    const b = await getMongoClient();
    const db = await getDb();
    expect(a).toBe(b);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.connect).toHaveBeenCalledOnce();
    expect(db).toMatchObject({ name: "test", client: a });
  });

  it("shares one connect between concurrent callers", async () => {
    let release!: () => void;
    connectResults.push(() => new Promise<void>((r) => (release = r)));

    const pending = [getMongoClient(), getMongoClient(), getDb()];
    release();
    const [a, b, db] = await Promise.all(pending);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.connect).toHaveBeenCalledOnce();
    expect(a).toBe(b);
    expect(db).toMatchObject({ client: a });
  });

  it("shares a failed connect, then recovers", async () => {
    connectResults.push(async () => {
      throw new Error("ReplicaSetNoPrimary");
    });

    const results = await Promise.allSettled([getDb(), getDb()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(instances).toHaveLength(1);

    await expect(getDb()).resolves.toMatchObject({ name: "test" });
    expect(instances).toHaveLength(2);
  });
});
