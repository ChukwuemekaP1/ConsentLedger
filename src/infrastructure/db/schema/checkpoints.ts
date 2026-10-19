/**
 * Ledger checkpoints table schema.
 *
 * Periodic signed Merkle roots over all active chain heads (I-04, ADR-0003).
 * Append-only; protected by database immutability triggers.
 * ARCHITECTURE.md §8.2, §12
 */

import { pgTable, uuid, integer, char, text, timestamp, index } from "drizzle-orm/pg-core";

export const ledgerCheckpoints = pgTable(
  "ledger_checkpoints",
  {
    id: uuid("id").primaryKey(),
    size: integer("size").notNull(),
    root: char("root", { length: 64 }).notNull(),
    signature: text("signature").notNull(),
    keyId: char("key_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("ledger_checkpoints_created_at_idx").on(table.createdAt)],
);

export type LedgerCheckpointRow = typeof ledgerCheckpoints.$inferSelect;
export type NewLedgerCheckpointRow = typeof ledgerCheckpoints.$inferInsert;
