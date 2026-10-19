/**
 * Principals table schema.
 *
 * Represents human account owners holding signing authority (passkeys).
 * ARCHITECTURE.md §12
 */

import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const principals = pgTable("principals", {
  id: uuid("id").primaryKey(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export type PrincipalRow = typeof principals.$inferSelect;
export type NewPrincipalRow = typeof principals.$inferInsert;
