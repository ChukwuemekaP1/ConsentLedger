/**
 * MinorUnits — branded safe integer representing money in the smallest currency unit.
 *
 * USD $85.00 → 8500 minor units
 * JPY ¥1500  → 1500 minor units
 *
 * Only created through validating constructors. Never a float.
 *
 * I-10: Money is integer minor units. No floats anywhere.
 * CODING.md §1: Branded types for domain primitives.
 */

import type { Brand } from "../shared/brand.js";
import { type Result, ok, err } from "../shared/result.js";

/** Branded safe integer for money values. */
export type MinorUnits = Brand<number, "MinorUnits">;

export interface MinorUnitsError {
  readonly kind: "NOT_AN_INTEGER" | "NEGATIVE" | "UNSAFE_INTEGER" | "NOT_A_NUMBER";
  readonly input: unknown;
}

/**
 * Validate and brand a number as MinorUnits.
 *
 * Rejects:
 *   - Non-numbers (NaN included)
 *   - Floats (non-integers)
 *   - Negative values
 *   - Unsafe integers (> Number.MAX_SAFE_INTEGER)
 */
export function minorUnits(n: number): Result<MinorUnits, MinorUnitsError> {
  if (typeof n !== "number" || Number.isNaN(n)) {
    return err({ kind: "NOT_A_NUMBER", input: n });
  }
  if (!Number.isFinite(n)) {
    return err({ kind: "NOT_A_NUMBER", input: n });
  }
  if (!Number.isInteger(n)) {
    return err({ kind: "NOT_AN_INTEGER", input: n });
  }
  if (n < 0) {
    return err({ kind: "NEGATIVE", input: n });
  }
  if (!Number.isSafeInteger(n)) {
    return err({ kind: "UNSAFE_INTEGER", input: n });
  }
  return ok(n as MinorUnits);
}
