/**
 * Scenario 2: Amount Manipulation ($85 -> $850).
 *
 * An attacker attempts to escalate an approved $85 purchase to $850 after consent
 * was obtained. The Gate detects terms/hash mismatch and aborts execution before
 * any PayPal capture request can be made (I-01, I-02).
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

export class AmountManipulationScenario implements SecurityScenario {
  readonly id = "amount-manipulation" as const;
  readonly name = "Amount Manipulation: $85 to $850 Inflation";
  readonly category = "TAMPERING" as const;
  readonly description =
    "An attacker tampers with the payment execution terms, attempting to capture $850.00 on a mandate signed for $85.00. Must be rejected with TERMS_MISMATCH before PayPal capture.";
  readonly targetInvariant = "I-02: The amount PayPal receives equals the signed terms";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "TERMS_MISMATCH";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Legitimate $85 Cart Mandate
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

    // 2. Attack Setup: A payment mandate with inflated amount ($850.00) is submitted for capture under rogueOrderId
    const rogueOrderId = `ROGUE-ORDER-${context.idGenerator.uuid().slice(0, 8)}`;
    const tamperedPaymentTerms: PaymentMandateTerms = {
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
        merchantId: cartTerms.payee.merchantId,
      },
      payment: {
        amountMinor: 85000, // $850.00 (tampered!)
        currency: "USD",
      },
      agentId: cartTerms.agent.id,
      createdAt: context.clock.now(),
    };

    const insertedRoguePm = await context.paymentMandateRepo.insertPaymentMandate({
      id: tamperedPaymentTerms.id,
      mandateId: cartTerms.id,
      correlationId: cartTerms.correlationId,
      sequence: 1,
      terms: tamperedPaymentTerms,
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

    // 3. Capture Order with tampered terms
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

    // Must be blocked before PayPal capture!
    context.paymentProvider.assertZeroCaptureCalls();

    const decision = captureRes.ok ? "ALLOWED" : "BLOCKED";
    const actualCode = captureRes.ok
      ? "OK"
      : captureRes.error.kind === "GATE_DENIED"
        ? captureRes.error.code
        : captureRes.error.kind;
    const passed =
      decision === this.expectedDecision &&
      (actualCode === "TERMS_MISMATCH" || actualCode === "HASH_MISMATCH") &&
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
        attemptedAmountMinor: 85000, // $850.00
        authorizedAmountMinor: 8500, // $85.00
        amountAbovePolicyMinor: 75000, // $750.00 over $100 policy
        realizedSavingsMinor: 76500, // $765.00 prevented ($850 - $85)
        savingsRationale:
          "Prevented fraudulent $765.00 overcharge by blocking payment before capture.",
      },
      evidenceReferences: [
        {
          type: "MANDATE",
          id: cartTerms.id,
          hash: mandateRecord.hash,
          description: "Original Cart Mandate ($85.00)",
        },
        {
          type: "PAYMENT",
          id: insertedRoguePm.id,
          description: "Tampered Payment Mandate Terms ($850.00)",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
