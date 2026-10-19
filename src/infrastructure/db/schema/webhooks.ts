/**
 * Webhook deliveries table schema.
 *
 * Stores raw webhook IDs for idempotent processing (I-06).
 * ARCHITECTURE.md §9, §12
 */

import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core";

export const webhookDeliveries = pgTable("webhook_deliveries", {
  paypalEventId: varchar("paypal_event_id", { length: 128 }).primaryKey(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  resourceId: varchar("resource_id", { length: 128 }).notNull(),
  resourceStatus: varchar("resource_status", { length: 64 }),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
});

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
