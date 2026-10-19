// Layer: domain/gate
// The GateApproval constructor (_makeGateApproval) is intentionally NOT exported.
// Only evaluateGate() can produce a GateApproval. This is the I-01 capability contract.
export type {
  GateApproval,
  GateDenial,
  GateDenialCode,
  VerifiedConsent,
  SettlementRequest,
} from "./types.js";
export type {
  GateInput,
  TrustedKey,
  TrustedKeys,
  BudgetSnapshot,
  IntentSpendRequest,
  StoredMandateRecord,
} from "./gate.js";
export { evaluateGate } from "./gate.js";
