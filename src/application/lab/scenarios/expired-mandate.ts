/**
 * Scenario 7: Expired Mandate Execution.
 *
 * An attacker attempts to execute payment on a mandate whose validity window
 * has elapsed. The Gate evaluates time validity and blocks execution with
 * MANDATE_EXPIRED before calling the payment provider (I-01).
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { CreateOrderUseCase } from "../../usecases/create-order.js";
import {
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
} from "../fixtures.js";
import type { Timestamp } from "../../../domain/shared/clock.js";

export class ExpiredMandateScenario implements SecurityScenario {
  readonly id = "expired-mandate" as const;
  readonly name = "Expired Mandate: Execution Past Validity Window";
  readonly category = "EXPIRATION" as const;
  readonly description =
    "An attacker attempts to create an order or capture on an expired Cart Mandate. Blocked with MANDATE_EXPIRED before any provider call.";
  readonly targetInvariant = "I-01: No provider call without a Gate pass; Time-bound validity";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "MANDATE_EXPIRED";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Setup expired mandate: expired at 10:02:00, clock is at 10:05:00
    const { policy, policyHash } = createStandardPolicy();
    const cartTerms = createStandardCartTerms(policyHash, context.clock, context.idGenerator);

    const expiredTerms = {
      ...cartTerms,
      validity: {
        notBefore: context.clock.offsetSeconds(-700), // 11.6 min ago
        expiresAt: context.clock.offsetSeconds(-100), // 1.6 min ago (expired!)
      },
    };

    const mandateRecord = buildStandardAttestedMandate(expiredTerms, {
      authorityKeyPair: { ...context.authorityKeyPair, keyId: "auth-key" },
      merchantKeyPair: {
        ...(context.merchantKeyPair ?? context.authorityKeyPair),
        keyId: "merch-key",
      },
      trustedKeys: context.trustedKeys,
    });

    const consent = makeSyntheticVerifiedConsent(mandateRecord.hash);

    await context.mandateRepo.createMandate({
      id: expiredTerms.id,
      kind: "CART",
      correlationId: expiredTerms.correlationId,
      principalId: expiredTerms.principalId,
      agentId: expiredTerms.agent.id,
      terms: expiredTerms,
      hash: mandateRecord.hash,
      attestations: mandateRecord.attestations,
      status: "SIGNED",
      expiresAt: expiredTerms.validity.expiresAt,
      createdAt: context.clock.offsetSeconds(-750),
    });

    await context.mandateRepo.saveConsent({
      id: context.idGenerator.uuid(),
      mandateId: expiredTerms.id,
      credentialId: consent.credentialId,
      authenticatorData: "{}",
      clientDataJson: "{}",
      signature: "{}",
      verifiedAt: consent.verifiedAt,
      createdAt: "2026-10-15T10:01:00.000Z" as Timestamp,
    });

    // 2. Attempt to create order on expired mandate
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
      mandateId: expiredTerms.id,
      requestId: context.idGenerator.uuid(),
      consent,
    });

    const captureCount = context.paymentProvider.getCaptureCallCount();
    context.paymentProvider.assertZeroCaptureCalls();

    const decision = createRes.ok ? "ALLOWED" : "BLOCKED";
    const actualCode = createRes.ok
      ? "OK"
      : createRes.error.kind === "GATE_DENIED"
        ? createRes.error.code
        : createRes.error.kind;

    const passed =
      decision === this.expectedDecision &&
      actualCode === this.expectedReasonCode &&
      captureCount === 0;

    return {
      scenarioId: this.id,
      correlationId: expiredTerms.correlationId,
      name: this.name,
      category: this.category,
      description: this.description,
      invariant: this.targetInvariant,
      runStatus: passed ? "PASSED" : "FAILED",
      decision,
      expectedDecision: this.expectedDecision,
      reasonCode: actualCode,
      expectedReasonCode: this.expectedReasonCode,
      captureAttempted: false,
      captureCallCount: 0,
      valueMetrics: {
        currency: "USD",
        attemptedAmountMinor: 8500,
        authorizedAmountMinor: 0,
        realizedSavingsMinor: 0, // Expired mandate; not recognized as active funds at risk
        savingsRationale:
          "Blocked expired authorization attempt. Realized savings is 0 because the mandate was already expired.",
      },
      evidenceReferences: [
        {
          type: "MANDATE",
          id: expiredTerms.id,
          description: "Expired Cart Mandate (validity window elapsed)",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
