/**
 * Ledger events table schema.
 *
 * Append-only, tamper-evident hash-chained event store (I-04, ADR-0003).
 * Primary key is (correlation_id, seq).
 * Protected by database immutability triggers against UPDATE, DELETE, and TRUNCATE.
 * ARCHITECTURE.md §8, §12
 */

import {
  pgTable,
  uuid,
  bigint,
  varchar,
  jsonb,
  char,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const ledgerEvents = pgTable(
  "ledger_events",
  {
    correlationId: uuid("correlation_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    id: uuid("id").notNull().unique(),
    type: varchar("type", { length: 64 }).notNull(),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    actorId: varchar("actor_id", { length: 128 }).notNull(),
    payload: jsonb("payload").notNull(),
    prevHash: char("prev_hash", { length: 64 }).notNull(),
    hash: char("hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.correlationId, table.seq] }),
    index("ledger_events_type_idx").on(table.type),
    index("ledger_events_created_at_idx").on(table.createdAt),
  ],
);

export type LedgerEventRow = typeof ledgerEvents.$inferSelect;
export type NewLedgerEventRow = typeof ledgerEvents.$inferInsert;
