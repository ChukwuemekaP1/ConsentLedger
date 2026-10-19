/**
 * Payment mandates table schema.
 *
 * Derived per execution, gateway-signed.
 * ARCHITECTURE.md §4.1, §6, §12
 */

import {
  pgTable,
  uuid,
  integer,
  jsonb,
  char,
  text,
  varchar,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { mandates } from "./mandates.js";

export const paymentMandates = pgTable(
  "payment_mandates",
  {
    id: uuid("id").primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "restrict" }),
    correlationId: uuid("correlation_id").notNull(),
    sequence: integer("sequence").notNull(),
    terms: jsonb("terms").notNull(),
    hash: char("hash", { length: 64 }).notNull().unique(),
    authoritySignature: text("authority_signature").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    requestId: uuid("request_id").notNull().unique(),
    captureRequestId: uuid("capture_request_id").unique(),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    unique("payment_mandates_mandate_seq_idx").on(table.mandateId, table.sequence),
    index("payment_mandates_correlation_id_idx").on(table.correlationId),
  ],
);

export type PaymentMandateRow = typeof paymentMandates.$inferSelect;
export type NewPaymentMandateRow = typeof paymentMandates.$inferInsert;
