/**
 * Mandate and consent repository port.
 *
 * Provides persistence operations for mandates, policies, and mandate consents.
 * ARCHITECTURE.md §4.1, §4.2, §12.
 */

import type { StoredMandateRecord } from "../../domain/gate/gate.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";

export interface StoredMandateConsent {
  readonly id: string;
  readonly mandateId: string;
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJson: string;
  readonly signature: string;
  readonly verifiedAt: string;
  readonly createdAt: string;
}

export interface MandateRepo {
  // Mandate queries
  findMandateById(id: string): Promise<StoredMandateRecord | null>;
  findMandateByHash(hash: string): Promise<StoredMandateRecord | null>;
  lockMandate(id: string): Promise<void>;

  // Status transitions
  updateMandateStatus(id: string, status: string): Promise<void>;

  // Policies
  findPolicyById(id: string): Promise<PolicyDocument | null>;
  findActivePolicy(id: string): Promise<PolicyDocument | null>;

  // Consents
  findConsentByMandateId(mandateId: string): Promise<StoredMandateConsent | null>;
  saveConsent(consent: {
    id: string;
    mandateId: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJson: string;
    signature: string;
    verifiedAt: string;
    createdAt: string;
  }): Promise<StoredMandateConsent>;
}
