/**
 * In-memory test double for LedgerRepo and UnitOfWork.
 * Used for unit testing application use cases without requiring a real database.
 */

import type { LedgerRepo } from "../../src/application/ports/ledger-repo.js";
import type { UnitOfWork, TxContext } from "../../src/application/ports/unit-of-work.js";
import type { LedgerEvent, ChainHead } from "../../src/domain/ledger/index.js";

export class InMemoryLedgerRepo implements LedgerRepo {
  public readonly events: LedgerEvent[] = [];
  public readonly lockedCorrelations: string[] = [];

  async lockCorrelation(correlationId: string): Promise<void> {
    this.lockedCorrelations.push(correlationId);
  }

  async getHead(correlationId: string): Promise<ChainHead | null> {
    const correlationEvents = this.events.filter((e) => e.correlationId === correlationId);
    if (correlationEvents.length === 0) return null;
    const last = correlationEvents[correlationEvents.length - 1];
    if (!last) return null;
    return { seq: last.seq, hash: last.hash };
  }

  async append(event: LedgerEvent): Promise<void> {
    this.events.push(event);
  }

  async getEvents(correlationId: string): Promise<readonly LedgerEvent[]> {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  async getAllHeads(): Promise<ReadonlyArray<{ correlationId: string; headHash: string }>> {
    const map = new Map<string, string>();
    for (const e of this.events) {
      map.set(e.correlationId, e.hash);
    }
    return Array.from(map.entries()).map(([correlationId, headHash]) => ({
      correlationId,
      headHash,
    }));
  }
}

export class FakeUnitOfWork implements UnitOfWork {
  constructor(public readonly repo: InMemoryLedgerRepo = new InMemoryLedgerRepo()) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({ ledger: this.repo });
  }
}
