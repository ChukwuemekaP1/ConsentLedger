// Layer: domain/evidence
export type {
  EvidenceBundle,
  TrustStore,
  TrustedKeyEntry,
  BundleAuthority,
  BundlePrincipal,
  BundlePrincipalCredential,
  BundleMandate,
  BundleMandateConsent,
  BundleMerchant,
  BundlePaymentMandate,
  BundleLedger,
  BundleCheckpoint,
  ProviderSnapshot,
  BundleProvider,
  CheckStatus,
  CheckResult,
  EvidenceVerificationOk,
  EvidenceVerificationError,
} from "./types.js";

export {
  evidenceBundleSchema,
  trustStoreSchema,
  bundleAuthoritySchema,
  bundlePrincipalSchema,
  bundleMandateSchema,
  bundlePaymentMandateSchema,
  bundleLedgerSchema,
  bundleCheckpointSchema,
  providerSnapshotSchema,
  bundleProviderSchema,
} from "./types.js";

export { verifyEvidenceBundle } from "./verifier.js";
export { createValidBundleFixture } from "./fixture.js";
