/**
 * Postgres implementation of UnitOfWork.
 *
 * Runs operations within an explicit database transaction (I-04).
 * ARCHITECTURE.md §6, §8
 */

import type { Database } from "./client.js";
import type { UnitOfWork, TxContext } from "../../application/ports/unit-of-work.js";
import { PostgresLedgerRepo } from "./repositories/postgres-ledger-repo.js";
import { PostgresMandateRepo } from "./repositories/postgres-mandate-repo.js";
import { PostgresPaymentMandateRepo } from "./repositories/postgres-payment-mandate-repo.js";
import { PostgresWebhookRepo } from "./repositories/postgres-webhook-repo.js";

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const txContext: TxContext = {
        ledger: new PostgresLedgerRepo(txDb),
        mandates: new PostgresMandateRepo(txDb),
        paymentMandates: new PostgresPaymentMandateRepo(txDb),
        webhooks: new PostgresWebhookRepo(txDb),
      };
      return fn(txContext);
    });
  }
}
