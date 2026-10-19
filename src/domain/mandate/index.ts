// Layer: domain/mandate
// Mandate types, schemas, builders, attestations, and validity checks.
export type {
  CartMandateTerms,
  IntentMandateTerms,
  PaymentMandateTerms,
  MandateTerms,
  MandateKind,
  AttestationRole,
  Attestation,
  SignedMandate,
} from "./types.js";
export {
  CartMandateTermsSchema,
  IntentMandateTermsSchema,
  PaymentMandateTermsSchema,
  CartItemSchema,
  CartPaymentSchema,
  IntentScopeSchema,
  IntentLimitsSchema,
} from "./types.js";
export type {
  MandateBuildError,
  MandateBuilderResult,
  CartMandateInput,
  IntentMandateInput,
  SpendRequest,
  DerivationError,
} from "./builders.js";
export { buildCartMandate, buildIntentMandate, derivePaymentMandate } from "./builders.js";
export { requiredRoles, attestMandate, recomputeHash } from "./attestation.js";
export { isWithinValidity } from "./validity.js";
