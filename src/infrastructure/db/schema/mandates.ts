/**
 * Mandates table schema.
 *
 * Immutable terms (Cart or Intent) and mutable state (status, attestations).
 * Terms are hashed via RFC 8785 canonical JSON.
 * ARCHITECTURE.md §4.1, §12
 */

import { pgTable, uuid, varchar, jsonb, char, timestamp, index } from "drizzle-orm/pg-core";
import { principals } from "./principals.js";
import { agents } from "./agents.js";

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey(),
    kind: varchar("kind", { length: 16 }).notNull(), // 'CART' | 'INTENT'
    correlationId: uuid("correlation_id").notNull(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    terms: jsonb("terms").notNull(),
    hash: char("hash", { length: 64 }).notNull().unique(),
    attestations: jsonb("attestations").notNull().default([]),
    status: varchar("status", { length: 32 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("mandates_correlation_id_idx").on(table.correlationId),
    index("mandates_principal_status_idx").on(table.principalId, table.status),
  ],
);

export type MandateRow = typeof mandates.$inferSelect;
export type NewMandateRow = typeof mandates.$inferInsert;
