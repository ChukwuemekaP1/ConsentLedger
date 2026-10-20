/**
 * Scenario 3: Merchant Substitution After Approval.
 *
 * An attacker attempts to divert payment to an unauthorized merchant ID after
 * human consent was obtained for the legitimate merchant.
 * The Gate detects terms mismatch and aborts execution before capture (I-01, I-02).
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { CaptureOrderUseCase } from "../../usecases/capture-order.js";
import {
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
} from "../fixtures.js";
import type { PaymentMandateTerms } from "../../../domain/mandate/types.js";

export class MerchantSubstitutionScenario implements SecurityScenario {
  readonly id = "merchant-substitution" as const;
  readonly name = "Merchant Substitution: Payee Diversion Attack";
  readonly category = "SUBSTITUTION" as const;
  readonly description =
    "An attacker attempts to substitute the payee merchant from Acme Corp to an attacker-controlled merchant ID. Blocked with TERMS_MISMATCH before capture.";
  readonly targetInvariant = "I-02: Amount and payee PayPal receives equals the signed terms";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "TERMS_MISMATCH";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Setup legitimate $85 mandate for Acme Corp
    const { policy, policyHash } = createStandardPolicy();
    const cartTerms = createStandardCartTerms(policyHash, context.clock, context.idGenerator);
    const mandateRecord = buildStandardAttestedMandate(cartTerms, {
      authorityKeyPair: { ...context.authorityKeyPair, keyId: "auth-key" },
      merchantKeyPair: {
        ...(context.merchantKeyPair ?? context.authorityKeyPair),
        keyId: "merch-key",
      },
      trustedKeys: context.trustedKeys,
    });

    const consent = makeSyntheticVerifiedConsent(mandateRecord.hash);

    await context.mandateRepo.createMandate({
      id: cartTerms.id,
      kind: "CART",
      correlationId: cartTerms.correlationId,
      principalId: cartTerms.principalId,
      agentId: cartTerms.agent.id,
      terms: cartTerms,
      hash: mandateRecord.hash,
      attestations: mandateRecord.attestations,
      status: "SIGNED",
      expiresAt: cartTerms.validity.expiresAt,
      createdAt: context.clock.now(),
    });

    await context.mandateRepo.saveConsent({
      id: context.idGenerator.uuid(),
      mandateId: cartTerms.id,
      credentialId: consent.credentialId,
      authenticatorData: "{}",
      clientDataJson: "{}",
      signature: "{}",
      verifiedAt: consent.verifiedAt,
      createdAt: context.clock.now(),
    });

    // 2. Attack: A rogue payment mandate with substituted payee is submitted for capture under rogueOrderId
    const rogueOrderId = `ROGUE-MERCHANT-${context.idGenerator.uuid().slice(0, 8)}`;
    const substitutedPayeeTerms: PaymentMandateTerms = {
      v: 1,
      kind: "PAYMENT",
      id: context.idGenerator.uuid(),
      correlationId: cartTerms.correlationId,
      parent: {
        mandateId: cartTerms.id,
        hash: mandateRecord.hash,
        kind: "CART",
      },
      sequence: 1,
      modality: "HP",
      payee: {
        merchantId: "attacker-rogue-merchant-id",
      },
      payment: cartTerms.payment,
      agentId: cartTerms.agent.id,
      createdAt: context.clock.now(),
    };

    const insertedRoguePm = await context.paymentMandateRepo.insertPaymentMandate({
      id: substitutedPayeeTerms.id,
      mandateId: cartTerms.id,
      correlationId: cartTerms.correlationId,
      sequence: 1,
      terms: substitutedPayeeTerms,
      hash: context.idGenerator.uuid().replace(/-/g, "").repeat(2),
      authoritySignature: "rogue-sig",
      status: "ORDER_CREATED",
      requestId: context.idGenerator.uuid(),
      createdAt: context.clock.now(),
    });

    await context.paymentMandateRepo.updatePaymentMandateStatus(insertedRoguePm.id, {
      status: "ORDER_CREATED",
      paypalOrderId: rogueOrderId,
    });

    // 3. Capture Order
    const captureOrderUc = new CaptureOrderUseCase(
      context.clock,
      context.idGenerator,
      context.mandateRepo,
      context.paymentMandateRepo,
      context.paymentProvider,
      context.trustedKeys,
      context.passkeyRepo,
      context.webauthnConfig,
      context.unitOfWork,
      context.appendLedgerEvent,
    );

    const captureRes = await captureOrderUc.execute({
      orderId: rogueOrderId,
      mandateId: cartTerms.id,
      consent,
    });

    const captureCount = context.paymentProvider.getCaptureCallCount();
    context.paymentProvider.assertZeroCaptureCalls();

    const decision = captureRes.ok ? "ALLOWED" : "BLOCKED";
    const actualCode = captureRes.ok
      ? "OK"
      : captureRes.error.kind === "GATE_DENIED"
        ? captureRes.error.code
        : captureRes.error.kind;
    const passed =
      decision === this.expectedDecision &&
      (actualCode === "TERMS_MISMATCH" || actualCode === "MERCHANT_NOT_ALLOWED") &&
      captureCount === 0;

    return {
      scenarioId: this.id,
      correlationId: cartTerms.correlationId,
      name: this.name,
      category: this.category,
      description: this.description,
      invariant: this.targetInvariant,
      runStatus: passed ? "PASSED" : "FAILED",
      decision,
      expectedDecision: this.expectedDecision,
      reasonCode: actualCode,
      expectedReasonCode: this.expectedReasonCode,
      captureAttempted: captureCount > 0,
      captureCallCount: captureCount,
      valueMetrics: {
        currency: "USD",
        attemptedAmountMinor: 8500,
        authorizedAmountMinor: 0, // 0 authorized to the rogue merchant
        realizedSavingsMinor: 8500, // $85.00 diverted spend completely prevented
        savingsRationale:
          "Prevented $85.00 theft by blocking unauthorized merchant redirection before capture.",
      },
      evidenceReferences: [
        { type: "MANDATE", id: cartTerms.id, description: "Original Cart Mandate for Acme Corp" },
        {
          type: "PAYMENT",
          id: insertedRoguePm.id,
          description: "Substituted Payee (attacker-rogue-merchant-id)",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
