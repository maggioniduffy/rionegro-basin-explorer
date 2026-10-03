/**
 * atlas:check — confirm the app's MongoDB user is read-only (Phase 8).
 *
 * Connects with MONGODB_URI (the URI the deployed app uses; pass the Vercel value) and
 * asks the server for the user's privileges (`connectionStatus` with
 * `showPrivileges`). Fails if any granted action can change data, indexes or users, or
 * if the app's collections cannot be read. Reads only; never writes. Prints a short
 * verdict, never the URI or the password.
 *
 *   npm run atlas:check
 *   MONGODB_URI='<the Vercel value>' npm run atlas:check   # shell env wins over .env.local
 */
import { MongoClient } from "mongodb";
import { z } from "zod";

/** Read actions the app needs (lib/data/queries.ts: find, aggregate, ping). */
const READ_ACTIONS = new Set([
  "find",
  "listCollections",
  "listIndexes",
  "collStats",
  "dbStats",
  "dbHash",
  "killCursors",
  "listSearchIndexes",
  "planCacheRead",
  "changeStream",
  // Atlas's "Only read any database" role (readAnyDatabase) adds this cluster action.
  "listDatabases",
]);
const APP_COLLECTIONS = ["rivers", "reaches", "subbasins", "ignNames"];

const env = z
  .object({
    MONGODB_URI: z.string().startsWith("mongodb"),
    MONGODB_DB: z.string().min(1),
  })
  .parse(process.env);

type Privilege = {
  resource: { db?: string; collection?: string; cluster?: boolean };
  actions: string[];
};
type ConnectionStatus = {
  authInfo: {
    authenticatedUsers: { user: string; db: string }[];
    authenticatedUserRoles: { role: string; db: string }[];
    authenticatedUserPrivileges?: Privilege[];
  };
};

async function main() {
  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const db = client.db(env.MONGODB_DB);
    const status = (await db.command({
      connectionStatus: 1,
      showPrivileges: true,
    })) as unknown as ConnectionStatus;
    const { authenticatedUsers, authenticatedUserRoles } = status.authInfo;
    const privileges = status.authInfo.authenticatedUserPrivileges ?? [];

    // Any action outside the read list, on any resource, counts as write access.
    const writes = new Map<string, Set<string>>();
    for (const p of privileges) {
      const where = p.resource.cluster
        ? "cluster"
        : `${p.resource.db || "*"}.${p.resource.collection || "*"}`;
      for (const a of p.actions) {
        if (READ_ACTIONS.has(a)) continue;
        if (!writes.has(where)) writes.set(where, new Set());
        writes.get(where)!.add(a);
      }
    }

    const readable: Record<string, boolean> = {};
    for (const name of APP_COLLECTIONS) {
      readable[name] = await db
        .collection(name)
        .findOne({}, { projection: { _id: 1 } })
        .then((d) => d !== null)
        .catch(() => false);
    }

    const readOnly = privileges.length > 0 && writes.size === 0;
    const canRead = Object.values(readable).every(Boolean);
    console.log(
      JSON.stringify(
        {
          users: authenticatedUsers.map((u) => `${u.user}@${u.db}`),
          roles: authenticatedUserRoles.map((r) => `${r.role}@${r.db}`),
          readOnly,
          // A few actions per resource, enough to name the role to drop.
          writeActions: Object.fromEntries(
            [...writes].map(([k, v]) => [k, [...v].slice(0, 6)]),
          ),
          readable,
          ok: readOnly && canRead,
        },
        null,
        2,
      ),
    );
    if (!readOnly || !canRead) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((e: unknown) => {
  // The driver's message can include the host, never the password.
  console.error("atlas:check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
