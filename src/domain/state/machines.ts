/**
 * State machines for Cart, Intent, and Payment mandates.
 *
 * State transitions are defined as data tables (maps from state+event → next state).
 * transition() returns Result<NextState, IllegalTransition> — illegal moves are values.
 *
 * ARCHITECTURE.md §4.3 — state machines.
 * CODING.md §1: "discriminated unions … exhaustive switch with a never check."
 * INVARIANT: I-11 — any unknown state is UNKNOWN, never success.
 */

import { type Result, ok, err } from "../shared/result.js";

// ─── Cart mandate states and events ──────────────────────────────────────────

export type CartMandateState =
  | "DRAFTED"
  | "DENIED_BY_POLICY"
  | "ISSUED"
  | "SIGNED"
  | "EXECUTING"
  | "SETTLED"
  | "FAILED"
  | "UNKNOWN"
  | "EXPIRED"
  | "REVOKED";

export type CartMandateEvent =
  | "POLICY_PASSED"
  | "POLICY_DENIED"
  | "CONSENT_VERIFIED"
  | "GATE_PASSED"
  | "SETTLEMENT_COMPLETED"
  | "SETTLEMENT_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECONCILED_OK"
  | "RECONCILED_FAILED"
  | "EXPIRED"
  | "REVOKED";

// ─── Intent mandate states and events ────────────────────────────────────────

export type IntentMandateState = "ISSUED" | "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "REVOKED";

export type IntentMandateEvent = "CONSENT_VERIFIED" | "BUDGET_EXHAUSTED" | "EXPIRED" | "REVOKED";

// ─── Payment mandate states and events ───────────────────────────────────────

export type PaymentMandateState =
  | "AUTHORIZED"
  | "ORDER_CREATED"
  | "CAPTURE_REQUESTED"
  | "CAPTURED"
  | "CONFIRMED"
  | "RECONCILED"
  | "FAILED"
  | "UNKNOWN";

export type PaymentMandateEvent =
  | "ORDER_CREATED"
  | "CAPTURE_REQUESTED"
  | "CAPTURE_COMPLETED"
  | "WEBHOOK_CONFIRMED"
  | "RECONCILED_OK"
  | "PROVIDER_ERROR"
  | "OUTCOME_UNKNOWN"
  | "RECONCILED_FAILED";

// ─── State machine type ───────────────────────────────────────────────────────

export type StateMachine<S extends string, E extends string> = {
  readonly transitions: ReadonlyMap<S, ReadonlyMap<E, S>>;
};

// ─── Cart mandate machine ─────────────────────────────────────────────────────

function buildCartMachine(): StateMachine<CartMandateState, CartMandateEvent> {
  const t = new Map<CartMandateState, ReadonlyMap<CartMandateEvent, CartMandateState>>();

  t.set(
    "DRAFTED",
    new Map<CartMandateEvent, CartMandateState>([
      ["POLICY_PASSED", "ISSUED"],
      ["POLICY_DENIED", "DENIED_BY_POLICY"],
    ]),
  );

  t.set(
    "ISSUED",
    new Map<CartMandateEvent, CartMandateState>([
      ["CONSENT_VERIFIED", "SIGNED"],
      ["EXPIRED", "EXPIRED"],
      ["REVOKED", "REVOKED"],
    ]),
  );

  t.set(
    "SIGNED",
    new Map<CartMandateEvent, CartMandateState>([
      ["GATE_PASSED", "EXECUTING"],
      ["EXPIRED", "EXPIRED"],
      ["REVOKED", "REVOKED"],
    ]),
  );

  t.set(
    "EXECUTING",
    new Map<CartMandateEvent, CartMandateState>([
      ["SETTLEMENT_COMPLETED", "SETTLED"],
      ["SETTLEMENT_FAILED", "FAILED"],
      ["OUTCOME_UNKNOWN", "UNKNOWN"],
    ]),
  );

  t.set(
    "UNKNOWN",
    new Map<CartMandateEvent, CartMandateState>([
      ["RECONCILED_OK", "SETTLED"],
      ["RECONCILED_FAILED", "FAILED"],
    ]),
  );

  // Terminal states: no transitions out
  t.set("SETTLED", new Map());
  t.set("FAILED", new Map());
  t.set("EXPIRED", new Map());
  t.set("REVOKED", new Map());
  t.set("DENIED_BY_POLICY", new Map());

  return { transitions: t };
}

export const CART_MACHINE = buildCartMachine();

// ─── Intent mandate machine ───────────────────────────────────────────────────

function buildIntentMachine(): StateMachine<IntentMandateState, IntentMandateEvent> {
  const t = new Map<IntentMandateState, ReadonlyMap<IntentMandateEvent, IntentMandateState>>();

  t.set(
    "ISSUED",
    new Map<IntentMandateEvent, IntentMandateState>([
      ["CONSENT_VERIFIED", "ACTIVE"],
      ["EXPIRED", "EXPIRED"],
      ["REVOKED", "REVOKED"],
    ]),
  );

  t.set(
    "ACTIVE",
    new Map<IntentMandateEvent, IntentMandateState>([
      ["BUDGET_EXHAUSTED", "EXHAUSTED"],
      ["EXPIRED", "EXPIRED"],
      ["REVOKED", "REVOKED"],
    ]),
  );

  // Terminal states
  t.set("EXHAUSTED", new Map());
  t.set("EXPIRED", new Map());
  t.set("REVOKED", new Map());

  return { transitions: t };
}

export const INTENT_MACHINE = buildIntentMachine();

// ─── Payment mandate machine ──────────────────────────────────────────────────

function buildPaymentMachine(): StateMachine<PaymentMandateState, PaymentMandateEvent> {
  const t = new Map<PaymentMandateState, ReadonlyMap<PaymentMandateEvent, PaymentMandateState>>();

  t.set(
    "AUTHORIZED",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["ORDER_CREATED", "ORDER_CREATED"],
      ["PROVIDER_ERROR", "FAILED"],
      ["OUTCOME_UNKNOWN", "UNKNOWN"],
    ]),
  );

  t.set(
    "ORDER_CREATED",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["CAPTURE_REQUESTED", "CAPTURE_REQUESTED"],
      ["PROVIDER_ERROR", "FAILED"],
      ["OUTCOME_UNKNOWN", "UNKNOWN"],
    ]),
  );

  t.set(
    "CAPTURE_REQUESTED",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["CAPTURE_COMPLETED", "CAPTURED"],
      ["PROVIDER_ERROR", "FAILED"],
      ["OUTCOME_UNKNOWN", "UNKNOWN"],
    ]),
  );

  t.set(
    "CAPTURED",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["WEBHOOK_CONFIRMED", "CONFIRMED"],
      ["PROVIDER_ERROR", "FAILED"],
    ]),
  );

  t.set(
    "CONFIRMED",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["RECONCILED_OK", "RECONCILED"],
      ["RECONCILED_FAILED", "FAILED"],
    ]),
  );

  // UNKNOWN: resolved by querying the provider
  t.set(
    "UNKNOWN",
    new Map<PaymentMandateEvent, PaymentMandateState>([
      ["RECONCILED_OK", "CAPTURED"],
      ["RECONCILED_FAILED", "FAILED"],
    ]),
  );

  // Terminal states
  t.set("RECONCILED", new Map());
  t.set("FAILED", new Map());

  return { transitions: t };
}

export const PAYMENT_MACHINE = buildPaymentMachine();

// ─── transition() ─────────────────────────────────────────────────────────────

export interface IllegalTransition<S extends string, E extends string> {
  readonly from: S;
  readonly event: E;
  readonly reason: "UNKNOWN_STATE" | "ILLEGAL_TRANSITION";
}

/**
 * Apply an event to a state machine.
 *
 * Returns Ok<NextState> if the transition is defined.
 * Returns Err<IllegalTransition> if:
 *   - `from` is not a known state in the machine (UNKNOWN_STATE)
 *   - the event is not allowed from `from` (ILLEGAL_TRANSITION)
 *
 * INVARIANT I-11: a missing or unknown state is NEVER treated as success.
 */
export function transition<S extends string, E extends string>(
  machine: StateMachine<S, E>,
  from: S,
  event: E,
): Result<S, IllegalTransition<S, E>> {
  const fromMap = machine.transitions.get(from);
  if (fromMap === undefined) {
    return err({ from, event, reason: "UNKNOWN_STATE" });
  }
  const next = fromMap.get(event);
  if (next === undefined) {
    return err({ from, event, reason: "ILLEGAL_TRANSITION" });
  }
  return ok(next);
}
