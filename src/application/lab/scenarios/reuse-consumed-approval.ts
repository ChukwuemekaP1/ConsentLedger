/**
 * Scenario 6: Reuse of Consumed Approval (Replay Attack).
 *
 * An attacker attempts to replay a previously approved and captured single-use
 * Cart Mandate to execute a second unauthorized charge.
 * Blocked with REPLAY_DETECTED or INVALID_STATE, with zero additional capture calls (I-03).
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

export class ReuseConsumedApprovalScenario implements SecurityScenario {
  readonly id = "reuse-consumed-approval" as const;
  readonly name = "Replay Attack: Reusing a Consumed Cart Approval";
  readonly category = "REPLAY" as const;
  readonly description =
    "An attacker attempts to re-execute capture on a single-use Cart Mandate that was already completed and consumed. Blocked before any duplicate capture request reaches PayPal.";
  readonly targetInvariant =
    "I-03: Single spend; a cart mandate yields at most one payment execution";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "REPLAY_DETECTED";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Setup legitimate $85 mandate
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

    // 2. Legitimate initial Order & Capture (First execution)
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
        runStatus: "SETUP_ERROR",
        decision: "BLOCKED",
        expectedDecision: this.expectedDecision,
        reasonCode: createRes.error.kind,
        expectedReasonCode: this.expectedReasonCode,
        captureAttempted: false,
        captureCallCount: 0,
        setupError: `Initial order creation failed: ${createRes.error.message}`,
        executionTimeMs: Math.round(performance.now() - startTime),
      };
    }

    const { orderId } = createRes.value;

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

    // Initial capture (legitimate)
    const initialCaptureRes = await captureOrderUc.execute({
      orderId,
      mandateId: cartTerms.id,
      consent,
    });

    if (!initialCaptureRes.ok) {
      return {
        scenarioId: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        invariant: this.targetInvariant,
        runStatus: "SETUP_ERROR",
        decision: "BLOCKED",
        expectedDecision: this.expectedDecision,
        reasonCode: initialCaptureRes.error.kind,
        expectedReasonCode: this.expectedReasonCode,
        captureAttempted: false,
        captureCallCount: 0,
        setupError: `Initial legitimate capture failed: ${initialCaptureRes.error.message}`,
        executionTimeMs: Math.round(performance.now() - startTime),
      };
    }

    // Now call count is 1
    const initialCalls = context.paymentProvider.getCaptureCallCount();

    // 3. Attack: Attacker attempts to replay the capture on the already consumed mandate
    const replayRes = await captureOrderUc.execute({
      orderId,
      mandateId: cartTerms.id,
      consent,
    });

    const totalCalls = context.paymentProvider.getCaptureCallCount();
    // Crucial: No SECOND capture call occurred!
    const secondCaptureCalls = totalCalls - initialCalls;

    // The replay attempt must be rejected or idempotently return alreadyCaptured without a second provider call
    const isBlocked = !replayRes.ok || replayRes.value.alreadyCaptured === true;
    const actualCode = !replayRes.ok
      ? replayRes.error.kind
      : replayRes.value.alreadyCaptured
        ? "REPLAY_DETECTED"
        : "UNEXPECTED_OK";

    const passed =
      (actualCode === "REPLAY_DETECTED" ||
        actualCode === "INVALID_STATE" ||
        actualCode === "MANDATE_STATE_INVALID") &&
      secondCaptureCalls === 0;

    return {
      scenarioId: this.id,
      correlationId: cartTerms.correlationId,
      name: this.name,
      category: this.category,
      description: this.description,
      invariant: this.targetInvariant,
      runStatus: passed ? "PASSED" : "FAILED",
      decision: isBlocked ? "BLOCKED" : "ALLOWED",
      expectedDecision: this.expectedDecision,
      reasonCode: actualCode,
      expectedReasonCode: this.expectedReasonCode,
      captureAttempted: secondCaptureCalls > 0,
      captureCallCount: secondCaptureCalls,
      valueMetrics: {
        currency: "USD",
        attemptedAmountMinor: 8500, // Replay attempted second $85.00 charge
        authorizedAmountMinor: 0, // 0 authorized on second attempt
        realizedSavingsMinor: 8500, // $85.00 double-charge prevented
        savingsRationale: "Prevented duplicate $85.00 charge on previously consumed Cart Mandate.",
      },
      evidenceReferences: [
        { type: "MANDATE", id: cartTerms.id, description: "Consumed Cart Mandate" },
        { type: "PAYMENT", id: orderId, description: "Captured Payment Attempt" },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
