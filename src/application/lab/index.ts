/**
 * Security Lab & Adversarial Scenario Runner module exports.
 */

export type {
  SecurityScenarioId,
  ScenarioCategory,
  ScenarioRunStatus,
  SecurityDecision,
  ValueMetrics,
  EvidenceReference,
  ScenarioResult,
  LabContext,
  SecurityScenario,
} from "./types.js";

export { InstrumentedPaymentProvider, type SeededOrder } from "./instrumented-payment-provider.js";
export { SecurityLabRunner } from "./scenario-runner.js";
export {
  generateDeterministicKeys,
  createStandardPolicy,
  createStandardCartTerms,
  buildStandardAttestedMandate,
  makeSyntheticVerifiedConsent,
  LAB_PRINCIPAL_ID,
  LAB_AGENT_ID,
  type DeterministicKeys,
} from "./fixtures.js";

export { ControlValidPurchaseScenario } from "./scenarios/control-valid-purchase.js";
export { AmountManipulationScenario } from "./scenarios/amount-manipulation.js";
export { MerchantSubstitutionScenario } from "./scenarios/merchant-substitution.js";
export { CurrencySubstitutionScenario } from "./scenarios/currency-substitution.js";
export { PromptInjectionScenario } from "./scenarios/prompt-injection.js";
export { ReuseConsumedApprovalScenario } from "./scenarios/reuse-consumed-approval.js";
export { ExpiredMandateScenario } from "./scenarios/expired-mandate.js";
export { ChangedMandateConsentScenario } from "./scenarios/changed-mandate-consent.js";
export { EvidenceBundleTamperingScenario } from "./scenarios/evidence-bundle-tampering.js";
