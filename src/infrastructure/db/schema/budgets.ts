/**
 * Budgets table schema.
 *
 * Enforces atomic reservation and spending limits for Intent mandates (I-03).
 * ARCHITECTURE.md §7, §12
 */

import { pgTable, uuid, bigint, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mandates } from "./mandates.js";

export const budgets = pgTable(
  "budgets",
  {
    mandateId: uuid("mandate_id")
      .primaryKey()
      .references(() => mandates.id, { onDelete: "restrict" }),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    spentMinor: bigint("spent_minor", { mode: "number" }).notNull().default(0),
    reservedMinor: bigint("reserved_minor", { mode: "number" }).notNull().default(0),
    txCount: integer("tx_count").notNull().default(0),
    maxTransactions: integer("max_transactions").notNull(),
    perTxMaxMinor: bigint("per_tx_max_minor", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    check("budget_total_non_negative", sql`${table.totalMinor} >= 0`),
    check("budget_spent_non_negative", sql`${table.spentMinor} >= 0`),
    check("budget_reserved_non_negative", sql`${table.reservedMinor} >= 0`),
    check(
      "budget_limit_check",
      sql`${table.spentMinor} + ${table.reservedMinor} <= ${table.totalMinor}`,
    ),
  ],
);

export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudgetRow = typeof budgets.$inferInsert;
