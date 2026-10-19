/**
 * Mandate domain types.
 *
 * Three mandate kinds:
 *   CART    — human-present purchase of specific items, TTL ≤ 15 min.
 *   INTENT  — human-not-present recurring budget, TTL ≤ 31 days.
 *   PAYMENT — derived per execution. Carries modality HP or HNP.
 *
 * The hashed terms are canonical JSON. Mutable state (status, counters)
 * is NOT in the hash; it lives beside the terms.
 *
 * ARCHITECTURE.md §4.1
 * ADR-0005: AP2-aligned, not AP2-conformant.
 */

import { z } from "zod";

// ─── Validity window ──────────────────────────────────────────────────────────

const ValiditySchema = z.object({
  notBefore: z.string(),
  expiresAt: z.string(),
});

// ─── CartMandate ──────────────────────────────────────────────────────────────

export const CartItemSchema = z
  .object({
    sku: z.string(),
    description: z.string(),
    quantity: z.number().int().positive(),
    unitAmountMinor: z.number().int().nonnegative(),
  })
  .strict();

export const CartPaymentSchema = z
  .object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.enum(["USD", "EUR", "GBP", "JPY"]),
  })
  .strict();

export const CartMandateTermsSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("CART"),
    id: z.string(),
    correlationId: z.string(),
    principalId: z.string(),
    agent: z.object({ id: z.string(), model: z.string() }).strict(),
    payee: z.object({ merchantId: z.string(), displayName: z.string() }).strict(),
    payment: CartPaymentSchema,
    items: z.array(CartItemSchema).min(1),
    promptPlayback: z.string(),
    policy: z.object({ id: z.string(), hash: z.string() }).strict(),
    validity: ValiditySchema,
    nonce: z.string(),
  })
  .strict();

export type CartMandateTerms = z.infer<typeof CartMandateTermsSchema>;

// ─── IntentMandate ────────────────────────────────────────────────────────────

export const IntentScopeSchema = z
  .object({
    merchantIds: z.array(z.string()),
    categories: z.array(z.string()),
    currency: z.enum(["USD", "EUR", "GBP", "JPY"]),
  })
  .strict();

export const IntentLimitsSchema = z
  .object({
    totalBudgetMinor: z.number().int().positive(),
    perTxMaxMinor: z.number().int().positive(),
    maxTransactions: z.number().int().positive(),
    stepUpAboveMinor: z.number().int().nonnegative(),
  })
  .strict();

export const IntentMandateTermsSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("INTENT"),
    id: z.string(),
    correlationId: z.string(),
    principalId: z.string(),
    agent: z.object({ id: z.string(), model: z.string() }).strict(),
    scope: IntentScopeSchema,
    limits: IntentLimitsSchema,
    promptPlayback: z.string(),
    policy: z.object({ id: z.string(), hash: z.string() }).strict(),
    validity: ValiditySchema,
    nonce: z.string(),
  })
  .strict();

export type IntentMandateTerms = z.infer<typeof IntentMandateTermsSchema>;

// ─── PaymentMandate ───────────────────────────────────────────────────────────

export const PaymentMandateTermsSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("PAYMENT"),
    id: z.string(),
    correlationId: z.string(),
    parent: z
      .object({
        mandateId: z.string(),
        hash: z.string(),
        kind: z.enum(["CART", "INTENT"]),
      })
      .strict(),
    modality: z.enum(["HP", "HNP"]),
    sequence: z.number().int().positive(),
    payee: z.object({ merchantId: z.string() }).strict(),
    payment: CartPaymentSchema,
    agentId: z.string(),
    createdAt: z.string(),
  })
  .strict();

export type PaymentMandateTerms = z.infer<typeof PaymentMandateTermsSchema>;

// ─── Union ────────────────────────────────────────────────────────────────────

export type MandateTerms = CartMandateTerms | IntentMandateTerms | PaymentMandateTerms;
export type MandateKind = "CART" | "INTENT" | "PAYMENT";

// ─── Attestations ─────────────────────────────────────────────────────────────

export type AttestationRole = "AUTHORITY" | "MERCHANT";

export interface Attestation {
  readonly role: AttestationRole;
  readonly keyId: string;
  readonly signature: string;
}

export interface SignedMandate<T extends MandateTerms = MandateTerms> {
  readonly terms: T;
  readonly hash: string;
  readonly attestations: readonly Attestation[];
}
