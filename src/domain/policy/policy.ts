/**
 * Policy domain: document schema, evaluation, and hashing.
 *
 * PolicyDocument describes the rules that govern whether a payment is allowed.
 * evaluatePolicy collects ALL applicable reasons (not just the first), so the
 * caller can report the full picture.
 *
 * hashPolicy: same canonical JSON hashing as mandates — used for policy drift detection.
 *
 * ARCHITECTURE.md §5: "Policy drift: a mandate signed under policy-v1 is re-checked
 * against the current policy at execution."
 * INVARIANT: I-11 (fail closed — deny if unknown).
 */

import { z } from "zod";
import { type Result, ok, err } from "../shared/result.js";
import { hashCanonical } from "../crypto/hash.js";
import type { CanonicalError } from "../crypto/canonical.js";
import type { Currency } from "../money/currency.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const PolicyDocumentSchema = z
  .object({
    id: z.string(),
    version: z.number().int().positive(),
    rules: z
      .object({
        /** Maximum amount per transaction (minor units). Undefined = no limit. */
        maxPerTxMinor: z.number().int().positive().optional(),
        /**
         * Maximum total spending per day (minor units).
         * Evaluated only when the context supplies today's spend.
         */
        maxDailyMinor: z.number().int().positive().optional(),
        /** If present, only these merchant IDs are allowed. */
        merchantAllowlist: z.array(z.string()).optional(),
        /** Merchant IDs explicitly denied. Evaluated after allowlist. */
        merchantDenylist: z.array(z.string()).optional(),
        /** If present, only these currencies are allowed. */
        currencyAllowlist: z.array(z.string()).optional(),
        /** Amounts above this require a step-up (human-present cart). */
        stepUpAboveMinor: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

// ─── Evaluation context ───────────────────────────────────────────────────────

export interface PolicyContext {
  /** Amount of this transaction, minor units. */
  readonly amountMinor: number;
  /** Currency of this transaction. */
  readonly currency: Currency;
  /** Merchant ID for this transaction. */
  readonly merchantId: string;
  /**
   * Total spend already made today (minor units).
   * Supply this when maxDailyMinor is set and you have the data.
   * If absent and maxDailyMinor is set, the rule is evaluated as if spent = 0.
   */
  readonly todaySpentMinor?: number;
}

// ─── Reason codes produced by policy evaluation ──────────────────────────────

export type PolicyReasonCode =
  | "POLICY_DENIED"
  | "MERCHANT_NOT_ALLOWED"
  | "CURRENCY_NOT_ALLOWED"
  | "TX_CAP_EXCEEDED"
  | "STEP_UP_REQUIRED";

export interface PolicyEvaluation {
  readonly decision: "ALLOW" | "DENY";
  /** All applicable reason codes, in stable order (alphabetical by code). */
  readonly reasons: readonly PolicyReasonCode[];
}

// ─── evaluatePolicy ───────────────────────────────────────────────────────────

/**
 * Evaluate all policy rules against a context.
 *
 * Collects ALL applicable reasons (not short-circuit). The decision is DENY
 * iff at least one reason is triggered. Order is stable (alphabetical), so
 * two callers producing the same violation set get identical output.
 *
 * INVARIANT I-11: fail closed — an unknown or missing field is never treated as ALLOW.
 */
export function evaluatePolicy(policy: PolicyDocument, context: PolicyContext): PolicyEvaluation {
  const triggered: Set<PolicyReasonCode> = new Set();
  const { rules } = policy;

  // Rule 1: merchant allowlist (deny if not in the list)
  if (rules.merchantAllowlist !== undefined && rules.merchantAllowlist.length > 0) {
    if (!rules.merchantAllowlist.includes(context.merchantId)) {
      triggered.add("MERCHANT_NOT_ALLOWED");
    }
  }

  // Rule 2: merchant denylist (deny if in the list)
  if (rules.merchantDenylist !== undefined) {
    if (rules.merchantDenylist.includes(context.merchantId)) {
      triggered.add("MERCHANT_NOT_ALLOWED");
    }
  }

  // Rule 3: currency allowlist
  if (rules.currencyAllowlist !== undefined && rules.currencyAllowlist.length > 0) {
    if (!rules.currencyAllowlist.includes(context.currency)) {
      triggered.add("CURRENCY_NOT_ALLOWED");
    }
  }

  // Rule 4: max per-tx
  if (rules.maxPerTxMinor !== undefined) {
    if (context.amountMinor > rules.maxPerTxMinor) {
      triggered.add("TX_CAP_EXCEEDED");
    }
  }

  // Rule 5: daily spend cap
  if (rules.maxDailyMinor !== undefined) {
    const alreadySpent = context.todaySpentMinor ?? 0;
    if (alreadySpent + context.amountMinor > rules.maxDailyMinor) {
      triggered.add("POLICY_DENIED");
    }
  }

  // Rule 6: step-up threshold
  if (rules.stepUpAboveMinor !== undefined) {
    if (context.amountMinor > rules.stepUpAboveMinor) {
      triggered.add("STEP_UP_REQUIRED");
    }
  }

  // Stable ordering: sort alphabetically
  const reasons = [...triggered].sort() as PolicyReasonCode[];
  return {
    decision: reasons.length > 0 ? "DENY" : "ALLOW",
    reasons,
  };
}

// ─── hashPolicy ───────────────────────────────────────────────────────────────

/**
 * Hash a policy document using canonical JSON.
 * Used for policy drift detection in the Gate (check 6).
 */
export function hashPolicy(policy: PolicyDocument): Result<string, CanonicalError> {
  return hashCanonical(policy);
}
