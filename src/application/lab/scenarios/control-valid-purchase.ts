/**
 * Scenario 1: Control Baseline (Valid Purchase).
 *
 * Verifies that legitimate, properly authorized purchases succeed end-to-end:
 * the Gate passes, the order is created, and capture executes exactly once.
 * Proves that the system is not failing closed indiscriminately.
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { CreateOrderUseCase } from "../../usecases/create-order.js";
import { CaptureOrderUseCase } from "../../usecases/capture-order.js";
import {
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
} from "../fixtures.js";

export class ControlValidPurchaseScenario implements SecurityScenario {
  readonly id = "control-valid-purchase" as const;
  readonly name = "Control Baseline: Valid Legitimate Purchase";
  readonly category = "CONTROL" as const;
  readonly description =
    "A legitimate $85 purchase matching all signed terms, valid policy, and verified passkey consent. Must succeed and capture exactly once.";
  readonly targetInvariant = "Baseline functionality (Gate pass & settlement)";
  readonly expectedDecision = "ALLOWED" as const;
  readonly expectedReasonCode = "COMPLETED";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Setup
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

    // Save in repositories
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

    // 2. Create Order
    const createOrderUc = new CreateOrderUseCase(
      context.clock,
      context.idGenerator,
      context.mandateRepo,
      context.paymentMandateRepo,
      context.paymentProvider,
      context.trustedKeys,
      context.authorityKeyPair,
      context.passkeyRepo,
      context.webauthnConfig,
      context.unitOfWork,
      context.appendLedgerEvent,
    );

    const createRes = await createOrderUc.execute({
      mandateId: cartTerms.id,
      requestId: context.idGenerator.uuid(),
      consent,
    });

    if (!createRes.ok) {
      return {
        scenarioId: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        invariant: this.targetInvariant,
        runStatus: "FAILED",
        decision: "BLOCKED",
        expectedDecision: this.expectedDecision,
        reasonCode: createRes.error.kind,
        expectedReasonCode: this.expectedReasonCode,
        captureAttempted: false,
        captureCallCount: context.paymentProvider.getCaptureCallCount(),
        setupError: `Order creation failed: ${createRes.error.message}`,
        executionTimeMs: Math.round(performance.now() - startTime),
      };
    }

    const { orderId } = createRes.value;

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
      orderId,
      mandateId: cartTerms.id,
      consent,
    });

    const captureCount = context.paymentProvider.getCaptureCallCount();

    if (!captureRes.ok) {
      return {
        scenarioId: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        invariant: this.targetInvariant,
        runStatus: "FAILED",
        decision: "BLOCKED",
        expectedDecision: this.expectedDecision,
        reasonCode: captureRes.error.kind,
        expectedReasonCode: this.expectedReasonCode,
        captureAttempted: captureCount > 0,
        captureCallCount: captureCount,
        executionTimeMs: Math.round(performance.now() - startTime),
        notes: `Capture unexpectedly failed: ${captureRes.error.message}`,
      };
    }

    return {
      scenarioId: this.id,
      correlationId: cartTerms.correlationId,
      name: this.name,
      category: this.category,
      description: this.description,
      invariant: this.targetInvariant,
      runStatus: captureCount === 1 ? "PASSED" : "FAILED",
      decision: "ALLOWED",
      expectedDecision: this.expectedDecision,
      reasonCode: captureRes.value.status,
      expectedReasonCode: this.expectedReasonCode,
      captureAttempted: true,
      captureCallCount: captureCount,
      valueMetrics: {
        currency: "USD",
        attemptedAmountMinor: 8500,
        authorizedAmountMinor: 8500,
        amountAbovePolicyMinor: 0,
        realizedSavingsMinor: 0,
        savingsRationale: "Legitimate control transaction; no funds at risk or saved.",
      },
      evidenceReferences: [
        {
          type: "MANDATE",
          id: cartTerms.id,
          hash: mandateRecord.hash,
          description: "Approved Cart Mandate",
        },
        { type: "PAYMENT", id: orderId, description: "Provider Order ID" },
        { type: "PROVIDER_CALL", description: "PayPal Orders v2 capture completed" },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
