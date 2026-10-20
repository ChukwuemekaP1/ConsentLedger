/**
 * Security Lab & Adversarial Scenario types.
 *
 * Provides a structured, typed model for executing reproducible adversarial attacks
 * against the real domain Gate and application use cases.
 *
 * ARCHITECTURE.md §5, §6
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09.
 */

import type { Clock, IdGenerator, Timestamp } from "../../domain/shared/clock.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { PaymentMandateRepo } from "../ports/payment-mandate-repo.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { AppendLedgerEvent } from "../usecases/append-ledger-event.js";
import type { LedgerRepo } from "../ports/ledger-repo.js";
import type { TrustedKeys } from "../../domain/gate/index.js";
import type { KeyObject } from "node:crypto";
import type { InstrumentedPaymentProvider } from "./instrumented-payment-provider.js";

export type SecurityScenarioId =
  | "control-valid-purchase"
  | "amount-manipulation"
  | "merchant-substitution"
  | "currency-substitution"
  | "prompt-injection"
  | "reuse-consumed-approval"
  | "expired-mandate"
  | "changed-mandate-consent"
  | "evidence-bundle-tampering";

export type ScenarioCategory =
  | "CONTROL"
  | "TAMPERING"
  | "SUBSTITUTION"
  | "POLICY_VIOLATION"
  | "INJECTION"
  | "REPLAY"
  | "EXPIRATION"
  | "INTEGRITY";

export type ScenarioRunStatus = "PASSED" | "FAILED" | "SETUP_ERROR";

export type SecurityDecision = "ALLOWED" | "BLOCKED";

export interface ValueMetrics {
  readonly currency: string;
  /** Total value attempted or requested by the actor. */
  readonly attemptedAmountMinor: number;
  /** Value legitimately authorized under approved terms. */
  readonly authorizedAmountMinor: number;
  /** Amount attempted in excess of the policy limit or mandate. */
  readonly amountAbovePolicyMinor?: number | undefined;
  /**
   * Actual financial loss prevented by blocking the request.
   *
   * Note: Only populated if funds were actively at risk (e.g. an approved
   * or in-flight authorization was inflated or replayed). An unapproved chat
   * suggestion or invalid format is NOT labeled as realized savings.
   */
  readonly realizedSavingsMinor?: number | undefined;
  /** Explanation of how the savings was calculated. */
  readonly savingsRationale?: string | undefined;
}

export interface EvidenceReference {
  readonly type:
    "MANDATE" | "CONSENT" | "PAYMENT" | "LEDGER_EVENT" | "EVIDENCE_BUNDLE" | "PROVIDER_CALL";
  readonly id?: string | undefined;
  readonly hash?: string | undefined;
  readonly description: string;
}

export interface ScenarioResult {
  readonly scenarioId: SecurityScenarioId;
  readonly correlationId?: string | undefined;
  readonly name: string;
  readonly category: ScenarioCategory;
  readonly description: string;
  readonly invariant: string;
  readonly runStatus: ScenarioRunStatus;
  readonly decision: SecurityDecision;
  readonly expectedDecision: SecurityDecision;
  readonly reasonCode: string;
  readonly expectedReasonCode: string;
  readonly captureAttempted: boolean;
  readonly captureCallCount: number;
  readonly setupError?: string | undefined;
  readonly valueMetrics?: ValueMetrics | undefined;
  readonly evidenceReferences?: readonly EvidenceReference[] | undefined;
  readonly executionTimeMs: number;
  readonly notes?: string | undefined;
}

export interface LabContext {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly mandateRepo: MandateRepo;
  readonly paymentMandateRepo: PaymentMandateRepo;
  readonly paymentProvider: InstrumentedPaymentProvider;
  readonly trustedKeys: TrustedKeys;
  readonly authorityKeyPair: {
    readonly privateKey: KeyObject;
    readonly publicKey: KeyObject;
  };
  readonly merchantKeyPair?:
    | {
        readonly privateKey: KeyObject;
        readonly publicKey: KeyObject;
      }
    | undefined;
  readonly passkeyRepo?: PasskeyRepo | undefined;
  readonly webauthnConfig?: { readonly rpId: string; readonly origin: string } | undefined;
  readonly unitOfWork?: UnitOfWork | undefined;
  readonly appendLedgerEvent?: AppendLedgerEvent | undefined;
  readonly ledgerRepo?: LedgerRepo | undefined;
}

export interface SecurityScenario {
  readonly id: SecurityScenarioId;
  readonly name: string;
  readonly category: ScenarioCategory;
  readonly description: string;
  readonly targetInvariant: string;
  readonly expectedDecision: SecurityDecision;
  readonly expectedReasonCode: string;

  /**
   * Run the adversarial scenario against the real application/domain boundary.
   */
  run(context: LabContext): Promise<ScenarioResult>;
}
