/**
 * Postgres implementation of LedgerRepo port.
 *
 * Implements persistent append-only storage and correlation-level locking.
 * ARCHITECTURE.md §8, §12
 */

import { eq, desc, asc, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { ledgerEvents } from "../schema/ledger-events.js";
import type {
  LedgerEvent,
  ChainHead,
  LedgerEventType,
  LedgerActor,
} from "../../../domain/ledger/index.js";
import type { Timestamp } from "../../../domain/shared/clock.js";
import type { LedgerRepo } from "../../../application/ports/ledger-repo.js";

function normalizeTimestamp(val: string): Timestamp {
  if (val.includes("T") && val.endsWith("Z")) {
    return val as Timestamp;
  }
  return new Date(val).toISOString() as Timestamp;
}

export class PostgresLedgerRepo implements LedgerRepo {
  constructor(private readonly db: Database) {}

  async lockCorrelation(correlationId: string): Promise<void> {
    // Acquire a transaction-scoped advisory lock on 64-bit hashtextextended(correlation_id)
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${correlationId}, 0));`,
    );
  }

  async getHead(correlationId: string): Promise<ChainHead | null> {
    const rows = await this.db
      .select({
        seq: ledgerEvents.seq,
        hash: ledgerEvents.hash,
      })
      .from(ledgerEvents)
      .where(eq(ledgerEvents.correlationId, correlationId))
      .orderBy(desc(ledgerEvents.seq))
      .limit(1);

    const first = rows[0];
    if (!first) {
      return null;
    }

    return {
      seq: Number(first.seq),
      hash: first.hash,
    };
  }

  async append(event: LedgerEvent): Promise<void> {
    await this.db.insert(ledgerEvents).values({
      correlationId: event.correlationId,
      seq: event.seq,
      id: event.id,
      type: event.type,
      actorType: event.actor.type,
      actorId: event.actor.id,
      payload: event.payload,
      prevHash: event.prevHash,
      hash: event.hash,
      createdAt: event.createdAt,
    });
  }

  async getEvents(correlationId: string): Promise<readonly LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(eq(ledgerEvents.correlationId, correlationId))
      .orderBy(asc(ledgerEvents.seq));

    return rows.map((row) => ({
      seq: Number(row.seq),
      id: row.id,
      correlationId: row.correlationId,
      type: row.type as LedgerEventType,
      actor: {
        type: row.actorType as LedgerActor["type"],
        id: row.actorId,
      },
      payload: row.payload as Record<string, unknown>,
      prevHash: row.prevHash,
      hash: row.hash,
      createdAt: normalizeTimestamp(row.createdAt),
    }));
  }

  async getAllHeads(): Promise<ReadonlyArray<{ correlationId: string; headHash: string }>> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT ON (correlation_id) correlation_id, hash
      FROM ledger_events
      ORDER BY correlation_id, seq DESC;
    `);

    const rows = result as unknown as Array<{ correlation_id: string; hash: string }>;
    return rows.map((r) => ({
      correlationId: r.correlation_id,
      headHash: r.hash,
    }));
  }
}
