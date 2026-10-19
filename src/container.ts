/**
 * Composition root — the ONLY place that wires adapters to use cases.
 *
 * Rules:
 *   - This file may import infrastructure (it is the wiring point).
 *   - No other file outside infrastructure/ may import infrastructure directly.
 *   - Use cases and route handlers receive their dependencies through this module.
 *   - The container is a plain object, not a class or DI framework.
 *
 * ARCHITECTURE.md §3: "container.ts is the only allowed bridge."
 * ADR-0001: hexagonal architecture with enforced boundaries.
 */

import { config } from "./infrastructure/config/env.js";
import { logger, childLogger } from "./infrastructure/logging/logger.js";
import { SystemClock } from "./infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "./infrastructure/clock/crypto-id-generator.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { PostgresUnitOfWork } from "./infrastructure/db/unit-of-work.js";
import { PostgresLedgerRepo } from "./infrastructure/db/repositories/postgres-ledger-repo.js";
import { AppendLedgerEvent } from "./application/usecases/append-ledger-event.js";
import { VerifyLedger } from "./application/usecases/verify-ledger.js";
import type { UnitOfWork } from "./application/ports/unit-of-work.js";
import type { LedgerRepo } from "./application/ports/ledger-repo.js";

// ─── Singleton adapters ───────────────────────────────────────────────────────

const clock = new SystemClock();
const idGenerator = new CryptoIdGenerator();

let dbClientInstance: ReturnType<typeof createDatabaseClient> | undefined;

function getDbClient() {
  if (!dbClientInstance && config.DATABASE_URL) {
    dbClientInstance = createDatabaseClient({ connectionString: config.DATABASE_URL });
  }
  return dbClientInstance;
}

function getUnitOfWork(): UnitOfWork {
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; UnitOfWork cannot be initialized");
  }
  return new PostgresUnitOfWork(client.db);
}

function getLedgerRepo(): LedgerRepo {
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; LedgerRepo cannot be initialized");
  }
  return new PostgresLedgerRepo(client.db);
}

// ─── Container ────────────────────────────────────────────────────────────────

/**
 * The application container. Import from here in route handlers and use cases.
 * Never construct adapters anywhere else.
 */
export const container = {
  config,
  logger,
  childLogger,
  clock,
  idGenerator,
  getDbClient,
  getUnitOfWork,
  getLedgerRepo,
  getAppendLedgerEvent: (uow?: UnitOfWork) =>
    new AppendLedgerEvent(clock, idGenerator, uow ?? getUnitOfWork()),
  getVerifyLedger: (repo?: LedgerRepo) => new VerifyLedger(repo ?? getLedgerRepo()),
} as const;

export type Container = typeof container;
