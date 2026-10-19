/**
 * Passkey credentials and WebAuthn challenges table schema.
 *
 * Persists verified WebAuthn credential public keys (SPKI DER base64) and active challenges.
 * ARCHITECTURE.md §12, §13, ADR-0002, ADR-0008.
 */

import { pgTable, uuid, varchar, text, bigint, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { principals } from "./principals.js";

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: uuid("id").primaryKey(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(), // SPKI DER base64 per ADR-0008
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().default([]),
    aaguid: varchar("aaguid", { length: 36 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("passkey_credentials_principal_id_idx").on(table.principalId)],
);

export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey(),
    challenge: text("challenge").notNull().unique(),
    purpose: varchar("purpose", { length: 32 }).notNull(), // 'registration' | 'authentication' | 'consent'
    principalId: uuid("principal_id").references(() => principals.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("webauthn_challenges_challenge_idx").on(table.challenge),
    index("webauthn_challenges_expires_at_idx").on(table.expiresAt),
  ],
);

export type PasskeyCredentialRow = typeof passkeyCredentials.$inferSelect;
export type NewPasskeyCredentialRow = typeof passkeyCredentials.$inferInsert;

export type WebauthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type NewWebauthnChallengeRow = typeof webauthnChallenges.$inferInsert;
