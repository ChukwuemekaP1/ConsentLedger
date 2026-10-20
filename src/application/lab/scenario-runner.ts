/**
 * Security Lab Scenario Runner.
 *
 * Discovers and executes reproducible adversarial scenarios against the real
 * domain Gate and application use cases. Captures structured results,
 * enforces zero-capture invariants, and optionally appends ATTACK_SIMULATED
 * evidence events to the tamper-evident ledger.
 *
 * ARCHITECTURE.md §5, §8.1
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09, I-11.
 */

import type { SecurityScenario, SecurityScenarioId, LabContext, ScenarioResult } from "./types.js";
import { ControlValidPurchaseScenario } from "./scenarios/control-valid-purchase.js";
import { AmountManipulationScenario } from "./scenarios/amount-manipulation.js";
import { MerchantSubstitutionScenario } from "./scenarios/merchant-substitution.js";
import { CurrencySubstitutionScenario } from "./scenarios/currency-substitution.js";
import { PromptInjectionScenario } from "./scenarios/prompt-injection.js";
import { ReuseConsumedApprovalScenario } from "./scenarios/reuse-consumed-approval.js";
import { ExpiredMandateScenario } from "./scenarios/expired-mandate.js";
import { ChangedMandateConsentScenario } from "./scenarios/changed-mandate-consent.js";
import { EvidenceBundleTamperingScenario } from "./scenarios/evidence-bundle-tampering.js";

export class SecurityLabRunner {
  private readonly scenarios: Map<SecurityScenarioId, SecurityScenario> = new Map();

  constructor(customScenarios?: readonly SecurityScenario[]) {
    // Register default suite of 9 adversarial & control scenarios
    const defaults: readonly SecurityScenario[] = [
      new ControlValidPurchaseScenario(),
      new AmountManipulationScenario(),
      new MerchantSubstitutionScenario(),
      new CurrencySubstitutionScenario(),
      new PromptInjectionScenario(),
      new ReuseConsumedApprovalScenario(),
      new ExpiredMandateScenario(),
      new ChangedMandateConsentScenario(),
      new EvidenceBundleTamperingScenario(),
    ];

    for (const scenario of customScenarios ?? defaults) {
      this.scenarios.set(scenario.id, scenario);
    }
  }

  /**
   * List all registered security scenarios.
   */
  listScenarios(): readonly SecurityScenario[] {
    return Array.from(this.scenarios.values());
  }

  /**
   * Find a specific scenario by ID.
   */
  getScenario(id: SecurityScenarioId): SecurityScenario | undefined {
    return this.scenarios.get(id);
  }

  /**
   * Run a single scenario against the provided lab context.
   * Catches setup/precondition exceptions and marks them distinctly as SETUP_ERROR.
   */
  async runScenario(id: SecurityScenarioId, context: LabContext): Promise<ScenarioResult> {
    const scenario = this.scenarios.get(id);
    if (!scenario) {
      return {
        scenarioId: id,
        name: `Unknown Scenario (${id})`,
        category: "CONTROL",
        description: `Unrecognized scenario ID: ${id}`,
        invariant: "Unknown",
        runStatus: "SETUP_ERROR",
        decision: "BLOCKED",
        expectedDecision: "BLOCKED",
        reasonCode: "SCENARIO_NOT_FOUND",
        expectedReasonCode: "SCENARIO_NOT_FOUND",
        captureAttempted: false,
        captureCallCount: 0,
        setupError: `Scenario with ID '${id}' is not registered in the Security Lab runner.`,
        executionTimeMs: 0,
      };
    }

    try {
      const result = await scenario.run(context);

      // Optionally record an ATTACK_SIMULATED ledger event for persistent audit trails
      if (context.appendLedgerEvent && result.runStatus !== "SETUP_ERROR") {
        try {
          const correlationId =
            result.correlationId ??
            result.evidenceReferences?.find((r) => r.type === "MANDATE")?.id ??
            context.idGenerator.uuid();

          await context.appendLedgerEvent.execute({
            correlationId,
            type: "ATTACK_SIMULATED",
            actor: { type: "system", id: "security-lab-runner" },
            payload: {
              scenarioId: result.scenarioId,
              name: result.name,
              category: result.category,
              expectedDecision: result.expectedDecision,
              actualDecision: result.decision,
              expectedReasonCode: result.expectedReasonCode,
              actualReasonCode: result.reasonCode,
              captureAttempted: result.captureAttempted,
              captureCallCount: result.captureCallCount,
              runStatus: result.runStatus,
              valueMetrics: result.valueMetrics,
            },
          });
        } catch {
          // Persistence failure in lab reporting does not invalidate the scenario verdict
        }
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        scenarioId: scenario.id,
        name: scenario.name,
        category: scenario.category,
        description: scenario.description,
        invariant: scenario.targetInvariant,
        runStatus: "SETUP_ERROR",
        decision: "BLOCKED",
        expectedDecision: scenario.expectedDecision,
        reasonCode: "SETUP_EXCEPTION",
        expectedReasonCode: scenario.expectedReasonCode,
        captureAttempted: false,
        captureCallCount: context.paymentProvider.getCaptureCallCount(),
        setupError: `Unexpected exception during scenario setup/execution: ${message}`,
        executionTimeMs: 0,
      };
    }
  }

  /**
   * Run all registered scenarios in deterministic sequence.
   */
  async runAll(context: LabContext): Promise<readonly ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    for (const scenario of this.scenarios.values()) {
      const result = await this.runScenario(scenario.id, context);
      results.push(result);
    }
    return results;
  }
}
