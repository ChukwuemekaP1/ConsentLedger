/**
 * evaluateGate — the centrepiece of the domain layer.
 *
 * Runs 8 checks in strict order, stops at the first failure.
 * Each check maps to a stable reason code (INVARIANTS.md).
 *
 * The GateApproval constructor is private to this file. It cannot be forged.
 *
 * INVARIANTS: I-01, I-02, I-05, I-11.
 * ARCHITECTURE.md §5 — The Gate.
 */

import { type Result, ok, err } from "../shared/result.js";
import type { GateApproval, GateDenial, VerifiedConsent } from "./types.js";
import type {
  CartMandateTerms,
  IntentMandateTerms,
  PaymentMandateTerms,
  MandateTerms,
  Attestation,
} from "../mandate/types.js";
import { recomputeHash, requiredRoles } from "../mandate/attestation.js";
import { isWithinValidity } from "../mandate/validity.js";
import type { PolicyDocument, PolicyContext } from "../policy/policy.js";
import { evaluatePolicy, hashPolicy } from "../policy/policy.js";
import { verifyHash, type KeyObject } from "../crypto/signing.js";
import { timingSafeEqualHex, type Hash } from "../crypto/hash.js";
import type { Timestamp, Uuid } from "../shared/clock.js";
import type { Currency } from "../money/currency.js";

// ─── Private GateApproval constructor (not exported) ─────────────────────────

/**
 * _makeGateApproval is the only way to construct a GateApproval.
 * It is NOT exported from the module index. Only evaluateGate() uses it.
 * External code gets Err<GateDenial> or Ok<GateApproval> — never the constructor.
 */
function _makeGateApproval(
  paymentMandateTerms: GateApproval["paymentMandateTerms"],
  approvedAt: Timestamp,
): GateApproval {
  // The brand is a unique symbol declared in types.ts; we cast here because
  // the constructor must live in the same layer. The cast is safe because
  // only this function can produce the shaped object.
  return {
    paymentMandateTerms,
    approvedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as GateApproval;
}

// ─── Trusted key registry ─────────────────────────────────────────────────────

/**
 * TrustedKey — a role-scoped public key entry.
 * A merchant key cannot satisfy the authority role, and vice versa.
 */
export interface TrustedKey {
  readonly role: "AUTHORITY" | "MERCHANT";
  readonly publicKey: KeyObject;
}

/** Map from keyId (hex) to role-scoped public key. */
export type TrustedKeys = ReadonlyMap<string, TrustedKey>;

// ─── Budget snapshot (for intent mandates) ────────────────────────────────────

export interface BudgetSnapshot {
  readonly totalBudgetMinor: number;
  readonly spentMinor: number;
  readonly reservedMinor: number;
  readonly txCount: number;
  readonly maxTransactions: number;
  readonly perTxMaxMinor: number;
}

// ─── Spend request ────────────────────────────────────────────────────────────

export interface IntentSpendRequest {
  readonly merchantId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
}

// ─── Mandate record (stored) ──────────────────────────────────────────────────

export interface StoredMandateRecord {
  readonly terms: CartMandateTerms | IntentMandateTerms;
  readonly hash: string;
  readonly attestations: readonly Attestation[];
  /** Current status in the state machine. */
  readonly status: string;
}

// ─── GateInput ────────────────────────────────────────────────────────────────

export interface GateInput {
  /** The stored mandate record (terms + hash + attestations + status). */
  readonly mandate: StoredMandateRecord;
  /** Verified consent from the passkey assertion (null if not yet consented). */
  readonly consent: VerifiedConsent | null;
  /**
   * Trusted public keys indexed by keyId.
   * Role-scoped: a MERCHANT key cannot satisfy an AUTHORITY check.
   */
  readonly trustedKeys: TrustedKeys;
  /**
   * The policy hash that was embedded in the mandate terms at signing time.
   * Used for policy drift detection (check 6).
   */
  readonly pinnedPolicy: PolicyDocument;
  /** The current active policy (may differ from the pinned one). */
  readonly currentPolicy: PolicyDocument;
  /** Current time from the injected Clock. */
  readonly now: Timestamp;
  /**
   * For cart mandates: the requested terms (must match stored terms exactly).
   * For intent mandates: the spend being requested.
   */
  readonly spendRequest: CartMandateTerms | IntentSpendRequest;
  /** Budget snapshot for intent mandates. Null for cart mandates. */
  readonly budgetSnapshot: BudgetSnapshot | null;
  /**
   * How many payment mandates already exist for this mandate.
   * For cart: must be 0 (single-use). For intent: used with tx cap.
   */
  readonly existingPaymentMandateCount: number;
  /**
   * Sequence number to assign to the derived payment mandate.
   * For cart: always 1. For intent: existingPaymentMandateCount + 1.
   */
  readonly sequence: number;
  /** ID for the new payment mandate. */
  readonly paymentMandateId: Uuid;
}

// ─── evaluateGate ─────────────────────────────────────────────────────────────

/**
 * The Gate: 8 checks in strict order, first failure stops.
 *
 * Check 1: Mandate exists, status permits execution
 * Check 2: now within [notBefore, expiresAt)
 * Check 3: Recomputed hash equals stored hash
 * Check 4: All required attestations verify
 * Check 5: VerifiedConsent exists and challenge equals hash
 * Check 6: Pinned policy hash matches a known policy; current policy still allows
 * Check 7: Request terms match (cart) or fit scope+limits (intent)
 * Check 8: Single-use / budget available
 *
 * Returns Ok<GateApproval> — carries the PaymentMandateTerms for the provider.
 * Returns Err<GateDenial> — with check number and reason code.
 *
 * INVARIANT I-11: any unknown, missing or ambiguous input is DENY, never ALLOW.
 */
export function evaluateGate(input: GateInput): Result<GateApproval, GateDenial> {
  const { mandate, now } = input;
  const terms = mandate.terms;

  // ─── Check 1: Status permits execution ─────────────────────────────────────
  {
    const { status } = mandate;
    if (status === "REVOKED") {
      return err({ code: "MANDATE_REVOKED", check: 1, message: "Mandate has been revoked" });
    }
    const allowedStatuses = terms.kind === "CART" ? ["SIGNED"] : ["ACTIVE"];
    if (!allowedStatuses.includes(status)) {
      return err({
        code: "MANDATE_STATE_INVALID",
        check: 1,
        message: `Mandate status '${status}' does not permit execution`,
      });
    }
  }

  // ─── Check 2: Validity window ───────────────────────────────────────────────
  {
    if (!isWithinValidity(terms, now)) {
      return err({
        code: "MANDATE_EXPIRED",
        check: 2,
        message: "Mandate is outside its validity window",
      });
    }
  }

  // ─── Check 3: Hash integrity ────────────────────────────────────────────────
  {
    const recomputed = recomputeHash(terms);
    if (!recomputed.ok) {
      return err({ code: "HASH_MISMATCH", check: 3, message: "Failed to recompute mandate hash" });
    }
    if (!timingSafeEqualHex(recomputed.value, mandate.hash)) {
      return err({
        code: "HASH_MISMATCH",
        check: 3,
        message: "Recomputed hash does not match stored hash",
      });
    }
  }

  // ─── Check 4: Attestation verification ────────────────────────────────────
  {
    const required = requiredRoles(terms.kind);
    for (const role of required) {
      const attestation = mandate.attestations.find((a) => a.role === role);
      if (!attestation) {
        const code =
          role === "AUTHORITY" ? "AUTHORITY_SIGNATURE_INVALID" : "MERCHANT_SIGNATURE_INVALID";
        return err({ code, check: 4, message: `Missing ${role} attestation` });
      }
      // Look up the key — must match both keyId and role
      const trustedEntry = input.trustedKeys.get(attestation.keyId);
      if (!trustedEntry || trustedEntry.role !== role) {
        const code =
          role === "AUTHORITY" ? "AUTHORITY_SIGNATURE_INVALID" : "MERCHANT_SIGNATURE_INVALID";
        return err({
          code,
          check: 4,
          message: `No trusted key for ${role} keyId ${attestation.keyId}`,
        });
      }
      // Verify the signature
      const valid = verifyHash(mandate.hash as Hash, attestation.signature, trustedEntry.publicKey);
      if (!valid) {
        const code =
          role === "AUTHORITY" ? "AUTHORITY_SIGNATURE_INVALID" : "MERCHANT_SIGNATURE_INVALID";
        return err({ code, check: 4, message: `${role} signature verification failed` });
      }
    }
  }

  // ─── Check 5: Consent ─────────────────────────────────────────────────────
  {
    if (!input.consent) {
      return err({
        code: "CONSENT_MISSING",
        check: 5,
        message: "No verified consent for this mandate",
      });
    }
    if (!timingSafeEqualHex(input.consent.mandateHash, mandate.hash)) {
      return err({
        code: "CONSENT_INVALID",
        check: 5,
        message: "Consent challenge does not match mandate hash",
      });
    }
  }

  // ─── Check 6: Policy ───────────────────────────────────────────────────────
  {
    // The terms embed the policy id+hash at signing time
    const pinnedPolicyRef = terms.policy;

    // Verify the pinned policy hash matches the policy document we have
    const pinnedHash = hashPolicy(input.pinnedPolicy);
    if (!pinnedHash.ok || pinnedHash.value !== pinnedPolicyRef.hash) {
      return err({
        code: "POLICY_DRIFT",
        check: 6,
        message: "Pinned policy hash does not match known policy",
      });
    }

    // Build context for policy evaluation
    const policyCtx: PolicyContext = buildPolicyContext(terms, input);

    // Evaluate the PINNED policy (at signing time) — must still ALLOW
    const pinnedEval = evaluatePolicy(input.pinnedPolicy, policyCtx);
    if (pinnedEval.decision !== "ALLOW") {
      return err({
        code: "POLICY_DENIED",
        check: 6,
        message: `Pinned policy denied: ${pinnedEval.reasons.join(", ")}`,
      });
    }

    // Evaluate the CURRENT policy — if it now denies, it means policy tightened (drift)
    const currentEval = evaluatePolicy(input.currentPolicy, policyCtx);
    if (currentEval.decision !== "ALLOW") {
      return err({
        code: "POLICY_DRIFT",
        check: 6,
        message: `Current policy is stricter than at signing time: ${currentEval.reasons.join(", ")}`,
      });
    }
  }

  // ─── Check 7: Terms match ─────────────────────────────────────────────────
  {
    const checkResult = checkTermsMatch(terms, input);
    if (checkResult !== null) return checkResult;
  }

  // ─── Check 8: Single-use / budget ─────────────────────────────────────────
  {
    if (terms.kind === "CART") {
      if (input.existingPaymentMandateCount > 0) {
        return err({
          code: "REPLAY_DETECTED",
          check: 8,
          message: "Cart mandate has already been used",
        });
      }
    } else {
      // INTENT
      const budget = input.budgetSnapshot;
      if (!budget) {
        // Fail closed: no budget data = deny
        return err({ code: "BUDGET_EXCEEDED", check: 8, message: "No budget snapshot available" });
      }
      const spend = input.spendRequest as IntentSpendRequest;
      const newTotal = budget.spentMinor + budget.reservedMinor + spend.amountMinor;
      if (newTotal > budget.totalBudgetMinor) {
        return err({
          code: "BUDGET_EXCEEDED",
          check: 8,
          message: `Budget would be exceeded: ${newTotal} > ${budget.totalBudgetMinor}`,
        });
      }
      if (budget.txCount >= budget.maxTransactions) {
        return err({
          code: "TX_CAP_EXCEEDED",
          check: 8,
          message: `Transaction count cap reached: ${budget.txCount} >= ${budget.maxTransactions}`,
        });
      }
    }
  }

  // ─── All checks passed: derive payment mandate and issue GateApproval ─────
  const paymentTerms = derivePaymentTerms(terms, input);
  return ok(_makeGateApproval(paymentTerms, now));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPolicyContext(
  terms: CartMandateTerms | IntentMandateTerms,
  input: GateInput,
): PolicyContext {
  if (terms.kind === "CART") {
    return {
      amountMinor: terms.payment.amountMinor,
      currency: terms.payment.currency,
      merchantId: terms.payee.merchantId,
    };
  } else {
    const spend = input.spendRequest as IntentSpendRequest;
    return {
      amountMinor: spend.amountMinor,
      currency: spend.currency,
      merchantId: spend.merchantId,
    };
  }
}

function checkTermsMatch(
  terms: CartMandateTerms | IntentMandateTerms,
  input: GateInput,
): Result<GateApproval, GateDenial> | null {
  if (terms.kind === "CART") {
    const requested = input.spendRequest as CartMandateTerms;
    // For a cart, the requested terms must equal the stored terms exactly.
    // We check the fields that define the payment.
    if (
      requested.payment.amountMinor !== terms.payment.amountMinor ||
      requested.payment.currency !== terms.payment.currency ||
      requested.payee.merchantId !== terms.payee.merchantId
    ) {
      return err({
        code: "TERMS_MISMATCH",
        check: 7,
        message: "Requested cart terms do not match stored terms",
      });
    }
  } else {
    // INTENT
    const spend = input.spendRequest as IntentSpendRequest;
    if (!terms.scope.merchantIds.includes(spend.merchantId)) {
      return err({
        code: "MERCHANT_NOT_ALLOWED",
        check: 7,
        message: `Merchant ${spend.merchantId} not in intent scope`,
      });
    }
    if (spend.currency !== terms.scope.currency) {
      return err({
        code: "CURRENCY_NOT_ALLOWED",
        check: 7,
        message: `Currency ${spend.currency} not allowed by intent scope`,
      });
    }
    if (spend.amountMinor > terms.limits.perTxMaxMinor) {
      return err({
        code: "TX_CAP_EXCEEDED",
        check: 7,
        message: `Amount ${spend.amountMinor} exceeds per-tx max ${terms.limits.perTxMaxMinor}`,
      });
    }
    if (spend.amountMinor > terms.limits.stepUpAboveMinor) {
      return err({
        code: "STEP_UP_REQUIRED",
        check: 7,
        message: `Amount requires step-up: ${spend.amountMinor} > stepUpAboveMinor ${terms.limits.stepUpAboveMinor}`,
      });
    }
  }
  return null; // pass
}

function derivePaymentTerms(
  terms: CartMandateTerms | IntentMandateTerms,
  input: GateInput,
): PaymentMandateTerms {
  if (terms.kind === "CART") {
    return {
      v: 1,
      kind: "PAYMENT",
      id: input.paymentMandateId,
      correlationId: terms.correlationId,
      parent: { mandateId: terms.id, hash: input.mandate.hash, kind: "CART" },
      modality: "HP",
      sequence: input.sequence,
      payee: { merchantId: terms.payee.merchantId },
      payment: { amountMinor: terms.payment.amountMinor, currency: terms.payment.currency },
      agentId: terms.agent.id,
      createdAt: input.now,
    };
  } else {
    const spend = input.spendRequest as IntentSpendRequest;
    return {
      v: 1,
      kind: "PAYMENT",
      id: input.paymentMandateId,
      correlationId: terms.correlationId,
      parent: { mandateId: terms.id, hash: input.mandate.hash, kind: "INTENT" },
      modality: "HNP",
      sequence: input.sequence,
      payee: { merchantId: spend.merchantId },
      payment: { amountMinor: spend.amountMinor, currency: spend.currency },
      agentId: terms.agent.id,
      createdAt: input.now,
    };
  }
}
