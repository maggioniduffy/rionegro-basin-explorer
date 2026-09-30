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
