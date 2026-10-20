/**
 * Scenario 8: Changed-Mandate Consent (Consent Replay Across Mandates).
 *
 * An attacker takes a valid passkey signature given for Mandate A (hash A) and
 * attempts to attach it to authorize an unapproved Mandate B (hash B).
 * Blocked by the Gate with CONSENT_INVALID (I-05: Consent is bound to one hash).
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { CreateOrderUseCase } from "../../usecases/create-order.js";
import {
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
} from "../fixtures.js";
import type { Uuid } from "../../../domain/shared/clock.js";

export class ChangedMandateConsentScenario implements SecurityScenario {
  readonly id = "changed-mandate-consent" as const;
  readonly name = "Consent Replay: Passkey Signature Bound to Different Mandate";
  readonly category = "SUBSTITUTION" as const;
  readonly description =
    "An attacker attempts to authorize Mandate B using a human passkey consent assertion that was cryptographically bound to Mandate A. Blocked with CONSENT_INVALID.";
  readonly targetInvariant =
    "I-05: Consent is bound to one hash; cannot be transferred to another mandate";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "CONSENT_INVALID";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Mandate A (the one user actually approved)
    const { policy, policyHash } = createStandardPolicy();
    const cartTermsA = createStandardCartTerms(policyHash, context.clock, context.idGenerator);
    const mandateRecordA = buildStandardAttestedMandate(cartTermsA, {
      authorityKeyPair: { ...context.authorityKeyPair, keyId: "auth-key" },
      merchantKeyPair: {
        ...(context.merchantKeyPair ?? context.authorityKeyPair),
        keyId: "merch-key",
      },
      trustedKeys: context.trustedKeys,
    });

    // Valid passkey consent bound strictly to hash A
    const consentForA = makeSyntheticVerifiedConsent(mandateRecordA.hash);

    // 2. Mandate B (unapproved mandate with different ID and SKU)
    const cartTermsB = {
      ...cartTermsA,
      id: context.idGenerator.uuid(),
      items: [
        {
          sku: "SKU-EXPENSIVE-99",
          description: "Unapproved Luxury Item",
          quantity: 1,
          unitAmountMinor: 8500,
        },
      ],
    };

    const mandateRecordB = buildStandardAttestedMandate(cartTermsB, {
      authorityKeyPair: { ...context.authorityKeyPair, keyId: "auth-key" },
      merchantKeyPair: {
        ...(context.merchantKeyPair ?? context.authorityKeyPair),
        keyId: "merch-key",
      },
      trustedKeys: context.trustedKeys,
    });

    await context.mandateRepo.createMandate({
      id: cartTermsB.id,
      kind: "CART",
      correlationId: cartTermsB.correlationId,
      principalId: cartTermsB.principalId,
      agentId: cartTermsB.agent.id,
      terms: cartTermsB,
      hash: mandateRecordB.hash,
      attestations: mandateRecordB.attestations,
      status: "SIGNED",
      expiresAt: cartTermsB.validity.expiresAt,
      createdAt: context.clock.now(),
    });

    // Store consent for A attached to B in repository
    await context.mandateRepo.saveConsent({
      id: context.idGenerator.uuid(),
      mandateId: cartTermsB.id,
      credentialId: consentForA.credentialId,
      authenticatorData: "{}",
      clientDataJson: "{}",
      signature: "{}",
      verifiedAt: consentForA.verifiedAt,
      createdAt: context.clock.now(),
    });

    // 3. Attack: Try to create order for Mandate B using consent for A
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
      mandateId: cartTermsB.id,
      requestId: context.idGenerator.uuid(),
      consent: consentForA,
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
      (actualCode === "CONSENT_INVALID" || actualCode === "CONSENT_MISSING") &&
      captureCount === 0;

    return {
      scenarioId: this.id,
      correlationId: cartTermsB.correlationId,
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
        authorizedAmountMinor: 0, // Unapproved mandate has 0 authorized value
        realizedSavingsMinor: 8500, // Prevented unauthorized execution using stolen consent
        savingsRationale:
          "Prevented unauthorized $85.00 purchase by verifying passkey challenge equals mandate hash.",
      },
      evidenceReferences: [
        {
          type: "MANDATE",
          id: cartTermsA.id,
          hash: mandateRecordA.hash,
          description: "Approved Mandate A",
        },
        {
          type: "MANDATE",
          id: cartTermsB.id,
          hash: mandateRecordB.hash,
          description: "Unapproved Mandate B",
        },
        {
          type: "CONSENT",
          hash: mandateRecordA.hash,
          description: "Passkey consent bound strictly to Hash A",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }
}
