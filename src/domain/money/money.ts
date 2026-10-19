/**
 * Money — a value object pairing MinorUnits with a Currency.
 *
 * parseDecimalString: parse a provider/human decimal string into minor units.
 * formatForProvider: the only function that converts minor units to the decimal
 *   string PayPal expects. Used exclusively at the provider boundary. (I-02)
 *
 * I-10: Money is integer minor units. No floats anywhere.
 */

import type { Currency } from "./currency.js";
import type { MinorUnits } from "./minor-units.js";
import { CURRENCY_EXPONENT } from "./currency.js";
import { minorUnits } from "./minor-units.js";
import { type Result, ok, err } from "../shared/result.js";

export interface Money {
  readonly amountMinor: MinorUnits;
  readonly currency: Currency;
}

export interface ParseError {
  readonly kind:
    | "INVALID_FORMAT"
    | "EXTRA_PRECISION"
    | "NOT_AN_INTEGER" // for JPY
    | "NEGATIVE"
    | "OVERFLOW";
  readonly input: string;
}

/**
 * Parse a decimal string (as a provider or user might provide) into minor units.
 *
 * Accepted: "85.00", "85", "0", "0.00", "1500" (JPY)
 * Rejected: extra decimal places, signs, exponents, whitespace, locale commas,
 *           scientific notation, leading/trailing spaces.
 *
 * Rules:
 *   - Exact regex: digits only, optional single dot with exactly `exponent` decimal places
 *   - No leading zeroes except "0" or "0.xx"
 *   - No whitespace, no commas, no signs, no exponents
 */
export function parseDecimalString(
  input: string,
  currency: Currency,
): Result<MinorUnits, ParseError> {
  const exp = CURRENCY_EXPONENT[currency];

  // Build the allowed pattern based on exponent
  // Zero-decimal (JPY): only whole numbers
  // Two-decimal: digits with exactly 0 or 2 decimal places, no leading zeros
  let pattern: RegExp;
  if (exp === 0) {
    // Only integers, no decimal point
    pattern = /^(?:0|[1-9]\d*)$/;
  } else {
    // exp === 2: digits, optional ".XX"
    // Allow "0" or "0.00" but not "00" or "00.00"
    pattern = /^(?:0|[1-9]\d*)(?:\.\d{2})?$/;
  }

  if (!pattern.test(input)) {
    return err({ kind: "INVALID_FORMAT", input });
  }

  // Check for extra decimal places in the case of exp===2 with more than 2 dp
  // The regex already handles this but also guard against locale dots
  const dotCount = (input.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    return err({ kind: "INVALID_FORMAT", input });
  }

  if (exp === 0) {
    const n = parseInt(input, 10);
    return minorUnits(n).ok ? ok(n as MinorUnits) : err({ kind: "OVERFLOW", input });
  } else {
    // exp === 2
    const parts = input.split(".");
    const whole = parseInt(parts[0] ?? "0", 10);
    const frac = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
    const total = whole * 100 + frac;
    const result = minorUnits(total);
    if (!result.ok) {
      return err({ kind: "OVERFLOW", input });
    }
    return ok(result.value);
  }
}

/**
 * Format MinorUnits + Currency to the exact decimal string PayPal expects.
 *
 * This is the ONE formatting function used at the provider boundary. (I-02)
 *
 * USD 8500 → "85.00"
 * JPY 1500 → "1500"
 * EUR  100 → "1.00"
 *
 * @see https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
 */
export function formatForProvider(money: Money): string {
  const exp = CURRENCY_EXPONENT[money.currency];
  if (exp === 0) {
    return money.amountMinor.toString();
  }
  // exp === 2
  const whole = Math.floor(money.amountMinor / 100);
  const frac = money.amountMinor % 100;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}
