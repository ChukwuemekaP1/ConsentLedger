/**
 * AppendLedgerEvent use case.
 *
 * Persists an event to the append-only ledger while maintaining the cryptographic
 * hash-chain (I-04). Concurrency-safe: takes a transaction-scoped advisory lock
 * per correlation ID to prevent forked chain positions.
 *
 * ARCHITECTURE.md §8, ADR-0003
 */

import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import { type Result, err } from "../../domain/shared/result.js";
import {
  appendToChain,
  type LedgerEvent,
  type LedgerEventDraft,
  type AppendError,
} from "../../domain/ledger/index.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";

export interface AppendLedgerEventUseCase {
  execute(
    draft: LedgerEventDraft,
    txContext?: TxContext,
  ): Promise<Result<LedgerEvent, AppendError>>;
}

export class AppendLedgerEvent implements AppendLedgerEventUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    draft: LedgerEventDraft,
    txContext?: TxContext,
  ): Promise<Result<LedgerEvent, AppendError>> {
    if (txContext) {
      return this.executeWithContext(draft, txContext);
    }

    return this.uow.run(async (tx) => {
      return this.executeWithContext(draft, tx);
    });
  }

  private async executeWithContext(
    draft: LedgerEventDraft,
    tx: TxContext,
  ): Promise<Result<LedgerEvent, AppendError>> {
    // 1. Acquire transaction-scoped advisory lock for this correlation ID
    await tx.ledger.lockCorrelation(draft.correlationId);

    // 2. Read the current chain head for this correlation
    const prevHead = await tx.ledger.getHead(draft.correlationId);

    // 3. Inject deterministic clock and ID values
    const id = this.idGenerator.uuid();
    const now = this.clock.now();

    // 4. Compute next sequence, hashes, and canonical event via pure domain function
    const domainResult = appendToChain(prevHead, draft, id, now);
    if (!domainResult.ok) {
      return err(domainResult.error);
    }

    // 5. Persist the event to the ledger
    await tx.ledger.append(domainResult.value);

    return domainResult;
  }
}
