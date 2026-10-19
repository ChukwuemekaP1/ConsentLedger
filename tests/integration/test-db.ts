/**
 * Integration test database harness.
 *
 * Connects to the database specified by DATABASE_URL, ensures migrations are applied,
 * and provides test factories with deterministic test IDs.
 *
 * NOTE: The immutability trigger blocks DELETE and TRUNCATE on ledger_events.
 * Tests isolate by using distinct, unique correlation IDs.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDatabaseClient, type Database } from "../../src/infrastructure/db/client.js";
import { runMigrations } from "../../src/infrastructure/db/migrate.js";
import { PostgresUnitOfWork } from "../../src/infrastructure/db/unit-of-work.js";
import { PostgresLedgerRepo } from "../../src/infrastructure/db/repositories/postgres-ledger-repo.js";
import { principals, agents, mandates } from "../../src/infrastructure/db/schema/index.js";

export function getTestDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"] || process.env["DATABASE_ADMIN_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL or DATABASE_ADMIN_URL must be set to run integration tests.\n" +
        "Specify a valid Postgres connection string in .env.local.",
    );
  }
  return url;
}

let migrationsApplied = false;

export async function setupTestDb(): Promise<{
  readonly db: Database;
  readonly uow: PostgresUnitOfWork;
  readonly ledgerRepo: PostgresLedgerRepo;
  readonly close: () => Promise<void>;
}> {
  const connectionString = getTestDatabaseUrl();

  // Apply migrations once per test run
  if (!migrationsApplied) {
    await runMigrations(connectionString);
    migrationsApplied = true;
  }

  const client = createDatabaseClient({ connectionString, max: 15 });
  const uow = new PostgresUnitOfWork(client.db);
  const ledgerRepo = new PostgresLedgerRepo(client.db);

  return {
    db: client.db,
    uow,
    ledgerRepo,
    close: client.close,
  };
}

export async function createTestPrincipalAndAgent(db: Database): Promise<{
  readonly principalId: string;
  readonly agentId: string;
}> {
  const principalId = randomUUID();
  const agentId = randomUUID();
  const now = new Date().toISOString();

  await db.insert(principals).values({
    id: principalId,
    displayName: `Test Principal ${principalId.slice(0, 8)}`,
    createdAt: now,
  });

  const apiKeyHash = "0".repeat(56) + agentId.replace(/-/g, "").slice(0, 8);
  await db.insert(agents).values({
    id: agentId,
    name: `Test Agent ${agentId.slice(0, 8)}`,
    kind: "builtin-gemini",
    apiKeyHash,
    createdAt: now,
  });

  return { principalId, agentId };
}

export async function createTestMandate(
  db: Database,
  opts: {
    readonly id?: string;
    readonly kind?: "CART" | "INTENT";
    readonly correlationId: string;
    readonly principalId: string;
    readonly agentId: string;
  },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const now = new Date().toISOString();
  const hash = "a".repeat(56) + id.replace(/-/g, "").slice(0, 8);

  await db.insert(mandates).values({
    id,
    kind: opts.kind ?? "CART",
    correlationId: opts.correlationId,
    principalId: opts.principalId,
    agentId: opts.agentId,
    terms: { id, v: 1 },
    hash,
    status: "SIGNED",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    createdAt: now,
  });

  return id;
}
