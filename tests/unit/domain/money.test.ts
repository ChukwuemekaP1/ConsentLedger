/**
 * Tests for src/domain/money
 *
 * Proves I-10: Money is integer minor units. No floats anywhere.
 *
 * Coverage:
 *   - MinorUnits validating constructor
 *   - parseDecimalString: known-answer and rejection table
 *   - formatForProvider: known-answer
 *   - Property: parse(format(x)) === x for USD and JPY (round trip)
 *   - JPY zero-decimal exponent
 *   - Boundary values: 0, MAX_SAFE_INTEGER
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  minorUnits,
  parseDecimalString,
  formatForProvider,
  type Currency,
  type Money,
} from "../../../src/domain/money/index.js";

// ─── MinorUnits ──────────────────────────────────────────────────────────────

describe("minorUnits()", () => {
  it("accepts zero", () => {
    const r = minorUnits(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it("accepts a positive safe integer", () => {
    const r = minorUnits(8500);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(8500);
  });

  it("accepts MAX_SAFE_INTEGER", () => {
    const r = minorUnits(Number.MAX_SAFE_INTEGER);
    expect(r.ok).toBe(true);
  });

  it("rejects a float", () => {
    const r = minorUnits(85.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NOT_AN_INTEGER");
  });

  it("rejects a negative integer", () => {
    const r = minorUnits(-1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NEGATIVE");
  });

  it("rejects MAX_SAFE_INTEGER + 1 (unsafe)", () => {
    const r = minorUnits(Number.MAX_SAFE_INTEGER + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("UNSAFE_INTEGER");
  });

  it("rejects NaN", () => {
    const r = minorUnits(NaN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NOT_A_NUMBER");
  });

  it("rejects Infinity", () => {
    const r = minorUnits(Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NOT_A_NUMBER");
  });

  it("rejects -Infinity", () => {
    const r = minorUnits(-Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NOT_A_NUMBER");
  });
});

// ─── parseDecimalString ───────────────────────────────────────────────────────

describe("parseDecimalString()", () => {
  // ── USD/EUR/GBP (exponent 2) ──────────────────────────────────────────────

  it.each<[string, Currency, number]>([
    ["85.00", "USD", 8500],
    ["0.00", "USD", 0],
    ["0.01", "USD", 1],
    ["0.99", "USD", 99],
    ["1.00", "USD", 100],
    ["1500.00", "EUR", 150000],
    ["85", "USD", 8500], // no decimal part allowed
    ["0", "GBP", 0],
    ["999999.99", "USD", 99999999],
  ])("parses '%s' %s → %d minor units", (input, currency, expected) => {
    const r = parseDecimalString(input, currency);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it.each<[string, Currency]>([
    ["85.000", "USD"], // 3 decimal places
    ["85.0", "USD"], // 1 decimal place
    [" 85.00", "USD"], // leading space
    ["85.00 ", "USD"], // trailing space
    ["+85.00", "USD"], // sign
    ["-85.00", "USD"], // negative sign
    ["8.5e1", "USD"], // exponent notation
    ["85,00", "USD"], // locale comma
    ["", "USD"], // empty
    [".", "USD"], // just a dot
    ["abc", "USD"], // non-numeric
    ["00.00", "USD"], // leading zero
    ["01.00", "USD"], // leading zero
    ["85.001", "USD"], // extra precision
    ["1.2.3", "USD"], // multiple decimal separators
    ["85.00.00", "USD"], // multiple decimal separators
  ])("rejects '%s' for %s", (input, currency) => {
    const r = parseDecimalString(input, currency);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("INVALID_FORMAT");
  });

  // ── Safe integer overflow and exact boundary values ───────────────────────

  it("parses the maximum safe integer for USD (90071992547409.91 → MAX_SAFE_INTEGER)", () => {
    const r = parseDecimalString("90071992547409.91", "USD");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects safe-integer overflow for USD (90071992547409.92 → MAX_SAFE_INTEGER + 1)", () => {
    const r = parseDecimalString("90071992547409.92", "USD");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("OVERFLOW");
      expect(r.error.input).toBe("90071992547409.92");
    }
  });

  // ── JPY (exponent 0, zero-decimal) ───────────────────────────────────────

  it.each<[string, number]>([
    ["0", 0],
    ["1", 1],
    ["1500", 1500],
    ["100", 100],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("parses '%s' JPY → %d", (input, expected) => {
    const r = parseDecimalString(input, "JPY");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it("rejects safe-integer overflow for JPY (MAX_SAFE_INTEGER + 1)", () => {
    const overflowInput = "9007199254740992"; // Number.MAX_SAFE_INTEGER + 1
    const r = parseDecimalString(overflowInput, "JPY");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("OVERFLOW");
      expect(r.error.input).toBe(overflowInput);
    }
  });

  it.each<string>([
    "1500.00", // no decimal allowed for JPY
    "1500.0",
    "15.50",
    "1.2.3", // multiple decimal separators
    " 100",
    "100 ",
    "+100",
    "-100",
    "1e3",
    "01", // leading zero
    "00",
  ])("rejects '%s' for JPY", (input) => {
    const r = parseDecimalString(input, "JPY");
    expect(r.ok).toBe(false);
  });
});

// ─── formatForProvider ────────────────────────────────────────────────────────

describe("formatForProvider()", () => {
  it.each<[number, Currency, string]>([
    [8500, "USD", "85.00"],
    [0, "USD", "0.00"],
    [1, "USD", "0.01"],
    [99, "USD", "0.99"],
    [100, "USD", "1.00"],
    [150000, "EUR", "1500.00"],
    [99, "GBP", "0.99"],
    [1500, "JPY", "1500"],
    [0, "JPY", "0"],
    [100, "JPY", "100"],
  ])("%d %s → '%s'", (amount, currency, expected) => {
    const mu = minorUnits(amount);
    expect(mu.ok).toBe(true);
    if (!mu.ok) return;
    const money: Money = { amountMinor: mu.value, currency };
    expect(formatForProvider(money)).toBe(expected);
  });
});

// ─── Property: round trip parse(format(x)) === x ──────────────────────────────

describe("property: parse(format(x)) === x", () => {
  it("USD: parse(format(x)) is identity for all valid minor unit values (200 runs)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const mu = minorUnits(n);
        if (!mu.ok) return; // shouldn't happen with valid n
        const money: Money = { amountMinor: mu.value, currency: "USD" };
        const formatted = formatForProvider(money);
        const parsed = parseDecimalString(formatted, "USD");
        if (!parsed.ok) return false;
        return parsed.value === n;
      }),
      { numRuns: 200 },
    );
  });

  it("JPY: parse(format(x)) is identity for all valid minor unit values (200 runs)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const mu = minorUnits(n);
        if (!mu.ok) return;
        const money: Money = { amountMinor: mu.value, currency: "JPY" };
        const formatted = formatForProvider(money);
        const parsed = parseDecimalString(formatted, "JPY");
        if (!parsed.ok) return false;
        return parsed.value === n;
      }),
      { numRuns: 200 },
    );
  });

  it("GBP: parse(format(x)) is identity (200 runs)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const mu = minorUnits(n);
        if (!mu.ok) return;
        const money: Money = { amountMinor: mu.value, currency: "GBP" };
        const formatted = formatForProvider(money);
        const parsed = parseDecimalString(formatted, "GBP");
        if (!parsed.ok) return false;
        return parsed.value === n;
      }),
      { numRuns: 200 },
    );
  });
});

// ─── isCurrency ───────────────────────────────────────────────────────────────

import { isCurrency } from "../../../src/domain/money/index.js";

describe("isCurrency()", () => {
  it("returns true for supported currencies", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("GBP")).toBe(true);
    expect(isCurrency("JPY")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isCurrency("CAD")).toBe(false);
    expect(isCurrency("btc")).toBe(false);
    expect(isCurrency("")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isCurrency(42)).toBe(false);
    expect(isCurrency(null)).toBe(false);
  });
});
