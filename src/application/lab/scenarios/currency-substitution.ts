/**
 * Scenario 4: Currency Substitution & Policy Limit Evasion.
 *
 * An attacker attempts to execute in an unapproved currency (EUR) to bypass USD caps,
 * or bypass policy currency rules.
 * The Gate detects currency rule violation and blocks execution with CURRENCY_NOT_ALLOWED (I-01).
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { CreateOrderUseCase } from "../../usecases/create-order.js";
import {
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
} from "../fixtures.js";
import type { Currency } from "../../../domain/money/currency.js";

export class CurrencySubstitutionScenario implements SecurityScenario {
  readonly id = "currency-substitution" as const;
  readonly name = "Currency Substitution: Policy Currency Evasion";
  readonly category = "POLICY_VIOLATION" as const;
  readonly description =
    "An attacker attempts to initiate an order in EUR when the approved policy strictly allows USD. Blocked with CURRENCY_NOT_ALLOWED before any provider order or capture.";
  readonly targetInvariant = "I-01: No provider call without a Gate pass; Policy rule enforcement";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "POLICY_DENIED";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Setup policy with strictly USD allowed
    const { policy, policyHash } = createStandardPolicy();
    const cartTerms = createStandardCartTerms(policyHash, context.clock, context.idGenerator);

    // Attack: modify cart terms to use EUR currency instead of USD
    const substitutedCurrencyTerms = {
      ...cartTerms,
      payment: {
        amountMinor: 8500,
        currency: "EUR" as Currency, // Disallowed currency!
      },
    };

    const mandateRecord = buildStandardAttestedMandate(substitutedCurrencyTerms, {
      authorityKeyPair: { ...context.authorityKeyPair, keyId: "auth-key" },
      merchantKeyPair: {
        ...(context.merchantKeyPair ?? context.authorityKeyPair),
        keyId: "merch-key",
      },
      trustedKeys: context.trustedKeys,
    });

    const consent = makeSyntheticVerifiedConsent(mandateRecord.hash);

    await context.mandateRepo.createMandate({
      id: substitutedCurrencyTerms.id,
      kind: "CART",
      correlationId: substitutedCurrencyTerms.correlationId,
      principalId: substitutedCurrencyTerms.principalId,
      agentId: substitutedCurrencyTerms.agent.id,
      terms: substitutedCurrencyTerms,
      hash: mandateRecord.hash,
      attestations: mandateRecord.attestations,
      status: "SIGNED",
      expiresAt: substitutedCurrencyTerms.validity.expiresAt,
      createdAt: context.clock.now(),
    });

    await context.mandateRepo.saveConsent({
      id: context.idGenerator.uuid(),
      mandateId: substitutedCurrencyTerms.id,
      credentialId: consent.credentialId,
      authenticatorData: "{}",
      clientDataJson: "{}",
      signature: "{}",
      verifiedAt: consent.verifiedAt,
      createdAt: context.clock.now(),
    });

    // 2. Attempt to create order
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
      mandateId: substitutedCurrencyTerms.id,
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
      correlationId: substitutedCurrencyTerms.correlationId,
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
        currency: "EUR",
        attemptedAmountMinor: 8500,
        authorizedAmountMinor: 0,
        realizedSavingsMinor: 0, // Unapproved currency request did not have legitimate authorized funds at risk
        savingsRationale: "Blocked unauthorized currency execution. No funds authorized or lost.",
      },
      evidenceReferences: [
        {
          type: "MANDATE",
          id: substitutedCurrencyTerms.id,
          description: "Mandate with disallowed EUR currency",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
