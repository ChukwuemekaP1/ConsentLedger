/**
 * AI Proposal port.
 *
 * Defines the proposal schema, validation, and the narrow AI-provider interface.
 * The agent can only discover and propose; it holds no authority to approve, sign, or settle (I-07, ADR-0004).
 *
 * ARCHITECTURE.md §14, INVARIANTS I-07, I-10, I-11.
 */

import { z } from "zod";
import type { Result } from "../../domain/shared/result.js";
import type { Currency } from "../../domain/money/currency.js";
import type { ProductCatalog } from "./catalog-port.js";

// ─── Proposal Schemas ─────────────────────────────────────────────────────────

export const ProposedCartItemSchema = z
  .object({
    sku: z.string().min(1, "SKU is required"),
    description: z.string().min(1, "Description is required"),
    quantity: z.number().int().positive("Quantity must be a positive integer"),
    unitAmountMinor: z
      .number()
      .int()
      .nonnegative("Unit amount must be non-negative integer minor units"),
  })
  .strict();

export type ProposedCartItem = z.infer<typeof ProposedCartItemSchema>;

export const PurchaseProposalSchema = z
  .object({
    payee: z
      .object({
        merchantId: z.string().min(1, "Merchant ID is required"),
        displayName: z.string().min(1, "Merchant display name is required"),
      })
      .strict(),
    payment: z
      .object({
        amountMinor: z.number().int().positive("Payment amount must be a positive integer"),
        currency: z.enum(["USD", "EUR", "GBP", "JPY"]),
      })
      .strict(),
    items: z.array(ProposedCartItemSchema).min(1, "At least one item is required in proposal"),
    promptPlayback: z.string().min(1, "Prompt playback is required"),
    rationale: z.string().min(1, "Rationale is required"),
  })
  .strict()
  .refine(
    (data) => {
      const calculatedTotal = data.items.reduce(
        (sum, item) => sum + item.quantity * item.unitAmountMinor,
        0,
      );
      return calculatedTotal === data.payment.amountMinor;
    },
    {
      message: "Sum of item amounts (quantity * unitAmountMinor) must equal payment.amountMinor",
      path: ["payment", "amountMinor"],
    },
  );

export type PurchaseProposal = z.infer<typeof PurchaseProposalSchema>;

// ─── LLM Error & Client Interface ───────────────────────────────────────────

export type LlmErrorKind =
  "MALFORMED_OUTPUT" | "RATE_LIMITED" | "PROVIDER_ERROR" | "MAX_STEPS_EXCEEDED" | "NO_PROPOSAL";

export interface LlmError {
  readonly kind: LlmErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: unknown;
}

export interface GenerateProposalOptions {
  readonly model?: string;
}

export interface LlmClient {
  generateProposal(
    prompt: string,
    catalog: ProductCatalog,
    options?: GenerateProposalOptions,
  ): Promise<Result<PurchaseProposal, LlmError>>;
}
