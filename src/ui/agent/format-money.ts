/**
 * Currency display for the Agent surface.
 *
 * Integer minor units only (I-10): the value is split with integer arithmetic
 * and never converted to a float. The ISO code is always printed so a symbol
 * such as "$" can never hide which currency is being approved.
 */

import { CURRENCY_EXPONENT, isCurrency, type Currency } from "../../domain/money/currency.js";

const SYMBOLS: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

export function formatMinorUnits(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    return "Invalid amount";
  }
  if (!isCurrency(currency)) {
    return "Unsupported currency";
  }
  const exponent = CURRENCY_EXPONENT[currency];
  const digits = BigInt(amountMinor);
  const scale = BigInt(10 ** exponent);
  const whole = (digits / scale).toLocaleString("en-US");
  const fraction = exponent === 0 ? "" : `.${(digits % scale).toString().padStart(exponent, "0")}`;
  return `${SYMBOLS[currency]}${whole}${fraction} ${currency}`;
}
