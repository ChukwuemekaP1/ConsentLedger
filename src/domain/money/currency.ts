/**
 * Currency — closed set of supported currencies with their PayPal exponents.
 *
 * Source: PayPal REST APIs — Supported currencies and decimal places
 * URL: https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
 * Read: 2026-10-14
 *
 * PayPal uses "decimal places" to determine how amounts are interpreted:
 *   - 0 decimals (zero-decimal): JPY — amount is the full integer value
 *   - 2 decimals: USD, EUR, GBP — amount is in the smallest unit (cents)
 *
 * The exponent is the power of 10 by which the minor unit relates to the major unit.
 * USD 1.00 = 100 minor units (exponent 2), JPY 100 = 100 minor units (exponent 0).
 *
 * I-10: Money is integer minor units. No floats anywhere.
 */

/** Supported currencies. Adding one requires a PayPal doc review and an ADR. */
export const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Decimal exponent table: the number of decimal places for each currency.
 * Matches PayPal's "decimal places" column exactly.
 * JPY is zero-decimal; all others are 2.
 */
export const CURRENCY_EXPONENT: Record<Currency, 0 | 2> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
} as const;

/** Runtime check: is a string a known Currency? */
export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}
