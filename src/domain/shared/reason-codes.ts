/**
 * Reason codes — closed list, part of the public API.
 *
 * These are stable identifiers. Adding a code is a normal change.
 * Renaming or removing one is a breaking change (update the API contract).
 *
 * Source of truth: docs/INVARIANTS.md "Reason codes" section.
 * These codes appear in:
 *   - AppError.code
 *   - RFC 9457 problem+json responses (the `code` field)
 *   - LedgerEvent payloads
 *   - Gate denial reasons
 */

export const REASON_CODES = [
  "MANDATE_NOT_FOUND",
  "MANDATE_EXPIRED",
  "MANDATE_REVOKED",
  "MANDATE_STATE_INVALID",
  "HASH_MISMATCH",
  "AUTHORITY_SIGNATURE_INVALID",
  "MERCHANT_SIGNATURE_INVALID",
  "CONSENT_MISSING",
  "CONSENT_INVALID",
  "POLICY_DENIED",
  "POLICY_DRIFT",
  "BUDGET_EXCEEDED",
  "TX_CAP_EXCEEDED",
  "STEP_UP_REQUIRED",
  "REPLAY_DETECTED",
  "MERCHANT_NOT_ALLOWED",
  "CURRENCY_NOT_ALLOWED",
  "TERMS_MISMATCH",
  "WEBHOOK_SIGNATURE_INVALID",
  "WEBHOOK_DUPLICATE",
  "PROVIDER_ERROR",
  "PROVIDER_OUTCOME_UNKNOWN",
  "RECONCILIATION_MISMATCH",
  "INSUFFICIENT_EVIDENCE",
  // Generic HTTP-layer codes (not domain-specific, used in problem+json only)
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL",
] as const;

/** A stable, type-safe reason code. Part of the public API surface. */
export type ReasonCode = (typeof REASON_CODES)[number];

/** Runtime check: is a string a known ReasonCode? */
export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && (REASON_CODES as readonly string[]).includes(value);
}
