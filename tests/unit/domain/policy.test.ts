/**
 * Tests for src/domain/policy
 *
 * Table-driven over every rule and combination.
 * Determinism property: same input always produces same output.
 * Policy hash changes when any rule changes.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  evaluatePolicy,
  hashPolicy,
  type PolicyDocument,
  type PolicyContext,
} from "../../../src/domain/policy/index.js";

function makePolicy(overrides: Partial<PolicyDocument["rules"]> = {}): PolicyDocument {
  return {
    id: "policy-v1",
    version: 1,
    rules: { ...overrides },
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    amountMinor: 1000,
    currency: "USD",
    merchantId: "shopx",
    ...overrides,
  };
}

// ─── ALLOW baseline ───────────────────────────────────────────────────────────

describe("evaluatePolicy() — baseline", () => {
  it("allows when no rules are set", () => {
    const r = evaluatePolicy(makePolicy(), makeContext());
    expect(r.decision).toBe("ALLOW");
    expect(r.reasons).toHaveLength(0);
  });
});

// ─── Merchant allowlist ───────────────────────────────────────────────────────

describe("evaluatePolicy() — merchantAllowlist", () => {
  it("allows when merchant is in the allowlist", () => {
    const r = evaluatePolicy(
      makePolicy({ merchantAllowlist: ["shopx", "shopy"] }),
      makeContext({ merchantId: "shopx" }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("denies when merchant is NOT in the allowlist", () => {
    const r = evaluatePolicy(
      makePolicy({ merchantAllowlist: ["shopx"] }),
      makeContext({ merchantId: "evil-shop" }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("MERCHANT_NOT_ALLOWED");
  });

  it("allows when allowlist is empty (no restriction)", () => {
    const r = evaluatePolicy(
      makePolicy({ merchantAllowlist: [] }),
      makeContext({ merchantId: "any-shop" }),
    );
    expect(r.decision).toBe("ALLOW");
  });
});

// ─── Merchant denylist ────────────────────────────────────────────────────────

describe("evaluatePolicy() — merchantDenylist", () => {
  it("denies when merchant is in the denylist", () => {
    const r = evaluatePolicy(
      makePolicy({ merchantDenylist: ["bad-shop"] }),
      makeContext({ merchantId: "bad-shop" }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("MERCHANT_NOT_ALLOWED");
  });

  it("allows when merchant is NOT in the denylist", () => {
    const r = evaluatePolicy(
      makePolicy({ merchantDenylist: ["bad-shop"] }),
      makeContext({ merchantId: "shopx" }),
    );
    expect(r.decision).toBe("ALLOW");
  });
});

// ─── Currency allowlist ───────────────────────────────────────────────────────

describe("evaluatePolicy() — currencyAllowlist", () => {
  it("allows when currency is in the list", () => {
    const r = evaluatePolicy(
      makePolicy({ currencyAllowlist: ["USD", "EUR"] }),
      makeContext({ currency: "USD" }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("denies when currency is NOT in the list", () => {
    const r = evaluatePolicy(
      makePolicy({ currencyAllowlist: ["EUR"] }),
      makeContext({ currency: "USD" }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("CURRENCY_NOT_ALLOWED");
  });
});

// ─── maxPerTxMinor ────────────────────────────────────────────────────────────

describe("evaluatePolicy() — maxPerTxMinor", () => {
  it("allows when amount equals the limit", () => {
    const r = evaluatePolicy(
      makePolicy({ maxPerTxMinor: 1000 }),
      makeContext({ amountMinor: 1000 }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("allows when amount is below the limit", () => {
    const r = evaluatePolicy(
      makePolicy({ maxPerTxMinor: 1000 }),
      makeContext({ amountMinor: 999 }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("denies when amount exceeds the limit", () => {
    const r = evaluatePolicy(
      makePolicy({ maxPerTxMinor: 1000 }),
      makeContext({ amountMinor: 1001 }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("TX_CAP_EXCEEDED");
  });
});

// ─── maxDailyMinor ────────────────────────────────────────────────────────────

describe("evaluatePolicy() — maxDailyMinor", () => {
  it("allows when today's spend + amount is at the limit", () => {
    const r = evaluatePolicy(
      makePolicy({ maxDailyMinor: 5000 }),
      makeContext({ amountMinor: 2000, todaySpentMinor: 3000 }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("denies when today's spend + amount exceeds the limit", () => {
    const r = evaluatePolicy(
      makePolicy({ maxDailyMinor: 5000 }),
      makeContext({ amountMinor: 2001, todaySpentMinor: 3000 }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("POLICY_DENIED");
  });

  it("treats missing todaySpentMinor as 0", () => {
    const r = evaluatePolicy(
      makePolicy({ maxDailyMinor: 5000 }),
      makeContext({ amountMinor: 5001 }), // no todaySpentMinor
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("POLICY_DENIED");
  });
});

// ─── stepUpAboveMinor ─────────────────────────────────────────────────────────

describe("evaluatePolicy() — stepUpAboveMinor", () => {
  it("allows when amount equals the threshold", () => {
    const r = evaluatePolicy(
      makePolicy({ stepUpAboveMinor: 1000 }),
      makeContext({ amountMinor: 1000 }),
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("denies when amount exceeds the threshold", () => {
    const r = evaluatePolicy(
      makePolicy({ stepUpAboveMinor: 1000 }),
      makeContext({ amountMinor: 1001 }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("STEP_UP_REQUIRED");
  });
});

// ─── Multiple rules: all collected ───────────────────────────────────────────

describe("evaluatePolicy() — multiple rules collected", () => {
  it("collects all triggered reasons, not just the first", () => {
    const r = evaluatePolicy(
      makePolicy({
        maxPerTxMinor: 500,
        currencyAllowlist: ["EUR"],
        merchantDenylist: ["evil"],
      }),
      makeContext({ amountMinor: 1000, currency: "USD", merchantId: "evil" }),
    );
    expect(r.decision).toBe("DENY");
    // All three rules trigger
    expect(r.reasons).toContain("TX_CAP_EXCEEDED");
    expect(r.reasons).toContain("CURRENCY_NOT_ALLOWED");
    expect(r.reasons).toContain("MERCHANT_NOT_ALLOWED");
    expect(r.reasons).toHaveLength(3);
  });

  it("reasons are in stable (alphabetical) order", () => {
    const r = evaluatePolicy(
      makePolicy({
        maxPerTxMinor: 500,
        currencyAllowlist: ["EUR"],
      }),
      makeContext({ amountMinor: 1000, currency: "USD" }),
    );
    const sorted = [...r.reasons].sort();
    expect(r.reasons).toEqual(sorted);
  });
});

// ─── Determinism property ─────────────────────────────────────────────────────

describe("property: evaluatePolicy is deterministic (200 runs)", () => {
  it("same policy + context always produce same result", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (amount) => {
        const policy = makePolicy({ maxPerTxMinor: 5000, stepUpAboveMinor: 3000 });
        const ctx = makeContext({ amountMinor: amount });
        const r1 = evaluatePolicy(policy, ctx);
        const r2 = evaluatePolicy(policy, ctx);
        return (
          r1.decision === r2.decision && JSON.stringify(r1.reasons) === JSON.stringify(r2.reasons)
        );
      }),
      { numRuns: 200 },
    );
  });
});

// ─── hashPolicy changes when rule changes ────────────────────────────────────

describe("hashPolicy()", () => {
  it("produces a 64-char hex hash", () => {
    const r = hashPolicy(makePolicy());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(64);
  });

  it("hash changes when maxPerTxMinor changes", () => {
    const r1 = hashPolicy(makePolicy({ maxPerTxMinor: 1000 }));
    const r2 = hashPolicy(makePolicy({ maxPerTxMinor: 2000 }));
    expect(r1.ok && r2.ok && r1.value !== r2.value).toBe(true);
  });

  it("hash changes when merchantAllowlist changes", () => {
    const r1 = hashPolicy(makePolicy({ merchantAllowlist: ["shopx"] }));
    const r2 = hashPolicy(makePolicy({ merchantAllowlist: ["shopy"] }));
    expect(r1.ok && r2.ok && r1.value !== r2.value).toBe(true);
  });

  it("hash changes when policy version changes", () => {
    const r1 = hashPolicy(makePolicy());
    const r2 = hashPolicy({ ...makePolicy(), version: 2 });
    expect(r1.ok && r2.ok && r1.value !== r2.value).toBe(true);
  });
});
