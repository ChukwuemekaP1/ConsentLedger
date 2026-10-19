/**
 * Gate types: GateApproval (branded capability), GateDenial, VerifiedConsent.
 *
 * GateApproval: constructor NOT exported. Only evaluateGate() can produce one.
 * This enforces I-01 at the type level: no payment without a Gate pass.
 *
 * VerifiedConsent: declared here. Its real constructor lives in issue 4 (passkey
 * verification). A test-only factory is in tests/fakes/.
 *
 * INVARIANT: I-01 — GateApproval is the capability required by the settlement port.
 * INVARIANT: I-05 — VerifiedConsent is bound to one hash.
 * ARCHITECTURE.md §5.
 */

import type { Brand } from "../shared/brand.js";
import type { PaymentMandateTerms } from "../mandate/types.js";
import type { Timestamp } from "../shared/clock.js";

// ─── VerifiedConsent ──────────────────────────────────────────────────────────

/**
 * VerifiedConsent — proof that a principal verified a specific mandate hash.
 *
 * The brand prevents arbitrary plain objects from being passed as consent.
 * The real constructor (verifyPasskeyConsent) lives in issue 4 (domain/consent).
 * A test-only factory is in tests/fakes/make-verified-consent.ts.
 *
 * I-05: "A consent is valid only if the challenge equals the mandate hash."
 */
declare const _verifiedConsentBrand: unique symbol;

export type VerifiedConsent = {
  readonly mandateHash: string;
  readonly credentialId: string;
  readonly verifiedAt: Timestamp;
  readonly [_verifiedConsentBrand]: "VerifiedConsent";
};

// ─── GateApproval ─────────────────────────────────────────────────────────────

/**
 * GateApproval — capability proving the Gate passed for a specific payment.
 *
 * The constructor (_makeGateApproval) is NOT exported from domain/gate/index.ts.
 * It is used only inside gate.ts (evaluateGate). Downstream code cannot forge one.
 *
 * Carries paymentMandateTerms so the provider receives the signed amount, not the
 * request amount. (I-02: "The amount PayPal receives equals the signed terms.")
 *
 * A minimal SettlementRequest (declared here for compile-time proof) requires this type.
 */
declare const _gateApprovalBrand: unique symbol;

export type GateApproval = {
  readonly paymentMandateTerms: PaymentMandateTerms;
  readonly approvedAt: Timestamp;
  readonly [_gateApprovalBrand]: "GateApproval";
};

// ─── GateDenial ───────────────────────────────────────────────────────────────

export type GateDenialCode =
  | "MANDATE_NOT_FOUND"
  | "MANDATE_STATE_INVALID"
  | "MANDATE_REVOKED"
  | "MANDATE_EXPIRED"
  | "HASH_MISMATCH"
  | "AUTHORITY_SIGNATURE_INVALID"
  | "MERCHANT_SIGNATURE_INVALID"
  | "CONSENT_MISSING"
  | "CONSENT_INVALID"
  | "POLICY_DENIED"
  | "POLICY_DRIFT"
  | "TERMS_MISMATCH"
  | "MERCHANT_NOT_ALLOWED"
  | "CURRENCY_NOT_ALLOWED"
  | "TX_CAP_EXCEEDED"
  | "STEP_UP_REQUIRED"
  | "REPLAY_DETECTED"
  | "BUDGET_EXCEEDED";

export interface GateDenial {
  /** Stable reason code, part of the public API. */
  readonly code: GateDenialCode;
  /** Which check (1–8) failed. */
  readonly check: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Human-readable message. No secrets. */
  readonly message: string;
}

// ─── SettlementRequest (minimal, for compile-time proof) ─────────────────────

/**
 * A minimal SettlementRequest that proves at compile time that the payment
 * provider requires a GateApproval, not a plain object.
 *
 * The real SettlementRequest is defined in application/ports.
 * This copy is here so the Gate's capability contract can be tested without
 * importing application code from the domain layer.
 */
export interface SettlementRequest {
  readonly approval: GateApproval;
}
