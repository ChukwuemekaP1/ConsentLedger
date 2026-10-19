/**
 * Ledger repository port.
 *
 * Defines persistence operations for the append-only evidence ledger.
 * ARCHITECTURE.md §3, §8
 */

import type { LedgerEvent, ChainHead } from "../../domain/ledger/index.js";

export interface LedgerRepo {
  /**
   * Acquire a transaction-scoped advisory lock for this correlation ID.
   * Serializes appends to the same correlation without blocking other correlations.
   */
  lockCorrelation(correlationId: string): Promise<void>;

  /**
   * Retrieve the current head (latest seq and hash) for this correlation ID.
   * Returns null if no events have been recorded for the correlation yet.
   */
  getHead(correlationId: string): Promise<ChainHead | null>;

  /**
   * Insert a new ledger event into the append-only store.
   */
  append(event: LedgerEvent): Promise<void>;

  /**
   * Retrieve all events for a correlation ID ordered by seq ascending.
   */
  getEvents(correlationId: string): Promise<readonly LedgerEvent[]>;

  /**
   * Retrieve all distinct chain heads across the ledger.
   * Used for building Merkle checkpoint trees.
   */
  getAllHeads(): Promise<ReadonlyArray<{ correlationId: string; headHash: string }>>;
}
