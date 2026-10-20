/**
 * Unit of Work port.
 *
 * Enforces atomic transactions across repository operations (I-04).
 * Repositories for writes are only accessible within a transactional context.
 * ARCHITECTURE.md §3, §8.2
 */

import type { LedgerRepo } from "./ledger-repo.js";
import type { MandateRepo } from "./mandate-repo.js";
import type { PaymentMandateRepo } from "./payment-mandate-repo.js";
import type { WebhookRepo } from "./webhook-repo.js";

export interface TxContext {
  readonly ledger: LedgerRepo;
  readonly mandates?: MandateRepo;
  readonly paymentMandates?: PaymentMandateRepo;
  readonly webhooks?: WebhookRepo;
}

export interface UnitOfWork {
  /**
   * Execute an operation inside a single database transaction.
   * If the callback resolves, the transaction commits.
   * If the callback rejects, the transaction rolls back completely.
   */
  run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}
