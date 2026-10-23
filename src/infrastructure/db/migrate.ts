/**
 * Programmatic migration runner.
 *
 * Applies Drizzle migrations from src/infrastructure/db/migrations to a target Postgres instance.
 * ARCHITECTURE.md §12
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { installResilientDns } from "../config/dns.js";

export async function runMigrations(
  connectionString: string,
  migrationsFolder?: string,
): Promise<void> {
  installResilientDns();
  const sql = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(sql);
  const targetFolder = migrationsFolder ?? path.resolve(import.meta.dirname, "./migrations");

  try {
    await migrate(db, { migrationsFolder: targetFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
