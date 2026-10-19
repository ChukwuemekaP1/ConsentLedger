/**
 * Tests for src/domain/state — state machines.
 *
 * Full cross-product: for every (state × event) pair not in the allowed table,
 * transition() must return Err. For allowed pairs, it must return Ok.
 *
 * INVARIANT I-11: unknown state is never treated as success.
 */

import { describe, expect, it } from "vitest";
import {
  CART_MACHINE,
  INTENT_MACHINE,
  PAYMENT_MACHINE,
  transition,
  type CartMandateState,
  type CartMandateEvent,
  type IntentMandateState,
  type IntentMandateEvent,
  type PaymentMandateState,
  type PaymentMandateEvent,
} from "../../../src/domain/state/index.js";

// ─── Cart machine ─────────────────────────────────────────────────────────────

const CART_STATES: CartMandateState[] = [
  "DRAFTED",
  "DENIED_BY_POLICY",
  "ISSUED",
  "SIGNED",
  "EXECUTING",
  "SETTLED",
  "FAILED",
  "UNKNOWN",
  "EXPIRED",
  "REVOKED",
];

const CART_EVENTS: CartMandateEvent[] = [
  "POLICY_PASSED",
  "POLICY_DENIED",
  "CONSENT_VERIFIED",
  "GATE_PASSED",
  "SETTLEMENT_COMPLETED",
  "SETTLEMENT_FAILED",
  "OUTCOME_UNKNOWN",
  "RECONCILED_OK",
  "RECONCILED_FAILED",
  "EXPIRED",
  "REVOKED",
];

// Allowed transitions (ground truth matches the table in machines.ts)
const CART_ALLOWED: [CartMandateState, CartMandateEvent, CartMandateState][] = [
  ["DRAFTED", "POLICY_PASSED", "ISSUED"],
  ["DRAFTED", "POLICY_DENIED", "DENIED_BY_POLICY"],
  ["ISSUED", "CONSENT_VERIFIED", "SIGNED"],
  ["ISSUED", "EXPIRED", "EXPIRED"],
  ["ISSUED", "REVOKED", "REVOKED"],
  ["SIGNED", "GATE_PASSED", "EXECUTING"],
  ["SIGNED", "EXPIRED", "EXPIRED"],
  ["SIGNED", "REVOKED", "REVOKED"],
  ["EXECUTING", "SETTLEMENT_COMPLETED", "SETTLED"],
  ["EXECUTING", "SETTLEMENT_FAILED", "FAILED"],
  ["EXECUTING", "OUTCOME_UNKNOWN", "UNKNOWN"],
  ["UNKNOWN", "RECONCILED_OK", "SETTLED"],
  ["UNKNOWN", "RECONCILED_FAILED", "FAILED"],
];

describe("Cart mandate state machine", () => {
  it.each(CART_ALLOWED)("allows %s + %s → %s", (from, event, expected) => {
    const r = transition(CART_MACHINE, from, event);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it("full cross-product: all unlisted pairs are rejected", () => {
    const allowedSet = new Set(CART_ALLOWED.map(([s, e]) => `${s}:${e}`));
    for (const from of CART_STATES) {
      for (const event of CART_EVENTS) {
        const key = `${from}:${event}`;
        if (allowedSet.has(key)) continue;
        const r = transition(CART_MACHINE, from, event);
        expect(r.ok, `Expected ${from}+${event} to be rejected`).toBe(false);
      }
    }
  });

  it("unknown state returns UNKNOWN_STATE error (I-11: fail closed)", () => {
    // Pass a value that is not a valid CartMandateState. The function signature
    // accepts generic S extends string, so we cast through unknown to force it.
    const r = transition(
      CART_MACHINE,
      "NOT_A_REAL_STATE" as unknown as CartMandateState,
      "POLICY_PASSED",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe("UNKNOWN_STATE");
  });
});

// ─── Intent machine ───────────────────────────────────────────────────────────

const INTENT_STATES: IntentMandateState[] = ["ISSUED", "ACTIVE", "EXHAUSTED", "EXPIRED", "REVOKED"];

const INTENT_EVENTS: IntentMandateEvent[] = [
  "CONSENT_VERIFIED",
  "BUDGET_EXHAUSTED",
  "EXPIRED",
  "REVOKED",
];

const INTENT_ALLOWED: [IntentMandateState, IntentMandateEvent, IntentMandateState][] = [
  ["ISSUED", "CONSENT_VERIFIED", "ACTIVE"],
  ["ISSUED", "EXPIRED", "EXPIRED"],
  ["ISSUED", "REVOKED", "REVOKED"],
  ["ACTIVE", "BUDGET_EXHAUSTED", "EXHAUSTED"],
  ["ACTIVE", "EXPIRED", "EXPIRED"],
  ["ACTIVE", "REVOKED", "REVOKED"],
];

describe("Intent mandate state machine", () => {
  it.each(INTENT_ALLOWED)("allows %s + %s → %s", (from, event, expected) => {
    const r = transition(INTENT_MACHINE, from, event);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it("full cross-product: all unlisted pairs are rejected", () => {
    const allowedSet = new Set(INTENT_ALLOWED.map(([s, e]) => `${s}:${e}`));
    for (const from of INTENT_STATES) {
      for (const event of INTENT_EVENTS) {
        const key = `${from}:${event}`;
        if (allowedSet.has(key)) continue;
        const r = transition(INTENT_MACHINE, from, event);
        expect(r.ok, `Expected ${from}+${event} to be rejected`).toBe(false);
      }
    }
  });
});

// ─── Payment machine ──────────────────────────────────────────────────────────

const PAYMENT_STATES: PaymentMandateState[] = [
  "AUTHORIZED",
  "ORDER_CREATED",
  "CAPTURE_REQUESTED",
  "CAPTURED",
  "CONFIRMED",
  "RECONCILED",
  "FAILED",
  "UNKNOWN",
];

const PAYMENT_EVENTS: PaymentMandateEvent[] = [
  "ORDER_CREATED",
  "CAPTURE_REQUESTED",
  "CAPTURE_COMPLETED",
  "WEBHOOK_CONFIRMED",
  "RECONCILED_OK",
  "PROVIDER_ERROR",
  "OUTCOME_UNKNOWN",
  "RECONCILED_FAILED",
];

const PAYMENT_ALLOWED: [PaymentMandateState, PaymentMandateEvent, PaymentMandateState][] = [
  ["AUTHORIZED", "ORDER_CREATED", "ORDER_CREATED"],
  ["AUTHORIZED", "PROVIDER_ERROR", "FAILED"],
  ["AUTHORIZED", "OUTCOME_UNKNOWN", "UNKNOWN"],
  ["ORDER_CREATED", "CAPTURE_REQUESTED", "CAPTURE_REQUESTED"],
  ["ORDER_CREATED", "PROVIDER_ERROR", "FAILED"],
  ["ORDER_CREATED", "OUTCOME_UNKNOWN", "UNKNOWN"],
  ["CAPTURE_REQUESTED", "CAPTURE_COMPLETED", "CAPTURED"],
  ["CAPTURE_REQUESTED", "PROVIDER_ERROR", "FAILED"],
  ["CAPTURE_REQUESTED", "OUTCOME_UNKNOWN", "UNKNOWN"],
  ["CAPTURED", "WEBHOOK_CONFIRMED", "CONFIRMED"],
  ["CAPTURED", "PROVIDER_ERROR", "FAILED"],
  ["CONFIRMED", "RECONCILED_OK", "RECONCILED"],
  ["CONFIRMED", "RECONCILED_FAILED", "FAILED"],
  ["UNKNOWN", "RECONCILED_OK", "CAPTURED"],
  ["UNKNOWN", "RECONCILED_FAILED", "FAILED"],
];

describe("Payment mandate state machine", () => {
  it.each(PAYMENT_ALLOWED)("allows %s + %s → %s", (from, event, expected) => {
    const r = transition(PAYMENT_MACHINE, from, event);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it("full cross-product: all unlisted pairs are rejected", () => {
    const allowedSet = new Set(PAYMENT_ALLOWED.map(([s, e]) => `${s}:${e}`));
    for (const from of PAYMENT_STATES) {
      for (const event of PAYMENT_EVENTS) {
        const key = `${from}:${event}`;
        if (allowedSet.has(key)) continue;
        const r = transition(PAYMENT_MACHINE, from, event);
        expect(r.ok, `Expected ${from}+${event} to be rejected`).toBe(false);
      }
    }
  });

  it("UNKNOWN resolves to CAPTURED (not to success directly) — reconciliation required", () => {
    const r = transition(PAYMENT_MACHINE, "UNKNOWN", "RECONCILED_OK");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("CAPTURED");
  });
});
