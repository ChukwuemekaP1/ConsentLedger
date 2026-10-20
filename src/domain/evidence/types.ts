/**
 * Evidence bundle and trust store domain types.
 *
 * Defines the exportable self-verifying bundle format (v1), trust store,
 * check identifiers (V0 to V8), and verification verdicts.
 *
 * ARCHITECTURE.md §11, ADR-0002, ADR-0003, INVARIANTS I-04, I-05, I-09.
 */

import { z } from "zod";
import type { CartMandateTerms, IntentMandateTerms, Attestation } from "../mandate/types.js";
import type { LedgerEvent } from "../ledger/events.js";
import type { InclusionProof } from "../ledger/merkle.js";

// ─── Trust Store ─────────────────────────────────────────────────────────────

export interface TrustedKeyEntry {
  readonly keyId: string;
  readonly role: "AUTHORITY" | "MERCHANT";
  readonly publicKeyJwk?: Record<string, unknown> | undefined;
  readonly publicKeySpkiB64?: string | undefined;
  readonly merchantId?: string | undefined;
  readonly description?: string | undefined;
}

export interface TrustStore {
  readonly version: 1;
  readonly trustedKeys: readonly TrustedKeyEntry[];
}

export const trustedKeyEntrySchema = z.object({
  keyId: z.string().min(16),
  role: z.enum(["AUTHORITY", "MERCHANT"]),
  publicKeyJwk: z.record(z.string(), z.unknown()).optional(),
  publicKeySpkiB64: z.string().optional(),
  merchantId: z.string().optional(),
  description: z.string().optional(),
});

export const trustStoreSchema = z.object({
  version: z.literal(1),
  trustedKeys: z.array(trustedKeyEntrySchema).min(1),
});

// ─── Evidence Bundle Schema (v1) ──────────────────────────────────────────────

export interface BundleAuthority {
  readonly keyId: string;
  readonly publicKeyJwk?: Record<string, unknown> | undefined;
  readonly publicKeySpkiB64?: string | undefined;
}

export interface BundlePrincipalCredential {
  readonly credentialId: string;
  readonly publicKeySpkiB64: string;
  readonly alg?: number | undefined;
  readonly rpId: string;
  readonly origin: string;
}

export interface BundlePrincipal {
  readonly id: string;
  readonly credentials: readonly BundlePrincipalCredential[];
}

export interface BundleMandateConsent {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
  readonly verifiedAt?: string | undefined;
}

export interface BundleMandate {
  readonly id: string;
  readonly terms: CartMandateTerms | IntentMandateTerms;
  readonly hash: string;
  readonly attestations: readonly Attestation[];
  readonly consent?: BundleMandateConsent | undefined;
}

export interface BundleMerchant {
  readonly merchantId: string;
  readonly keyId: string;
  readonly publicKeyJwk?: Record<string, unknown> | undefined;
  readonly publicKeySpkiB64?: string | undefined;
}

export interface BundlePaymentMandate {
  readonly id: string;
  readonly mandateId: string;
  readonly sequence: number;
  readonly terms: {
    readonly mandateId: string;
    readonly sequence: number;
    readonly amountMinor: number;
    readonly currency: string;
    readonly merchant: {
      readonly id: string;
      readonly name: string;
      readonly paypalReceiverId?: string | undefined;
    };
    readonly purpose?: string | undefined;
    readonly idempotencyKey?: string | undefined;
  };
  readonly hash: string;
  readonly authoritySignature: string;
}

export interface BundleCheckpoint {
  readonly size: number;
  readonly root: string;
  readonly signature: string;
  readonly keyId: string;
  readonly createdAt: string;
}

export interface BundleLedger {
  readonly events: readonly LedgerEvent[];
  readonly checkpoint?: BundleCheckpoint | undefined;
  readonly inclusionProof?: InclusionProof | undefined;
}

export interface ProviderSnapshot {
  readonly source: string;
  readonly fetchedAt: string;
  readonly body: Record<string, unknown>;
  readonly snapshotHash: string;
  readonly authoritySignature: string;
}

export interface BundleProvider {
  readonly paypalOrderId?: string | undefined;
  readonly paypalCaptureIds?: readonly string[] | undefined;
  readonly snapshots?: readonly ProviderSnapshot[] | undefined;
}

export interface EvidenceBundle {
  readonly bundleVersion: 1;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly authority: BundleAuthority;
  readonly principal: BundlePrincipal;
  readonly mandates: readonly BundleMandate[];
  readonly merchants?: readonly BundleMerchant[] | undefined;
  readonly paymentMandates?: readonly BundlePaymentMandate[] | undefined;
  readonly ledger: BundleLedger;
  readonly provider?: BundleProvider | undefined;
}

// ─── Zod Schemas for Validation ──────────────────────────────────────────────

export const bundleAuthoritySchema = z.object({
  keyId: z.string().min(16),
  publicKeyJwk: z.record(z.string(), z.unknown()).optional(),
  publicKeySpkiB64: z.string().optional(),
});

export const bundlePrincipalCredentialSchema = z.object({
  credentialId: z.string().min(1),
  publicKeySpkiB64: z.string().min(1),
  alg: z.number().optional(),
  rpId: z.string().min(1),
  origin: z.string().min(1),
});

export const bundlePrincipalSchema = z.object({
  id: z.string().min(1),
  credentials: z.array(bundlePrincipalCredentialSchema),
});

export const bundleMandateConsentSchema = z.object({
  credentialId: z.string().min(1),
  authenticatorData: z.string().min(1),
  clientDataJSON: z.string().min(1),
  signature: z.string().min(1),
  verifiedAt: z.string().optional(),
});

export const bundleMandateSchema = z.object({
  id: z.string().min(1),
  terms: z.record(z.string(), z.unknown()),
  hash: z.string().length(64),
  attestations: z.array(
    z.object({
      role: z.enum(["AUTHORITY", "MERCHANT"]),
      keyId: z.string().min(16),
      signature: z.string().min(1),
    }),
  ),
  consent: bundleMandateConsentSchema.optional(),
});

export const bundleMerchantSchema = z.object({
  merchantId: z.string().min(1),
  keyId: z.string().min(16),
  publicKeyJwk: z.record(z.string(), z.unknown()).optional(),
  publicKeySpkiB64: z.string().optional(),
});

export const bundlePaymentMandateSchema = z.object({
  id: z.string().min(1),
  mandateId: z.string().min(1),
  sequence: z.number().int().positive(),
  terms: z.object({
    mandateId: z.string().min(1),
    sequence: z.number().int().positive(),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    merchant: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      paypalReceiverId: z.string().optional(),
    }),
    purpose: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }),
  hash: z.string().length(64),
  authoritySignature: z.string().min(1),
});

export const bundleCheckpointSchema = z.object({
  size: z.number().int().nonnegative(),
  root: z.string().length(64),
  signature: z.string().min(1),
  keyId: z.string().min(16),
  createdAt: z.string().min(1),
});

export const bundleLedgerSchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())).min(1),
  checkpoint: bundleCheckpointSchema.optional(),
  inclusionProof: z
    .object({
      leafIndex: z.number().int().nonnegative(),
      steps: z.array(
        z.object({
          sibling: z.string().length(64),
          siblingIsLeft: z.boolean(),
        }),
      ),
    })
    .optional(),
});

export const providerSnapshotSchema = z.object({
  source: z.string().min(1),
  fetchedAt: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
  snapshotHash: z.string().length(64),
  authoritySignature: z.string().min(1),
});

export const bundleProviderSchema = z.object({
  paypalOrderId: z.string().optional(),
  paypalCaptureIds: z.array(z.string()).optional(),
  snapshots: z.array(providerSnapshotSchema).optional(),
});

export const evidenceBundleSchema = z.object({
  bundleVersion: z.literal(1),
  generatedAt: z.string().min(1),
  correlationId: z.string().min(1),
  authority: bundleAuthoritySchema,
  principal: bundlePrincipalSchema,
  mandates: z.array(bundleMandateSchema).min(1),
  merchants: z.array(bundleMerchantSchema).optional(),
  paymentMandates: z.array(bundlePaymentMandateSchema).optional(),
  ledger: bundleLedgerSchema,
  provider: bundleProviderSchema.optional(),
});

// ─── Verification Checks & Verdicts ──────────────────────────────────────────

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

export interface CheckResult {
  readonly id: "V0" | "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";
  readonly name: string;
  readonly status: CheckStatus;
  readonly details: string;
}

export interface EvidenceVerificationOk {
  readonly valid: true;
  readonly correlationId: string;
  readonly checks: readonly CheckResult[];
  readonly summary: string;
}

export interface EvidenceVerificationError {
  readonly valid: false;
  readonly failedCheck: "V0" | "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";
  readonly code: string;
  readonly message: string;
  readonly checks: readonly CheckResult[];
}
