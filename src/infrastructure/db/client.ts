/**
 * Database client and connection pool.
 *
 * Configures the postgres.js connection pool and Drizzle ORM instance.
 * ARCHITECTURE.md §12, §17
 */

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbClientConfig {
  readonly connectionString: string;
  readonly max?: number;
  readonly statementTimeoutMs?: number;
}

export function createDatabaseClient(cfg: DbClientConfig): {
  readonly db: Database;
  readonly sql: postgres.Sql;
  readonly close: () => Promise<void>;
} {
  const sql = postgres(cfg.connectionString, {
    max: cfg.max ?? 10,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // Statement timeout to prevent runaway queries
    connection: {
      statement_timeout: cfg.statementTimeoutMs ?? 5000,
    },
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
