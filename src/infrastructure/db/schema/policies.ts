/**
 * Policies table schema.
 *
 * Versioned spending policy documents, content-hashed for drift detection (I-11).
 * ARCHITECTURE.md §5, §12
 */

import {
  pgTable,
  varchar,
  integer,
  jsonb,
  char,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const policies = pgTable(
  "policies",
  {
    id: varchar("id", { length: 64 }).notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    hash: char("hash", { length: 64 }).notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.version] }),
    index("policies_active_idx").on(table.active),
  ],
);

export type PolicyRow = typeof policies.$inferSelect;
export type NewPolicyRow = typeof policies.$inferInsert;
