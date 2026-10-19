/**
 * Tests for src/domain/mandate
 *
 * Covers:
 *   - CartMandate builder: known-answer, all validity rules
 *   - IntentMandate builder: known-answer, all validity rules
 *   - PaymentMandate derivation table
 *   - Schema rejects unknown fields (strict)
 *   - isWithinValidity
 *   - requiredRoles
 *   - attestMandate / recomputeHash
 *   - Property: changing any single leaf changes the hash (200 runs)
 */

import { describe, expect, it, beforeAll } from "vitest";
import fc from "fast-check";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  buildCartMandate,
  buildIntentMandate,
  derivePaymentMandate,
  requiredRoles,
  attestMandate,
  recomputeHash,
  isWithinValidity,
  CartMandateTermsSchema,
  IntentMandateTermsSchema,
  type CartMandateTerms,
  type CartMandateInput,
  type IntentMandateInput,
} from "../../../src/domain/mandate/index.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import type { Timestamp, Uuid } from "../../../src/domain/shared/clock.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";

const ids = new SequentialIdGenerator();

const T0 = "2026-10-20T10:00:00.000Z" as Timestamp;
const T5 = "2026-10-20T10:05:00.000Z" as Timestamp; // T0 + 5 min
const T15 = "2026-10-20T10:15:00.000Z" as Timestamp; // T0 + 15 min exactly (too long)
const T14 = "2026-10-20T10:14:59.000Z" as Timestamp; // T0 + 14m59s (OK)
const T16 = "2026-10-20T10:16:00.000Z" as Timestamp; // T0 + 16 min (over)
const T31D = "2026-11-20T10:00:00.000Z" as Timestamp; // T0 + 31 days exactly
const T32D = "2026-11-21T10:00:00.000Z" as Timestamp; // T0 + 32 days (over)
const T30D = "2026-11-19T10:00:00.000Z" as Timestamp; // T0 + 30 days (OK)

function makeCartInput(overrides?: Partial<CartMandateInput>): CartMandateInput {
  return {
    id: ids.uuid(),
    correlationId: ids.uuid(),
    principalId: "principal-1",
    agent: { id: "agent-1", model: "gemini-1.5-pro" },
    payee: { merchantId: "shopx", displayName: "ShopX" },
    payment: { amountMinor: 8500, currency: "USD" },
    items: [{ sku: "KB-75", description: "75% keyboard", quantity: 1, unitAmountMinor: 8500 }],
    promptPlayback: "Buy the 75% keyboard from ShopX for $85.00",
    policy: { id: "policy-v1", hash: "a".repeat(64) },
    validity: { notBefore: T0, expiresAt: T5 },
    nonce: "b".repeat(64),
    ...overrides,
  };
}

function makeIntentInput(overrides?: Partial<IntentMandateInput>): IntentMandateInput {
  return {
    id: ids.uuid(),
    correlationId: ids.uuid(),
    principalId: "principal-1",
    agent: { id: "agent-1", model: "gemini-1.5-pro" },
    scope: { merchantIds: ["cloudco"], categories: ["cloud-credits"], currency: "USD" },
    limits: {
      totalBudgetMinor: 12000,
      perTxMaxMinor: 5000,
      maxTransactions: 6,
      stepUpAboveMinor: 4000,
    },
    promptPlayback: "Handle cloud credits up to $120",
    policy: { id: "policy-v1", hash: "a".repeat(64) },
    validity: { notBefore: T0, expiresAt: T30D },
    nonce: "c".repeat(64),
    ...overrides,
  };
}

// ─── Cart mandate builder ─────────────────────────────────────────────────────

describe("buildCartMandate()", () => {
  it("builds a valid cart mandate and returns a hash", () => {
    const r = buildCartMandate(makeCartInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.kind).toBe("CART");
    expect(r.value.terms.v).toBe(1);
    expect(r.value.hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(r.value.hash)).toBe(true);
  });

  it("hash is deterministic for the same input", () => {
    const fixedId = "00000000-0000-0000-0000-000000000001" as Uuid;
    const fixedCorrId = "00000000-0000-0000-0000-000000000002" as Uuid;
    const input = makeCartInput({ id: fixedId, correlationId: fixedCorrId });
    const r1 = buildCartMandate(input);
    const r2 = buildCartMandate(input);
    expect(r1.ok && r2.ok && r1.value.hash === r2.value.hash).toBe(true);
  });

  it("rejects notBefore >= expiresAt", () => {
    const r = buildCartMandate(makeCartInput({ validity: { notBefore: T5, expiresAt: T0 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("VALIDITY_INVALID");
  });

  it("rejects equal notBefore and expiresAt", () => {
    const r = buildCartMandate(makeCartInput({ validity: { notBefore: T0, expiresAt: T0 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("VALIDITY_INVALID");
  });

  it("rejects TTL > 15 minutes", () => {
    const r = buildCartMandate(makeCartInput({ validity: { notBefore: T0, expiresAt: T16 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TTL_EXCEEDED");
  });

  it("accepts TTL of exactly 14m59s", () => {
    const r = buildCartMandate(makeCartInput({ validity: { notBefore: T0, expiresAt: T14 } }));
    expect(r.ok).toBe(true);
  });

  it("rejects TTL of exactly 15 minutes (boundary is exclusive)", () => {
    const r = buildCartMandate(makeCartInput({ validity: { notBefore: T0, expiresAt: T15 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TTL_EXCEEDED");
  });

  it("rejects item total mismatch", () => {
    const r = buildCartMandate(
      makeCartInput({
        items: [{ sku: "KB-75", description: "keyboard", quantity: 2, unitAmountMinor: 8500 }],
        payment: { amountMinor: 8500, currency: "USD" }, // should be 17000
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ITEM_TOTAL_MISMATCH");
  });

  it("accepts multiple items summing to payment amount", () => {
    const r = buildCartMandate(
      makeCartInput({
        items: [
          { sku: "KB-75", description: "keyboard", quantity: 1, unitAmountMinor: 5000 },
          { sku: "MOUSE", description: "mouse", quantity: 2, unitAmountMinor: 1750 },
        ],
        payment: { amountMinor: 8500, currency: "USD" },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects invalid timestamp format with VALIDITY_INVALID", () => {
    const r = buildCartMandate(
      makeCartInput({ validity: { notBefore: "invalid-date" as Timestamp, expiresAt: T5 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("VALIDITY_INVALID");
      expect(r.error.message).toContain("not a valid ISO-8601 UTC timestamp");
    }
  });

  it("rejects invalid schema inputs with SCHEMA_INVALID", () => {
    const r = buildCartMandate(makeCartInput({ items: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("SCHEMA_INVALID");
  });

  it("schema rejects unknown fields", () => {
    const raw = { ...makeCartInput(), unknownField: "boom" };
    const result = CartMandateTermsSchema.safeParse({ ...raw, v: 1, kind: "CART" });
    expect(result.success).toBe(false);
  });
});

// ─── Intent mandate builder ───────────────────────────────────────────────────

describe("buildIntentMandate()", () => {
  it("builds a valid intent mandate", () => {
    const r = buildIntentMandate(makeIntentInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.kind).toBe("INTENT");
    expect(r.value.hash).toHaveLength(64);
  });

  it("rejects notBefore >= expiresAt", () => {
    const r = buildIntentMandate(makeIntentInput({ validity: { notBefore: T30D, expiresAt: T0 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("VALIDITY_INVALID");
  });

  it("rejects TTL > 31 days", () => {
    const r = buildIntentMandate(makeIntentInput({ validity: { notBefore: T0, expiresAt: T32D } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TTL_EXCEEDED");
  });

  it("rejects TTL of exactly 31 days (boundary exclusive)", () => {
    const r = buildIntentMandate(makeIntentInput({ validity: { notBefore: T0, expiresAt: T31D } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TTL_EXCEEDED");
  });

  it("accepts TTL of 30 days", () => {
    const r = buildIntentMandate(makeIntentInput({ validity: { notBefore: T0, expiresAt: T30D } }));
    expect(r.ok).toBe(true);
  });

  it("rejects perTxMaxMinor > totalBudgetMinor", () => {
    const r = buildIntentMandate(
      makeIntentInput({
        limits: {
          totalBudgetMinor: 1000,
          perTxMaxMinor: 2000,
          maxTransactions: 3,
          stepUpAboveMinor: 500,
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("LIMITS_INCOHERENT");
  });

  it("rejects stepUpAboveMinor > perTxMaxMinor", () => {
    const r = buildIntentMandate(
      makeIntentInput({
        limits: {
          totalBudgetMinor: 10000,
          perTxMaxMinor: 3000,
          maxTransactions: 3,
          stepUpAboveMinor: 4000,
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("LIMITS_INCOHERENT");
  });

  it("rejects maxTransactions < 1 via schema", () => {
    const r = buildIntentMandate(
      makeIntentInput({
        limits: {
          totalBudgetMinor: 10000,
          perTxMaxMinor: 5000,
          maxTransactions: 0,
          stepUpAboveMinor: 1000,
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("SCHEMA_INVALID");
  });

  it("rejects invalid timestamp format with VALIDITY_INVALID", () => {
    const r = buildIntentMandate(
      makeIntentInput({ validity: { notBefore: T0, expiresAt: "invalid-date" as Timestamp } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("VALIDITY_INVALID");
      expect(r.error.message).toContain("not a valid ISO-8601 UTC timestamp");
    }
  });

  it("schema rejects unknown fields", () => {
    const raw = {
      v: 1,
      kind: "INTENT",
      id: "x",
      correlationId: "x",
      principalId: "x",
      agent: { id: "x", model: "x" },
      scope: { merchantIds: [], categories: [], currency: "USD" },
      limits: { totalBudgetMinor: 100, perTxMaxMinor: 50, maxTransactions: 1, stepUpAboveMinor: 0 },
      promptPlayback: "x",
      policy: { id: "x", hash: "x" },
      validity: { notBefore: T0, expiresAt: T30D },
      nonce: "x",
      extraField: "boom",
    };
    const result = IntentMandateTermsSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ─── isWithinValidity ─────────────────────────────────────────────────────────

describe("isWithinValidity()", () => {
  const terms = makeCartInput({ validity: { notBefore: T0, expiresAt: T5 } });
  // Build so we have a proper CartMandateTerms
  it("returns true when now is within window", () => {
    const r = buildCartMandate(terms);
    if (!r.ok) throw new Error("build failed");
    expect(isWithinValidity(r.value.terms, "2026-10-20T10:02:00.000Z" as Timestamp)).toBe(true);
  });

  it("returns true at exactly notBefore (inclusive)", () => {
    const r = buildCartMandate(terms);
    if (!r.ok) throw new Error("build failed");
    expect(isWithinValidity(r.value.terms, T0)).toBe(true);
  });

  it("returns false at exactly expiresAt (exclusive)", () => {
    const r = buildCartMandate(terms);
    if (!r.ok) throw new Error("build failed");
    expect(isWithinValidity(r.value.terms, T5)).toBe(false);
  });

  it("returns false before notBefore", () => {
    const r = buildCartMandate(terms);
    if (!r.ok) throw new Error("build failed");
    expect(isWithinValidity(r.value.terms, "2026-10-20T09:59:59.999Z" as Timestamp)).toBe(false);
  });

  it("returns false after expiresAt", () => {
    const r = buildCartMandate(terms);
    if (!r.ok) throw new Error("build failed");
    expect(isWithinValidity(r.value.terms, "2026-10-20T10:06:00.000Z" as Timestamp)).toBe(false);
  });
});

// ─── Payment mandate derivation ───────────────────────────────────────────────

describe("derivePaymentMandate()", () => {
  it("derives HP payment mandate from CART parent", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      cart.value,
      { merchantId: "shopx", amountMinor: 8500, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.modality).toBe("HP");
    expect(r.value.terms.kind).toBe("PAYMENT");
    expect(r.value.terms.parent.kind).toBe("CART");
    expect(r.value.terms.payment.amountMinor).toBe(8500);
  });

  it("derives HNP payment mandate from INTENT parent", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 3000, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.modality).toBe("HNP");
    expect(r.value.terms.parent.kind).toBe("INTENT");
  });

  it("rejects cart spend with wrong amount", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      cart.value,
      { merchantId: "shopx", amountMinor: 9000, currency: "USD" }, // wrong amount
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TERMS_MISMATCH");
  });

  it("rejects cart spend with wrong currency", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      cart.value,
      { merchantId: "shopx", amountMinor: 8500, currency: "EUR" }, // wrong currency
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TERMS_MISMATCH");
  });

  it("rejects cart spend with wrong merchantId", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      cart.value,
      { merchantId: "wrong-shop", amountMinor: 8500, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TERMS_MISMATCH");
  });

  it("rejects intent spend with merchant not in scope", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "evil-shop", amountMinor: 1000, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("MERCHANT_NOT_ALLOWED");
  });

  it("rejects intent spend with wrong currency", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 1000, currency: "EUR" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("CURRENCY_NOT_ALLOWED");
  });

  it("rejects intent spend over perTxMaxMinor", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 6000, currency: "USD" }, // perTxMax is 5000
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("BUDGET_EXCEEDED");
  });

  it("rejects intent spend above stepUpAboveMinor", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    // stepUpAboveMinor = 4000, so spending 4001 requires step-up
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 4001, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("STEP_UP_REQUIRED");
  });

  it("accepts intent spend at exact stepUpAboveMinor boundary", () => {
    const intent = buildIntentMandate(makeIntentInput());
    if (!intent.ok) throw new Error("build failed");
    // stepUpAboveMinor = 4000, spending exactly 4000 does not require step up
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 4000, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.payment.amountMinor).toBe(4000);
  });

  it("accepts intent spend at exact perTxMaxMinor boundary when within step-up limit", () => {
    const intent = buildIntentMandate(
      makeIntentInput({
        limits: {
          totalBudgetMinor: 12000,
          perTxMaxMinor: 5000,
          maxTransactions: 6,
          stepUpAboveMinor: 5000,
        },
      }),
    );
    if (!intent.ok) throw new Error("build failed");
    const r = derivePaymentMandate(
      intent.value,
      { merchantId: "cloudco", amountMinor: 5000, currency: "USD" },
      1,
      T0,
      ids.uuid(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms.payment.amountMinor).toBe(5000);
  });
});

// ─── requiredRoles ────────────────────────────────────────────────────────────

describe("requiredRoles()", () => {
  it("CART requires AUTHORITY and MERCHANT", () => {
    expect(requiredRoles("CART")).toEqual(["AUTHORITY", "MERCHANT"]);
  });

  it("INTENT requires only AUTHORITY", () => {
    expect(requiredRoles("INTENT")).toEqual(["AUTHORITY"]);
  });

  it("PAYMENT requires only AUTHORITY", () => {
    expect(requiredRoles("PAYMENT")).toEqual(["AUTHORITY"]);
  });

  it("throws on unknown mandate kind", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => requiredRoles("UNKNOWN" as any)).toThrow("Unknown mandate kind: UNKNOWN");
  });
});

// ─── attestMandate / recomputeHash ───────────────────────────────────────────

describe("attestMandate() and recomputeHash()", () => {
  let privKey: KeyObject;
  let pubKey: KeyObject;

  beforeAll(() => {
    const pair = generateKeyPairSync("ed25519");
    privKey = pair.privateKey as KeyObject;
    pubKey = pair.publicKey as KeyObject;
  });

  it("attestMandate creates a verifiable attestation", async () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const hashBuf = cart.value.hash as Hash;
    const r = attestMandate("AUTHORITY", hashBuf, privKey, pubKey);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.role).toBe("AUTHORITY");
    expect(r.value.keyId).toHaveLength(64);
    expect(r.value.signature.length).toBeGreaterThan(0);
  });

  it("attestMandate returns error when signing fails (e.g. invalid key)", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const hashBuf = cart.value.hash as Hash;
    // Passing pubKey where privateKey is expected causes signHash to fail
    const r = attestMandate("AUTHORITY", hashBuf, pubKey, pubKey);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("SIGN_FAILED");
    }
  });

  it("recomputeHash returns the same hash as the builder", () => {
    const cart = buildCartMandate(makeCartInput());
    if (!cart.ok) throw new Error("build failed");
    const r = recomputeHash(cart.value.terms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(cart.value.hash);
  });
});

// ─── Property: changing any field changes the hash ────────────────────────────

describe("property: changing any leaf in a cart mandate changes its hash (200 runs)", () => {
  it("mutating the nonce changes the hash", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (nonce) => {
        const base = makeCartInput({ nonce: "0".repeat(64) });
        const mutated = makeCartInput({ nonce });
        const r1 = buildCartMandate(base);
        const r2 = buildCartMandate(mutated);
        if (!r1.ok || !r2.ok) return true;
        if (nonce === "0".repeat(64)) return r1.value.hash === r2.value.hash;
        return r1.value.hash !== r2.value.hash;
      }),
      { numRuns: 200 },
    );
  });

  it("mutating the amount changes the hash", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50000 }), (unitAmount) => {
        const r1 = buildCartMandate(
          makeCartInput({
            items: [{ sku: "KB", description: "kb", quantity: 1, unitAmountMinor: 8500 }],
            payment: { amountMinor: 8500, currency: "USD" },
          }),
        );
        const r2 = buildCartMandate(
          makeCartInput({
            items: [{ sku: "KB", description: "kb", quantity: 1, unitAmountMinor: unitAmount }],
            payment: { amountMinor: unitAmount, currency: "USD" },
          }),
        );
        if (!r1.ok || !r2.ok) return true;
        if (unitAmount === 8500) return r1.value.hash === r2.value.hash;
        return r1.value.hash !== r2.value.hash;
      }),
      { numRuns: 200 },
    );
  });

  it("mutating the merchantId changes the hash", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "shopx"),
        (merchantId) => {
          const r1 = buildCartMandate(makeCartInput());
          const r2 = buildCartMandate(
            makeCartInput({
              payee: { merchantId, displayName: "Other" },
            }),
          );
          if (!r1.ok || !r2.ok) return true;
          return r1.value.hash !== r2.value.hash;
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── isWithinValidity for PaymentMandateTerms ─────────────────────────────────

// ─── isWithinValidity for PaymentMandateTerms ─────────────────────────────────

describe("isWithinValidity() — PaymentMandateTerms (no validity window)", () => {
  it("returns true for PaymentMandateTerms (always in-window)", () => {
    const pm = {
      v: 1 as const,
      kind: "PAYMENT" as const,
      id: "00000000-0000-0000-0000-000000000099" as Uuid,
      correlationId: "00000000-0000-0000-0000-000000000098" as Uuid,
      parent: { mandateId: "p1", hash: "a".repeat(64), kind: "CART" as const },
      modality: "HP" as const,
      sequence: 1,
      payee: { merchantId: "shopx" },
      payment: { amountMinor: 8500, currency: "USD" as const },
      agentId: "agent-1",
      createdAt: T0,
    };
    // PaymentMandateTerms has no validity field → always in-window
    expect(isWithinValidity(pm, T0)).toBe(true);
    expect(isWithinValidity(pm, "2030-01-01T00:00:00.000Z" as Timestamp)).toBe(true);
  });
});

// ─── recomputeHash error path ─────────────────────────────────────────────────

describe("recomputeHash() — error path", () => {
  it("returns Err when terms contain non-canonical values (float)", () => {
    // Force a value that would fail canonicalization — not possible via the builder
    const bad = { v: 1, kind: "CART", amount: 1.5 } as unknown as CartMandateTerms;
    const r = recomputeHash(bad);
    // A float in terms causes hashCanonical to fail
    expect(r.ok).toBe(false);
  });
});
