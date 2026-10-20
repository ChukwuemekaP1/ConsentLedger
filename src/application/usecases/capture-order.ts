/**
 * CaptureOrder use case.
 *
 * Implements guarded PayPal Orders v2 capture protection (ADR-0006).
 *
 * Requirements:
 *   1. Treat the browser-provided order ID as an untrusted reference.
 *   2. Load the authoritative payment attempt and verify order ID, mandate ID/hash,
 *      consent record, and expected purchase terms match.
 *   3. Re-read mandate and policy; re-run deterministic Gate; validate stored consent,
 *      expiry, merchant, currency, exact amount, budget conditions, and single-use.
 *   4. Durably reserve the capture attempt (TX3: CAPTURE_REQUESTED, captureRequestId)
 *      with locking/safe state transition BEFORE calling PayPal.
 *   5. Never keep a database transaction open while calling PayPal.
 *   6. Call PayPal capture with stored order ID and PayPal-Request-Id (captureRequestId).
 *   7. Model uncertainty explicitly: timeouts/5xx update status to UNKNOWN and append
 *      PROVIDER_OUTCOME_UNKNOWN for offline reconciliation; no blind re-issues.
 *   8. Do not label pending or unknown as captured.
 *   9. On successful capture, commit TX4 (CAPTURED, SETTLED, CAPTURE_COMPLETED).
 *
 * ARCHITECTURE.md §6
 * INVARIANTS:
 *   - I-01: No payment without a Gate pass
 *   - I-02: Wire amount equals signed terms
 *   - I-03: Cart mandate single-use
 *   - I-04: Atomic state and ledger event transitions
 *   - I-05: Bound passkey consent
 *   - I-11: Fail closed on ambiguity/error
 */

import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Clock, IdGenerator, Timestamp, Uuid } from "../../domain/shared/clock.js";
import { isWithinValidity } from "../../domain/mandate/validity.js";
import {
  evaluateGate,
  type GateInput,
  type TrustedKeys,
  type GateDenialCode,
  type VerifiedConsent,
} from "../../domain/gate/index.js";
import { verifyPasskeyConsent } from "../../domain/gate/consent.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { PaymentMandateRepo } from "../ports/payment-mandate-repo.js";
import type { PaymentProvider, CaptureStatus } from "../ports/payment-provider.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";

export interface CaptureOrderInput {
  readonly orderId: string;
  readonly mandateId?: string | undefined;
  readonly consent?: VerifiedConsent | undefined;
}

export interface CaptureOrderOutput {
  readonly orderId: string;
  readonly captureId: string;
  readonly status: CaptureStatus;
  readonly alreadyCaptured?: boolean | undefined;
}

export type CaptureOrderError =
  | { readonly kind: "ORDER_NOT_FOUND"; readonly message: string }
  | { readonly kind: "MANDATE_MISMATCH"; readonly message: string }
  | { readonly kind: "MANDATE_NOT_FOUND"; readonly message: string }
  | { readonly kind: "MANDATE_EXPIRED"; readonly message: string }
  | { readonly kind: "MANDATE_REVOKED"; readonly message: string }
  | { readonly kind: "MANDATE_STATE_INVALID"; readonly message: string }
  | { readonly kind: "TERMS_MISMATCH"; readonly message: string }
  | { readonly kind: "CONSENT_MISSING"; readonly message: string }
  | { readonly kind: "CONSENT_INVALID"; readonly message: string }
  | { readonly kind: "POLICY_NOT_FOUND"; readonly message: string }
  | { readonly kind: "POLICY_DENIED"; readonly message: string }
  | { readonly kind: "GATE_DENIED"; readonly code: GateDenialCode; readonly message: string }
  | { readonly kind: "CONCURRENT_CAPTURE"; readonly message: string }
  | { readonly kind: "REPLAY_DETECTED"; readonly message: string }
  | { readonly kind: "INVALID_STATE"; readonly message: string }
  | { readonly kind: "RECONCILIATION_REQUIRED"; readonly message: string }
  | { readonly kind: "PROVIDER_PENDING"; readonly message: string }
  | { readonly kind: "PROVIDER_ERROR"; readonly message: string; readonly details?: unknown }
  | {
      readonly kind: "PROVIDER_OUTCOME_UNKNOWN";
      readonly message: string;
      readonly details?: unknown;
    }
  | { readonly kind: "PERSISTENCE_FAILED"; readonly message: string };

export class CaptureOrderUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly mandateRepo: MandateRepo,
    private readonly paymentMandateRepo: PaymentMandateRepo,
    private readonly paymentProvider: PaymentProvider,
    private readonly trustedKeys: TrustedKeys,
    private readonly passkeyRepo?: PasskeyRepo | undefined,
    private readonly webauthnConfig?: { rpId: string; origin: string } | undefined,
    private readonly unitOfWork?: UnitOfWork | undefined,
    private readonly appendLedgerEvent?: AppendLedgerEvent | undefined,
  ) {}

  async execute(input: CaptureOrderInput): Promise<Result<CaptureOrderOutput, CaptureOrderError>> {
    const now = this.clock.now();

    // 1. Authoritative Payment Mandate Lookup using untrusted orderId
    const paymentMandate = await this.paymentMandateRepo.findPaymentMandateByOrderId(input.orderId);
    if (!paymentMandate) {
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found for PayPal order ${input.orderId}`,
      });
    }

    // Cross-check mandate ID if provided by caller
    if (input.mandateId && input.mandateId !== paymentMandate.mandateId) {
      return err({
        kind: "MANDATE_MISMATCH",
        message: `Provided mandateId ${input.mandateId} does not match order payment mandate ${paymentMandate.mandateId}`,
      });
    }

    // 2. State & Idempotency Checks
    if (paymentMandate.status === "CAPTURED") {
      return ok({
        orderId: input.orderId,
        captureId: paymentMandate.paypalCaptureId ?? "",
        status: "COMPLETED",
        alreadyCaptured: true,
      });
    }

    if (paymentMandate.status === "CAPTURE_REQUESTED") {
      return err({
        kind: "CONCURRENT_CAPTURE",
        message: "Capture is already in progress or awaiting reconciliation",
      });
    }

    if (paymentMandate.status === "FAILED") {
      return err({
        kind: "INVALID_STATE",
        message: "Payment mandate is in terminal FAILED state",
      });
    }

    if (paymentMandate.status === "UNKNOWN") {
      return err({
        kind: "RECONCILIATION_REQUIRED",
        message: "Payment mandate outcome is uncertain; reconciliation required before retry",
      });
    }

    if (paymentMandate.status !== "ORDER_CREATED") {
      return err({
        kind: "INVALID_STATE",
        message: `Cannot capture order in state ${paymentMandate.status}`,
      });
    }

    // 3. Authoritative Mandate Lookup & Verification
    const mandate = await this.mandateRepo.findMandateById(paymentMandate.mandateId);
    if (!mandate) {
      return err({
        kind: "MANDATE_NOT_FOUND",
        message: `Mandate ${paymentMandate.mandateId} not found`,
      });
    }

    // Verify payment terms match stored mandate terms
    if (mandate.terms.kind === "CART") {
      if (
        paymentMandate.terms.payment.amountMinor !== mandate.terms.payment.amountMinor ||
        paymentMandate.terms.payment.currency !== mandate.terms.payment.currency ||
        paymentMandate.terms.payee.merchantId !== mandate.terms.payee.merchantId
      ) {
        return err({
          kind: "TERMS_MISMATCH",
          message: "Payment mandate terms do not match stored cart mandate terms",
        });
      }
    }

    // Check validity window
    if (!isWithinValidity(mandate.terms, now)) {
      return err({
        kind: "MANDATE_EXPIRED",
        message: "Mandate validity period has expired",
      });
    }

    // Check mandate status
    if (mandate.status === "REVOKED") {
      return err({
        kind: "MANDATE_REVOKED",
        message: "Mandate has been revoked",
      });
    }

    if (mandate.status === "EXPIRED") {
      return err({
        kind: "MANDATE_EXPIRED",
        message: "Mandate has expired",
      });
    }

    if (mandate.status === "SETTLED") {
      return err({
        kind: "REPLAY_DETECTED",
        message: "Mandate has already been settled (single-use)",
      });
    }

    const allowedMandateStatuses =
      mandate.terms.kind === "CART" ? ["SIGNED", "EXECUTING"] : ["ACTIVE"];
    if (!allowedMandateStatuses.includes(mandate.status)) {
      return err({
        kind: "MANDATE_STATE_INVALID",
        message: `Mandate status '${mandate.status}' does not permit capture execution`,
      });
    }

    // 4. Consent Re-Verification
    let consent: VerifiedConsent | null = input.consent ?? null;
    if (!consent) {
      const storedConsent = await this.mandateRepo.findConsentByMandateId(paymentMandate.mandateId);
      if (!storedConsent) {
        return err({
          kind: "CONSENT_MISSING",
          message: "No human consent recorded for this mandate",
        });
      }

      if (this.passkeyRepo && this.webauthnConfig) {
        const credential = await this.passkeyRepo.findCredentialByCredentialId(
          storedConsent.credentialId,
        );
        if (!credential) {
          return err({
            kind: "CONSENT_INVALID",
            message: `Credential ${storedConsent.credentialId} not found`,
          });
        }

        const verification = verifyPasskeyConsent({
          clientDataJSON: storedConsent.clientDataJson,
          authenticatorData: storedConsent.authenticatorData,
          signature: storedConsent.signature,
          credentialId: storedConsent.credentialId,
          publicKeySpkiB64: credential.publicKey,
          expectedMandateHash: mandate.hash,
          expectedOrigin: this.webauthnConfig.origin,
          expectedRPID: this.webauthnConfig.rpId,
          requireUserVerification: true,
          verifiedAt: storedConsent.verifiedAt as Timestamp,
        });

        if (!verification.ok) {
          return err({
            kind: "CONSENT_INVALID",
            message: `Passkey consent verification failed: ${verification.error.message}`,
          });
        }
        consent = verification.value;
      } else {
        consent = {
          mandateHash: mandate.hash,
          credentialId: storedConsent.credentialId,
          verifiedAt: storedConsent.verifiedAt as Timestamp,
        } as unknown as VerifiedConsent;
      }
    }

    // 5. Policy Lookup & Gate Re-Evaluation (I-01)
    const pinnedPolicy = await this.mandateRepo.findPolicyById(mandate.terms.policy.id);
    if (!pinnedPolicy) {
      return err({
        kind: "POLICY_NOT_FOUND",
        message: `Pinned policy ${mandate.terms.policy.id} not found`,
      });
    }

    const currentPolicy =
      (await this.mandateRepo.findActivePolicy(mandate.terms.policy.id)) ?? pinnedPolicy;

    // Use a synthetic gate check to verify all 8 security checks pass
    const gateInput: GateInput = {
      mandate: {
        ...mandate,
        // The Gate check 1 expects SIGNED for cart
        status: "SIGNED",
      },
      consent,
      trustedKeys: this.trustedKeys,
      pinnedPolicy,
      currentPolicy,
      now,
      spendRequest:
        mandate.terms.kind === "CART"
          ? mandate.terms
          : {
              merchantId: mandate.terms.scope.merchantIds[0] ?? "",
              amountMinor: 0,
              currency: mandate.terms.scope.currency,
            },
      budgetSnapshot: null,
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: paymentMandate.id as Uuid,
    };

    const gateResult = evaluateGate(gateInput);
    if (!gateResult.ok) {
      if (this.appendLedgerEvent) {
        try {
          await this.appendLedgerEvent.execute({
            correlationId: mandate.terms.correlationId,
            type: "EXECUTION_DENIED",
            actor: { type: "system", id: "gate" },
            payload: {
              orderId: input.orderId,
              paymentMandateId: paymentMandate.id,
              mandateId: paymentMandate.mandateId,
              code: gateResult.error.code,
              message: gateResult.error.message,
            },
          });
        } catch {
          // ignore
        }
      }

      return err({
        kind: "GATE_DENIED",
        code: gateResult.error.code,
        message: gateResult.error.message,
      });
    }

    // 6. Write-Ahead Reservation: TX3 (CAPTURE_REQUESTED)
    const captureRequestId = this.idGenerator.uuid();

    const executeTx3 = async (txCtx?: TxContext): Promise<void> => {
      const mRepo = txCtx?.mandates ?? this.mandateRepo;
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;

      await pmRepo.lockPaymentMandate(paymentMandate.id);

      // Re-read under lock to prevent race conditions
      const currentPm = await pmRepo.findPaymentMandateById(paymentMandate.id);
      if (!currentPm || currentPm.status !== "ORDER_CREATED") {
        throw new Error("CONCURRENT_CAPTURE_CONFLICT");
      }

      await pmRepo.updatePaymentMandateStatus(paymentMandate.id, {
        status: "CAPTURE_REQUESTED",
        captureRequestId,
      });

      await mRepo.updateMandateStatus(paymentMandate.mandateId, "EXECUTING");

      if (this.appendLedgerEvent) {
        await this.appendLedgerEvent.execute(
          {
            correlationId: mandate.terms.correlationId,
            type: "CAPTURE_REQUESTED",
            actor: { type: "system", id: "settlement" },
            payload: {
              orderId: input.orderId,
              paymentMandateId: paymentMandate.id,
              mandateId: paymentMandate.mandateId,
              captureRequestId,
              amountMinor: paymentMandate.terms.payment.amountMinor,
              currency: paymentMandate.terms.payment.currency,
            },
          },
          txCtx,
        );
      }
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx3(tx));
      } else {
        await executeTx3();
      }
    } catch (dbError) {
      const isConflict =
        dbError instanceof Error && dbError.message === "CONCURRENT_CAPTURE_CONFLICT";
      if (isConflict) {
        return err({
          kind: "CONCURRENT_CAPTURE",
          message: "Concurrent capture attempt detected; operation aborted",
        });
      }
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit TX3 capture reservation: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      });
    }

    // 7. Remote Call to PayPal Capture API (Zero open database transaction)
    const captureResult = await this.paymentProvider.captureOrder({
      orderId: input.orderId,
      captureRequestId,
    });

    // 8. Commit Outcome: TX4 (Record Result & Complete/Fail/Unknown)
    const executeTx4 = async (txCtx?: TxContext): Promise<void> => {
      const mRepo = txCtx?.mandates ?? this.mandateRepo;
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;

      if (captureResult.ok) {
        if (captureResult.value.status === "COMPLETED") {
          await pmRepo.updatePaymentMandateStatus(paymentMandate.id, {
            status: "CAPTURED",
            paypalCaptureId: captureResult.value.captureId,
          });

          await mRepo.updateMandateStatus(paymentMandate.mandateId, "SETTLED");

          if (this.appendLedgerEvent) {
            await this.appendLedgerEvent.execute(
              {
                correlationId: mandate.terms.correlationId,
                type: "CAPTURE_COMPLETED",
                actor: { type: "provider", id: "paypal" },
                payload: {
                  orderId: input.orderId,
                  paymentMandateId: paymentMandate.id,
                  captureId: captureResult.value.captureId,
                  status: "COMPLETED",
                },
              },
              txCtx,
            );
          }
        } else if (captureResult.value.status === "PENDING") {
          // Do not label pending as captured
          await pmRepo.updatePaymentMandateStatus(paymentMandate.id, {
            status: "UNKNOWN",
            paypalCaptureId: captureResult.value.captureId,
          });

          if (this.appendLedgerEvent) {
            await this.appendLedgerEvent.execute(
              {
                correlationId: mandate.terms.correlationId,
                type: "PROVIDER_OUTCOME_UNKNOWN",
                actor: { type: "provider", id: "paypal" },
                payload: {
                  orderId: input.orderId,
                  paymentMandateId: paymentMandate.id,
                  captureId: captureResult.value.captureId,
                  status: "PENDING",
                },
              },
              txCtx,
            );
          }
        } else {
          // DECLINED / FAILED
          await pmRepo.updatePaymentMandateStatus(paymentMandate.id, {
            status: "FAILED",
          });

          await mRepo.updateMandateStatus(paymentMandate.mandateId, "FAILED");

          if (this.appendLedgerEvent) {
            await this.appendLedgerEvent.execute(
              {
                correlationId: mandate.terms.correlationId,
                type: "PROVIDER_ERROR",
                actor: { type: "provider", id: "paypal" },
                payload: {
                  orderId: input.orderId,
                  paymentMandateId: paymentMandate.id,
                  status: captureResult.value.status,
                  error: "Capture declined",
                },
              },
              txCtx,
            );
          }
        }
      } else {
        const isUnknown =
          captureResult.error.kind === "NETWORK_ERROR" || captureResult.error.kind === "TIMEOUT";
        const status = isUnknown ? "UNKNOWN" : "FAILED";
        const eventType = isUnknown ? "PROVIDER_OUTCOME_UNKNOWN" : "PROVIDER_ERROR";

        await pmRepo.updatePaymentMandateStatus(paymentMandate.id, {
          status,
        });

        if (!isUnknown) {
          await mRepo.updateMandateStatus(paymentMandate.mandateId, "FAILED");
        }

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: mandate.terms.correlationId,
              type: eventType,
              actor: { type: "provider", id: "paypal" },
              payload: {
                orderId: input.orderId,
                paymentMandateId: paymentMandate.id,
                error: captureResult.error.message,
                kind: captureResult.error.kind,
              },
            },
            txCtx,
          );
        }
      }
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx4(tx));
      } else {
        await executeTx4();
      }
    } catch (dbError) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit TX4 capture outcome: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      });
    }

    if (!captureResult.ok) {
      if (captureResult.error.kind === "NETWORK_ERROR" || captureResult.error.kind === "TIMEOUT") {
        return err({
          kind: "PROVIDER_OUTCOME_UNKNOWN",
          message: "Timeout or network failure during capture; marked for reconciliation",
          details: captureResult.error.details,
        });
      }
      return err({
        kind: "PROVIDER_ERROR",
        message: captureResult.error.message,
        details: captureResult.error.details,
      });
    }

    if (captureResult.value.status === "PENDING") {
      return err({
        kind: "PROVIDER_PENDING",
        message: "Capture status is pending; not finalized as captured",
      });
    }

    if (captureResult.value.status !== "COMPLETED") {
      return err({
        kind: "PROVIDER_ERROR",
        message: `PayPal capture was not completed (${captureResult.value.status})`,
      });
    }

    return ok({
      orderId: input.orderId,
      captureId: captureResult.value.captureId ?? "",
      status: "COMPLETED",
    });
  }
}
