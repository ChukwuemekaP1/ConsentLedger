/**
 * Agents table schema.
 *
 * Agents are isolated actors (TB4, I-07) authorized to propose mandates.
 * They hold no signing or payment credentials.
 * ARCHITECTURE.md §12
 */

import { pgTable, uuid, varchar, char, timestamp } from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  apiKeyHash: char("api_key_hash", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
