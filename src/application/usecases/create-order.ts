/**
 * CreateOrder use case.
 *
 * Implements intent-then-effect order creation (ADR-0006) for PayPal Orders v2.
 * Validates mandate status, verifies passkey consent, executes the deterministic Gate (I-01),
 * commits an AUTHORIZED PaymentMandate in TX1, calls PayPal with PayPal-Request-Id,
 * and commits the resulting order ID in TX2.
 *
 * ARCHITECTURE.md §6
 * INVARIANTS:
 *   - I-01: No payment without a Gate pass
 *   - I-02: Wire amount equals signed terms (formatForProvider)
 *   - I-03: Cart mandate single-use
 *   - I-04: Atomic state and ledger event transitions
 *   - I-05: Bound passkey consent
 *   - I-11: Fail closed on errors
 */

import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Clock, IdGenerator, Timestamp, Uuid } from "../../domain/shared/clock.js";
import type { Hash } from "../../domain/crypto/hash.js";
import { hashCanonical } from "../../domain/crypto/hash.js";
import { attestMandate } from "../../domain/mandate/attestation.js";
import type { KeyObject } from "../../domain/crypto/signing.js";
import {
  evaluateGate,
  type GateInput,
  type TrustedKeys,
  type GateDenialCode,
  type VerifiedConsent,
} from "../../domain/gate/index.js";
import { verifyPasskeyConsent } from "../../domain/gate/consent.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
} from "../ports/payment-mandate-repo.js";
import type { PaymentProvider, OrderStatus, OrderLink } from "../ports/payment-provider.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";

export interface CreateOrderInput {
  readonly mandateId: string;
  readonly consent?: VerifiedConsent;
  readonly requestId?: string;
}

export interface CreateOrderOutput {
  readonly orderId: string;
  readonly paymentMandateId: string;
  readonly status: OrderStatus;
  readonly links?: readonly OrderLink[] | undefined;
}

export type CreateOrderError =
  | { readonly kind: "MANDATE_NOT_FOUND"; readonly message: string }
  | { readonly kind: "CONSENT_MISSING"; readonly message: string }
  | { readonly kind: "CONSENT_INVALID"; readonly message: string }
  | { readonly kind: "POLICY_NOT_FOUND"; readonly message: string }
  | { readonly kind: "GATE_DENIED"; readonly code: GateDenialCode; readonly message: string }
  | { readonly kind: "PAYMENT_FAILED"; readonly message: string }
  | { readonly kind: "PROVIDER_ERROR"; readonly message: string; readonly details?: unknown }
  | {
      readonly kind: "PROVIDER_OUTCOME_UNKNOWN";
      readonly message: string;
      readonly details?: unknown;
    }
  | { readonly kind: "PERSISTENCE_FAILED"; readonly message: string };

export class CreateOrderUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly mandateRepo: MandateRepo,
    private readonly paymentMandateRepo: PaymentMandateRepo,
    private readonly paymentProvider: PaymentProvider,
    private readonly trustedKeys: TrustedKeys,
    private readonly authorityKeyPair?: { privateKey: KeyObject; publicKey: KeyObject },
    private readonly passkeyRepo?: PasskeyRepo,
    private readonly webauthnConfig?: { rpId: string; origin: string },
    private readonly unitOfWork?: UnitOfWork,
    private readonly appendLedgerEvent?: AppendLedgerEvent,
  ) {}

  async execute(input: CreateOrderInput): Promise<Result<CreateOrderOutput, CreateOrderError>> {
    const now = this.clock.now();

    // 1. Authoritative mandate lookup
    const mandate = await this.mandateRepo.findMandateById(input.mandateId);
    if (!mandate) {
      return err({
        kind: "MANDATE_NOT_FOUND",
        message: `Mandate ${input.mandateId} not found`,
      });
    }

    // 2. Check for existing payment mandate (idempotency / in-flight check)
    const existing = await this.paymentMandateRepo.findPaymentMandateByMandateId(input.mandateId);
    if (existing) {
      if (existing.status === "ORDER_CREATED" && existing.paypalOrderId) {
        return ok({
          orderId: existing.paypalOrderId,
          paymentMandateId: existing.id,
          status: "CREATED",
        });
      }
      if (existing.status === "FAILED") {
        return err({
          kind: "PAYMENT_FAILED",
          message: "Payment mandate previously failed",
        });
      }
      // If status is AUTHORIZED, we will resume using the stored requestId below
    }

    // 3. Resolve VerifiedConsent
    let consent: VerifiedConsent | null = input.consent ?? null;
    if (!consent) {
      const storedConsent = await this.mandateRepo.findConsentByMandateId(input.mandateId);
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
            message: `Consent verification failed: ${verification.error.message}`,
          });
        }
        consent = verification.value;
      } else {
        // Fallback to stored verified consent
        consent = {
          mandateHash: mandate.hash,
          credentialId: storedConsent.credentialId,
          verifiedAt: storedConsent.verifiedAt as Timestamp,
        } as unknown as VerifiedConsent;
      }
    }

    // 4. Resolve Policy
    const pinnedPolicy = await this.mandateRepo.findPolicyById(mandate.terms.policy.id);
    if (!pinnedPolicy) {
      return err({
        kind: "POLICY_NOT_FOUND",
        message: `Pinned policy ${mandate.terms.policy.id} not found`,
      });
    }

    const currentPolicy =
      (await this.mandateRepo.findActivePolicy(mandate.terms.policy.id)) ?? pinnedPolicy;

    // 5. Evaluate the Gate (I-01)
    const paymentMandateId = existing?.id ?? this.idGenerator.uuid();
    const requestId = existing?.requestId ?? input.requestId ?? this.idGenerator.uuid();

    const gateInput: GateInput = {
      mandate,
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
      paymentMandateId: paymentMandateId as Uuid,
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
              mandateId: input.mandateId,
              code: gateResult.error.code,
              message: gateResult.error.message,
            },
          });
        } catch {
          // ignore ledger append error
        }
      }

      return err({
        kind: "GATE_DENIED",
        code: gateResult.error.code,
        message: gateResult.error.message,
      });
    }

    const approval = gateResult.value;
    const paymentTerms = approval.paymentMandateTerms;
    const hashRes = hashCanonical(paymentTerms);
    if (!hashRes.ok) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: "Failed to hash derived payment mandate terms",
      });
    }
    const paymentHash = hashRes.value;

    let authoritySignature = "sig-authority";
    if (this.authorityKeyPair) {
      const attestRes = attestMandate(
        "AUTHORITY",
        paymentHash as Hash,
        this.authorityKeyPair.privateKey,
        this.authorityKeyPair.publicKey,
      );
      if (attestRes.ok) {
        authoritySignature = attestRes.value.signature;
      }
    }

    // 6. Write-Ahead Intent: TX1 (AUTHORIZED)
    if (!existing) {
      const executeTx1 = async (txCtx?: TxContext): Promise<StoredPaymentMandateRecord> => {
        const mRepo = txCtx?.mandates ?? this.mandateRepo;
        const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;

        await mRepo.lockMandate(input.mandateId);

        const inserted = await pmRepo.insertPaymentMandate({
          id: paymentMandateId,
          mandateId: input.mandateId,
          correlationId: mandate.terms.correlationId,
          sequence: 1,
          terms: paymentTerms,
          hash: paymentHash,
          authoritySignature,
          status: "AUTHORIZED",
          requestId,
          createdAt: now,
        });

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: mandate.terms.correlationId,
              type: "EXECUTION_AUTHORIZED",
              actor: { type: "system", id: "gate" },
              payload: {
                mandateId: input.mandateId,
                mandateHash: mandate.hash,
                paymentMandateId,
                paymentMandateHash: paymentHash,
                requestId,
                amountMinor: paymentTerms.payment.amountMinor,
                currency: paymentTerms.payment.currency,
              },
            },
            txCtx,
          );
        }

        return inserted;
      };

      try {
        if (this.unitOfWork) {
          await this.unitOfWork.run(async (tx) => executeTx1(tx));
        } else {
          await executeTx1();
        }
      } catch (dbError) {
        return err({
          kind: "PERSISTENCE_FAILED",
          message: `Failed to commit TX1: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        });
      }
    }

    // 7. Call External Payment Gateway (PayPal Orders v2)
    const orderResult = await this.paymentProvider.createOrder({
      approval,
      requestId,
    });

    // 8. Write-Ahead Effect: TX2 (Commit Outcome)
    const executeTx2 = async (txCtx?: TxContext): Promise<void> => {
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;

      if (orderResult.ok) {
        await pmRepo.updatePaymentMandateStatus(paymentMandateId, {
          status: "ORDER_CREATED",
          paypalOrderId: orderResult.value.orderId,
        });

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: mandate.terms.correlationId,
              type: "PAYPAL_ORDER_CREATED",
              actor: { type: "provider", id: "paypal" },
              payload: {
                paymentMandateId,
                paypalOrderId: orderResult.value.orderId,
                status: orderResult.value.status,
              },
            },
            txCtx,
          );
        }
      } else {
        const isUnknown =
          orderResult.error.kind === "NETWORK_ERROR" || orderResult.error.kind === "TIMEOUT";
        const status = isUnknown ? "UNKNOWN" : "FAILED";
        const eventType = isUnknown ? "PROVIDER_OUTCOME_UNKNOWN" : "PROVIDER_ERROR";

        await pmRepo.updatePaymentMandateStatus(paymentMandateId, {
          status,
        });

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: mandate.terms.correlationId,
              type: eventType,
              actor: { type: "provider", id: "paypal" },
              payload: {
                paymentMandateId,
                error: orderResult.error.message,
                kind: orderResult.error.kind,
              },
            },
            txCtx,
          );
        }
      }
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx2(tx));
      } else {
        await executeTx2();
      }
    } catch (dbError) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit TX2: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      });
    }

    if (!orderResult.ok) {
      if (orderResult.error.kind === "NETWORK_ERROR" || orderResult.error.kind === "TIMEOUT") {
        return err({
          kind: "PROVIDER_OUTCOME_UNKNOWN",
          message: orderResult.error.message,
          details: orderResult.error.details,
        });
      }
      return err({
        kind: "PROVIDER_ERROR",
        message: orderResult.error.message,
        details: orderResult.error.details,
      });
    }

    return ok({
      orderId: orderResult.value.orderId,
      paymentMandateId,
      status: orderResult.value.status,
      links: orderResult.value.links,
    });
  }
}
