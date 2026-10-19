/**
 * Postgres implementation of UnitOfWork.
 *
 * Runs operations within an explicit database transaction (I-04).
 * ARCHITECTURE.md §6, §8
 */

import type { Database } from "./client.js";
import type { UnitOfWork, TxContext } from "../../application/ports/unit-of-work.js";
import { PostgresLedgerRepo } from "./repositories/postgres-ledger-repo.js";

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txContext: TxContext = {
        ledger: new PostgresLedgerRepo(tx as unknown as Database),
      };
      return fn(txContext);
    });
  }
}
