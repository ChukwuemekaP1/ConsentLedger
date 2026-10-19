/**
 * Mandate validity window check.
 *
 * isWithinValidity: returns true if now is in [notBefore, expiresAt).
 * Used by the Gate (check 2) and in test helpers.
 *
 * ISO-8601 UTC strings (format "YYYY-MM-DDTHH:MM:SS.mmmZ") are lexicographically
 * ordered by time. String comparison is correct and avoids using Date, which
 * is banned in domain code (CODING.md §4, ESLint no-restricted-globals).
 */

import type { Timestamp } from "../shared/clock.js";
import type { CartMandateTerms, IntentMandateTerms, PaymentMandateTerms } from "./types.js";

type HasValidity = {
  readonly validity: { readonly notBefore: string; readonly expiresAt: string };
};

/**
 * Returns true if `now` falls within [notBefore, expiresAt).
 *
 * The window is half-open: notBefore inclusive, expiresAt exclusive.
 *
 * PaymentMandateTerms has no validity window — always returns true.
 */
export function isWithinValidity(
  terms: CartMandateTerms | IntentMandateTerms | PaymentMandateTerms,
  now: Timestamp,
): boolean {
  if (terms.kind === "PAYMENT") {
    // Payment mandates have no validity window — always in-window
    return true;
  }
  const t = terms as HasValidity;
  const { notBefore, expiresAt } = t.validity;
  // ISO-8601 UTC strings are lexicographically ordered by time
  return now >= (notBefore as Timestamp) && now < (expiresAt as Timestamp);
}
