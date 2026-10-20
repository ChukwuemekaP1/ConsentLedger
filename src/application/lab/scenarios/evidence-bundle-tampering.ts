/**
 * Scenario 9: Evidence Bundle Tampering.
 *
 * An attacker exports a verified evidence bundle from a legitimate transaction
 * and mutates the payment terms or event hash chain offline.
 * The pure domain offline verifier detects cryptographic tampering under V1/V4
 * without making any network calls (I-04, I-09).
 */

import type { SecurityScenario, LabContext, ScenarioResult } from "../types.js";
import { verifyEvidenceBundle, createValidBundleFixture } from "../../../domain/evidence/index.js";

export class EvidenceBundleTamperingScenario implements SecurityScenario {
  readonly id = "evidence-bundle-tampering" as const;
  readonly name = "Evidence Tampering: Post-Execution Bundle Alteration";
  readonly category = "INTEGRITY" as const;
  readonly description =
    "An attacker attempts to tamper with the recorded terms and hash chain in an exported evidence bundle to conceal a transaction. Detected offline by verifyEvidenceBundle with HASH_MISMATCH.";
  readonly targetInvariant = "I-04: The ledger is tamper-evident; I-09: Evidence verifies offline";
  readonly expectedDecision = "BLOCKED" as const;
  readonly expectedReasonCode = "HASH_MISMATCH";

  async run(context: LabContext): Promise<ScenarioResult> {
    const startTime = performance.now();
    context.paymentProvider.reset();

    // 1. Generate a valid, complete evidence bundle fixture
    const fixture = createValidBundleFixture();
    const originalBundle = fixture.bundle;
    const trustStore = fixture.trustStore;

    // First confirm legitimate bundle verifies cleanly
    const baselineCheck = verifyEvidenceBundle(originalBundle, trustStore);
    if (!baselineCheck.ok) {
      return {
        scenarioId: this.id,
        name: this.name,
        category: this.category,
        description: this.description,
        invariant: this.targetInvariant,
        runStatus: "SETUP_ERROR",
        decision: "BLOCKED",
        expectedDecision: this.expectedDecision,
        reasonCode: baselineCheck.error.code,
        expectedReasonCode: this.expectedReasonCode,
        captureAttempted: false,
        captureCallCount: 0,
        setupError: `Baseline evidence bundle failed verification: ${baselineCheck.error.message}`,
        executionTimeMs: Math.round(performance.now() - startTime),
      };
    }

    // 2. Attack: Tamper with mandate terms inside the bundle
    const tamperedBundle = JSON.parse(JSON.stringify(originalBundle));
    // Tamper the payment amount from $85 to $850 inside the cart mandate terms
    tamperedBundle.mandates[0].terms.payment.amountMinor = 85000;

    // 3. Verify tampered bundle using pure domain verifier
    const verifyResult = verifyEvidenceBundle(tamperedBundle, trustStore);

    const captureCount = context.paymentProvider.getCaptureCallCount();
    context.paymentProvider.assertZeroCaptureCalls();

    const decision = verifyResult.ok ? "ALLOWED" : "BLOCKED";
    const actualCode = verifyResult.ok ? "OK" : verifyResult.error.code;
    const passed =
      decision === this.expectedDecision &&
      (actualCode === "HASH_MISMATCH" || actualCode === "CHAIN_BROKEN") &&
      captureCount === 0;

    return {
      scenarioId: this.id,
      correlationId: originalBundle.correlationId,
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
        attemptedAmountMinor: 85000,
        authorizedAmountMinor: 8500,
        realizedSavingsMinor: 0, // Post-transaction forensic verification; funds were already settled under original terms
        savingsRationale: "Offline forensic integrity check; detected historical tampering.",
      },
      evidenceReferences: [
        {
          type: "EVIDENCE_BUNDLE",
          hash: originalBundle.correlationId,
          description: "Tampered Evidence Bundle rejected by V1 check",
        },
      ],
      executionTimeMs: Math.round(performance.now() - startTime),
      notes:
        "Proves Invariant I-04 and I-09: Tampering is evident offline with zero network or database queries.",
    };
  }
}
