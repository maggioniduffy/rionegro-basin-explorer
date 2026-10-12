import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { Json } from "@duckdb/node-api";

export type Row = Record<string, Json>;

export interface Db {
  conn: DuckDBConnection;
  /** Run a query and return rows as JSON-safe objects (BIGINT → string, etc.). */
  all(sql: string): Promise<Row[]>;
  close(): void;
}

/** In-memory DuckDB with the spatial extension loaded (downloaded on first use). */
export async function openDb(): Promise<Db> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL spatial; LOAD spatial;");
  return {
    conn,
    async all(sql) {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjectsJson() as Row[];
    },
    close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}

/** Quote a string as a SQL literal. */
export const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** DuckDB memory cap when PIPELINE_MEMORY_LIMIT is unset. Below the 7 GB of the dev laptop. */
export const DEFAULT_MEMORY_LIMIT = "4GB";

/**
 * Memory cap for the heavy steps: PIPELINE_MEMORY_LIMIT (e.g. "12GB" on a larger cloud machine),
 * else DEFAULT_MEMORY_LIMIT. Past the cap DuckDB spills to temp_directory instead of the process
 * being killed. A malformed value throws rather than being passed into SQL.
 */
export function memoryLimit(
  env: Record<string, string | undefined> = process.env,
): string {
  const v = env.PIPELINE_MEMORY_LIMIT?.trim();
  if (!v) return DEFAULT_MEMORY_LIMIT;
  if (!/^\d+(\.\d+)?\s*[KMGT]i?B$/i.test(v))
    throw new Error(
      `PIPELINE_MEMORY_LIMIT must look like "4GB" or "512MiB", got "${v}"`,
    );
  return v;
}

/** Bound memory and threads of a heavy step and spill to `tempDir`. */
export const limitResources = (db: Db, tempDir: string) =>
  db.conn.run(
    `SET memory_limit=${lit(memoryLimit())}; SET threads=4; SET temp_directory=${lit(tempDir)}`,
  );
