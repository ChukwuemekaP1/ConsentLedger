/**
 * Mandate builders: buildCartMandate, buildIntentMandate, derivePaymentMandate.
 *
 * Each builder:
 *   1. Validates inputs with Zod
 *   2. Checks domain validity rules
 *   3. Canonicalises and hashes the terms
 *   4. Returns { terms, hash }
 *
 * The hash is the sole identity of a mandate's content. Attestations are
 * stored beside, never inside, the hashed terms.
 *
 * ARCHITECTURE.md §4.1 — mandate documents.
 * INVARIANTS: I-02 (builder defines the signed terms), I-10 (no floats).
 */

import { type Result, ok, err } from "../shared/result.js";
import { hashCanonical } from "../crypto/hash.js";
import type { CartMandateTerms, IntentMandateTerms, PaymentMandateTerms } from "./types.js";
import { CartMandateTermsSchema, IntentMandateTermsSchema } from "./types.js";
import type { Currency } from "../money/currency.js";
import type { Timestamp, Uuid } from "../shared/clock.js";

// ─── Pure ISO-8601 parser (no Date — banned in domain, CODING.md §4) ─────────

/**
 * Parse an ISO-8601 UTC string to milliseconds since Unix epoch.
 * Supports "YYYY-MM-DDTHH:MM:SS[.mmm]Z" — the only format we produce.
 * Returns null for any unrecognised format.
 *
 * Date is banned by ESLint no-restricted-globals in domain/application code.
 * String comparison works for ordering but not for TTL arithmetic, so we
 * implement our own parser over the fixed format we own.
 */
function parseIsoMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(s);
  if (!m) return null;

  const year = parseInt(m[1] ?? "0", 10);
  const month = parseInt(m[2] ?? "0", 10) - 1; // 0-indexed
  const day = parseInt(m[3] ?? "0", 10);
  const hour = parseInt(m[4] ?? "0", 10);
  const min = parseInt(m[5] ?? "0", 10);
  const sec = parseInt(m[6] ?? "0", 10);
  const ms = m[7] !== undefined ? parseInt(m[7].padEnd(3, "0"), 10) : 0;

  const daysToYear = daysFromEpochToYear(year);
  const daysToMonth = daysFromYearStartToMonth(year, month);
  const totalDays = daysToYear + daysToMonth + (day - 1);
  return totalDays * 86_400_000 + hour * 3_600_000 + min * 60_000 + sec * 1_000 + ms;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysFromEpochToYear(year: number): number {
  let days = 0;
  for (let y = 1970; y < year; y++) {
    days += isLeapYear(y) ? 366 : 365;
  }
  return days;
}

function daysFromYearStartToMonth(year: number, month: number): number {
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  let days = 0;
  for (let m = 0; m < month; m++) {
    const base = DAYS[m] ?? 30;
    days += m === 1 && isLeapYear(year) ? 29 : base;
  }
  return days;
}

// ─── TTL constants ────────────────────────────────────────────────────────────

/** Cart mandate max TTL: 15 minutes in milliseconds (exclusive). */
const CART_MAX_TTL_MS = 15 * 60 * 1000;
/** Intent mandate max TTL: 31 days in milliseconds (exclusive). */
const INTENT_MAX_TTL_MS = 31 * 24 * 60 * 60 * 1000;

// ─── Error types ──────────────────────────────────────────────────────────────

export interface MandateBuildError {
  readonly kind:
    | "SCHEMA_INVALID"
    | "VALIDITY_INVALID"
    | "TTL_EXCEEDED"
    | "ITEM_TOTAL_MISMATCH"
    | "LIMITS_INCOHERENT"
    | "HASH_FAILED";
  readonly message: string;
  readonly details?: unknown;
}

export interface MandateBuilderResult<T> {
  readonly terms: T;
  readonly hash: string;
}

// ─── CartMandateInput ─────────────────────────────────────────────────────────

export interface CartMandateInput {
  readonly id: Uuid;
  readonly correlationId: Uuid;
  readonly principalId: string;
  readonly agent: { readonly id: string; readonly model: string };
  readonly payee: { readonly merchantId: string; readonly displayName: string };
  readonly payment: { readonly amountMinor: number; readonly currency: Currency };
  readonly items: ReadonlyArray<{
    readonly sku: string;
    readonly description: string;
    readonly quantity: number;
    readonly unitAmountMinor: number;
  }>;
  readonly promptPlayback: string;
  readonly policy: { readonly id: string; readonly hash: string };
  readonly validity: { readonly notBefore: Timestamp; readonly expiresAt: Timestamp };
  readonly nonce: string;
}

/**
 * Build and hash a CartMandateTerms.
 *
 * Validity rules (I-02, ARCHITECTURE.md §4.1):
 *   - notBefore < expiresAt
 *   - TTL < 15 minutes
 *   - sum(items[i].quantity * items[i].unitAmountMinor) === payment.amountMinor
 */
export function buildCartMandate(
  input: CartMandateInput,
): Result<MandateBuilderResult<CartMandateTerms>, MandateBuildError> {
  const raw: CartMandateTerms = {
    v: 1,
    kind: "CART",
    id: input.id,
    correlationId: input.correlationId,
    principalId: input.principalId,
    agent: input.agent,
    payee: input.payee,
    payment: input.payment,
    items: input.items.map((i) => ({ ...i })),
    promptPlayback: input.promptPlayback,
    policy: input.policy,
    validity: { notBefore: input.validity.notBefore, expiresAt: input.validity.expiresAt },
    nonce: input.nonce,
  };

  const parsed = CartMandateTermsSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      kind: "SCHEMA_INVALID",
      message: "Cart mandate schema validation failed",
      details: parsed.error,
    });
  }
  const terms = parsed.data;

  const notBeforeMs = parseIsoMs(terms.validity.notBefore);
  const expiresAtMs = parseIsoMs(terms.validity.expiresAt);
  if (notBeforeMs === null || expiresAtMs === null) {
    return err({
      kind: "VALIDITY_INVALID",
      message: "notBefore or expiresAt is not a valid ISO-8601 UTC timestamp",
    });
  }
  if (notBeforeMs >= expiresAtMs) {
    return err({
      kind: "VALIDITY_INVALID",
      message: "notBefore must be strictly before expiresAt",
    });
  }
  const ttl = expiresAtMs - notBeforeMs;
  if (ttl >= CART_MAX_TTL_MS) {
    return err({
      kind: "TTL_EXCEEDED",
      message: `Cart mandate TTL ${ttl}ms must be < 15 minutes (${CART_MAX_TTL_MS}ms)`,
    });
  }

  const itemTotal = terms.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmountMinor,
    0,
  );
  if (itemTotal !== terms.payment.amountMinor) {
    return err({
      kind: "ITEM_TOTAL_MISMATCH",
      message: `Item total ${itemTotal} does not match payment amount ${terms.payment.amountMinor}`,
    });
  }

  const hashResult = hashCanonical(terms);
  if (!hashResult.ok) {
    return err({
      kind: "HASH_FAILED",
      message: "Failed to canonicalize terms",
      details: hashResult.error,
    });
  }

  return ok({ terms, hash: hashResult.value });
}

// ─── IntentMandateInput ───────────────────────────────────────────────────────

export interface IntentMandateInput {
  readonly id: Uuid;
  readonly correlationId: Uuid;
  readonly principalId: string;
  readonly agent: { readonly id: string; readonly model: string };
  readonly scope: {
    readonly merchantIds: readonly string[];
    readonly categories: readonly string[];
    readonly currency: Currency;
  };
  readonly limits: {
    readonly totalBudgetMinor: number;
    readonly perTxMaxMinor: number;
    readonly maxTransactions: number;
    readonly stepUpAboveMinor: number;
  };
  readonly promptPlayback: string;
  readonly policy: { readonly id: string; readonly hash: string };
  readonly validity: { readonly notBefore: Timestamp; readonly expiresAt: Timestamp };
  readonly nonce: string;
}

/**
 * Build and hash an IntentMandateTerms.
 *
 * Validity rules:
 *   - notBefore < expiresAt
 *   - TTL < 31 days
 *   - perTxMaxMinor ≤ totalBudgetMinor
 *   - stepUpAboveMinor ≤ perTxMaxMinor
 *   - maxTransactions ≥ 1 (enforced by Zod schema)
 */
export function buildIntentMandate(
  input: IntentMandateInput,
): Result<MandateBuilderResult<IntentMandateTerms>, MandateBuildError> {
  const raw: IntentMandateTerms = {
    v: 1,
    kind: "INTENT",
    id: input.id,
    correlationId: input.correlationId,
    principalId: input.principalId,
    agent: input.agent,
    scope: {
      merchantIds: [...input.scope.merchantIds],
      categories: [...input.scope.categories],
      currency: input.scope.currency,
    },
    limits: { ...input.limits },
    promptPlayback: input.promptPlayback,
    policy: input.policy,
    validity: { notBefore: input.validity.notBefore, expiresAt: input.validity.expiresAt },
    nonce: input.nonce,
  };

  const parsed = IntentMandateTermsSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      kind: "SCHEMA_INVALID",
      message: "Intent mandate schema validation failed",
      details: parsed.error,
    });
  }
  const terms = parsed.data;

  const notBeforeMs = parseIsoMs(terms.validity.notBefore);
  const expiresAtMs = parseIsoMs(terms.validity.expiresAt);
  if (notBeforeMs === null || expiresAtMs === null) {
    return err({
      kind: "VALIDITY_INVALID",
      message: "notBefore or expiresAt is not a valid ISO-8601 UTC timestamp",
    });
  }
  if (notBeforeMs >= expiresAtMs) {
    return err({
      kind: "VALIDITY_INVALID",
      message: "notBefore must be strictly before expiresAt",
    });
  }
  const ttl = expiresAtMs - notBeforeMs;
  if (ttl >= INTENT_MAX_TTL_MS) {
    return err({
      kind: "TTL_EXCEEDED",
      message: `Intent mandate TTL ${ttl}ms must be < 31 days (${INTENT_MAX_TTL_MS}ms)`,
    });
  }

  const { perTxMaxMinor, totalBudgetMinor, stepUpAboveMinor } = terms.limits;
  if (perTxMaxMinor > totalBudgetMinor) {
    return err({
      kind: "LIMITS_INCOHERENT",
      message: `perTxMaxMinor (${perTxMaxMinor}) must be ≤ totalBudgetMinor (${totalBudgetMinor})`,
    });
  }
  if (stepUpAboveMinor > perTxMaxMinor) {
    return err({
      kind: "LIMITS_INCOHERENT",
      message: `stepUpAboveMinor (${stepUpAboveMinor}) must be ≤ perTxMaxMinor (${perTxMaxMinor})`,
    });
  }

  const hashResult = hashCanonical(terms);
  if (!hashResult.ok) {
    return err({
      kind: "HASH_FAILED",
      message: "Failed to canonicalize terms",
      details: hashResult.error,
    });
  }

  return ok({ terms, hash: hashResult.value });
}

// ─── Payment mandate derivation ───────────────────────────────────────────────

export interface SpendRequest {
  readonly merchantId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
}

export interface DerivationError {
  readonly kind:
    | "TERMS_MISMATCH"
    | "MERCHANT_NOT_ALLOWED"
    | "CURRENCY_NOT_ALLOWED"
    | "BUDGET_EXCEEDED"
    | "STEP_UP_REQUIRED"
    | "HASH_FAILED";
  readonly message: string;
}

/**
 * Derive a PaymentMandateTerms from a parent mandate.
 *
 * For CART: spend must exactly match cart terms. modality = HP.
 * For INTENT: spend must fit scope + limits. modality = HNP.
 */
export function derivePaymentMandate(
  parent: MandateBuilderResult<CartMandateTerms | IntentMandateTerms>,
  spend: SpendRequest,
  sequence: number,
  now: Timestamp,
  id: Uuid,
): Result<MandateBuilderResult<PaymentMandateTerms>, DerivationError> {
  const { terms, hash: parentHash } = parent;

  if (terms.kind === "CART") {
    if (
      spend.amountMinor !== terms.payment.amountMinor ||
      spend.currency !== terms.payment.currency ||
      spend.merchantId !== terms.payee.merchantId
    ) {
      return err({ kind: "TERMS_MISMATCH", message: "Spend does not match cart terms" });
    }

    const paymentTerms: PaymentMandateTerms = {
      v: 1,
      kind: "PAYMENT",
      id,
      correlationId: terms.correlationId,
      parent: { mandateId: terms.id, hash: parentHash, kind: "CART" },
      modality: "HP",
      sequence,
      payee: { merchantId: terms.payee.merchantId },
      payment: { amountMinor: terms.payment.amountMinor, currency: terms.payment.currency },
      agentId: terms.agent.id,
      createdAt: now,
    };

    const hashResult = hashCanonical(paymentTerms);
    if (!hashResult.ok) {
      return err({ kind: "HASH_FAILED", message: "Failed to hash payment terms" });
    }
    return ok({ terms: paymentTerms, hash: hashResult.value });
  } else {
    const { scope, limits } = terms;

    if (!scope.merchantIds.includes(spend.merchantId)) {
      return err({
        kind: "MERCHANT_NOT_ALLOWED",
        message: `Merchant ${spend.merchantId} not in intent scope`,
      });
    }
    if (spend.currency !== scope.currency) {
      return err({
        kind: "CURRENCY_NOT_ALLOWED",
        message: `Currency ${spend.currency} does not match intent scope currency ${scope.currency}`,
      });
    }
    if (spend.amountMinor > limits.perTxMaxMinor) {
      return err({
        kind: "BUDGET_EXCEEDED",
        message: `Amount ${spend.amountMinor} exceeds perTxMaxMinor ${limits.perTxMaxMinor}`,
      });
    }
    if (spend.amountMinor > limits.stepUpAboveMinor) {
      return err({
        kind: "STEP_UP_REQUIRED",
        message: `Amount ${spend.amountMinor} exceeds stepUpAboveMinor ${limits.stepUpAboveMinor}, step-up required`,
      });
    }

    const paymentTerms: PaymentMandateTerms = {
      v: 1,
      kind: "PAYMENT",
      id,
      correlationId: terms.correlationId,
      parent: { mandateId: terms.id, hash: parentHash, kind: "INTENT" },
      modality: "HNP",
      sequence,
      payee: { merchantId: spend.merchantId },
      payment: { amountMinor: spend.amountMinor, currency: spend.currency },
      agentId: terms.agent.id,
      createdAt: now,
    };

    const hashResult = hashCanonical(paymentTerms);
    if (!hashResult.ok) {
      return err({ kind: "HASH_FAILED", message: "Failed to hash payment terms" });
    }
    return ok({ terms: paymentTerms, hash: hashResult.value });
  }
}
