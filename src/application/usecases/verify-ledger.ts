/**
 * VerifyLedger use case.
 *
 * Verifies that the events for a given correlation ID form an unbroken,
 * un-tampered hash chain (I-04).
 *
 * ARCHITECTURE.md §8, §11
 */

import {
  verifyChain,
  type ChainVerificationOk,
  type ChainVerificationErr,
} from "../../domain/ledger/index.js";
import type { Result } from "../../domain/shared/result.js";
import type { LedgerRepo } from "../ports/ledger-repo.js";

export interface VerifyLedgerUseCase {
  verifyCorrelation(
    correlationId: string,
  ): Promise<Result<ChainVerificationOk, ChainVerificationErr>>;
}

export class VerifyLedger implements VerifyLedgerUseCase {
  constructor(private readonly ledgerRepo: LedgerRepo) {}

  async verifyCorrelation(
    correlationId: string,
  ): Promise<Result<ChainVerificationOk, ChainVerificationErr>> {
    const events = await this.ledgerRepo.getEvents(correlationId);
    return verifyChain(events);
  }
}
