/**
 * Mandate consents table schema.
 *
 * Persists verbatim passkey assertion artifacts (authenticatorData, clientDataJSON, signature)
 * bound to an approved mandate.
 * ARCHITECTURE.md §4.2, §12, ADR-0002, INVARIANT I-05.
 */

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { mandates } from "./mandates.js";
import { passkeyCredentials } from "./passkeys.js";

export const mandateConsents = pgTable(
  "mandate_consents",
  {
    id: uuid("id").primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .unique()
      .references(() => mandates.id, { onDelete: "restrict" }),
    credentialId: text("credential_id")
      .notNull()
      .references(() => passkeyCredentials.credentialId, { onDelete: "restrict" }),
    authenticatorData: text("authenticator_data").notNull(),
    clientDataJson: text("client_data_json").notNull(),
    signature: text("signature").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("mandate_consents_credential_id_idx").on(table.credentialId)],
);

export type MandateConsentRow = typeof mandateConsents.$inferSelect;
export type NewMandateConsentRow = typeof mandateConsents.$inferInsert;
