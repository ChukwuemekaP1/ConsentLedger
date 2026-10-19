/**
 * LedgerEvent types and catalog.
 *
 * Closed union of event types from ARCHITECTURE.md §8.1.
 * Events are the tamper-evident record of every state change (I-04).
 */

export const LEDGER_EVENT_TYPES = [
  "PASSKEY_REGISTERED",
  "PROPOSAL_CREATED",
  "POLICY_DENIED",
  "MANDATE_ISSUED",
  "CONSENT_RECORDED",
  "MANDATE_REVOKED",
  "MANDATE_EXPIRED",
  "EXECUTION_AUTHORIZED",
  "EXECUTION_DENIED",
  "PAYPAL_ORDER_CREATED",
  "CAPTURE_REQUESTED",
  "CAPTURE_COMPLETED",
  "PROVIDER_ERROR",
  "PROVIDER_OUTCOME_UNKNOWN",
  "WEBHOOK_RECEIVED",
  "WEBHOOK_REJECTED",
  "WEBHOOK_DUPLICATE_IGNORED",
  "SETTLEMENT_CONFIRMED",
  "RECONCILED_OK",
  "RECONCILED_MISMATCH",
  "BUDGET_RESERVED",
  "BUDGET_RELEASED",
  "BUDGET_EXHAUSTED",
  "CHECKPOINT_CREATED",
  "ATTACK_SIMULATED",
  "OPERATOR_QUERY",
  "SIMULATED_SETTLEMENT",
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export function isLedgerEventType(value: unknown): value is LedgerEventType {
  return typeof value === "string" && (LEDGER_EVENT_TYPES as readonly string[]).includes(value);
}

export interface LedgerActor {
  readonly type: "principal" | "agent" | "system" | "provider";
  readonly id: string;
}

/**
 * A ledger event as stored and verified.
 * Hashed fields: {id, correlationId, seq, type, actor, payload, createdAt}
 * These are the fields that form the canonical hash input (ARCHITECTURE.md §8.1).
 */
export interface LedgerEvent {
  readonly seq: number;
  readonly id: string;
  readonly correlationId: string;
  readonly type: LedgerEventType;
  readonly actor: LedgerActor;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
  readonly createdAt: string;
}

/**
 * A draft event before seq, prevHash and hash are computed.
 */
export interface LedgerEventDraft {
  readonly id?: string;
  readonly correlationId: string;
  readonly type: LedgerEventType;
  readonly actor: LedgerActor;
  readonly payload: Record<string, unknown>;
}
