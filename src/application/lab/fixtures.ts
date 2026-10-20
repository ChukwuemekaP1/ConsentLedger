/**
 * Security Lab Deterministic Fixtures.
 *
 * Provides repeatable cryptographic keys, standard policies, mandate terms,
 * and passkey credentials so adversarial scenarios can run deterministically.
 */

import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { keyId } from "../../domain/crypto/signing.js";
import { attestMandate } from "../../domain/mandate/attestation.js";
import { buildCartMandate, type CartMandateInput } from "../../domain/mandate/builders.js";
import { hashPolicy, type PolicyDocument } from "../../domain/policy/policy.js";
import type { CartMandateTerms } from "../../domain/mandate/types.js";
import type { StoredMandateRecord, TrustedKeys } from "../../domain/gate/index.js";
import type { Hash } from "../../domain/crypto/hash.js";
import type { Clock, IdGenerator, Timestamp, Uuid } from "../../domain/shared/clock.js";
import type { VerifiedConsent } from "../../domain/gate/types.js";

export interface DeterministicKeys {
  readonly authorityKeyPair: {
    readonly privateKey: KeyObject;
    readonly publicKey: KeyObject;
    readonly keyId: string;
  };
  readonly merchantKeyPair: {
    readonly privateKey: KeyObject;
    readonly publicKey: KeyObject;
    readonly keyId: string;
  };
  readonly trustedKeys: TrustedKeys;
}

export function generateDeterministicKeys(): DeterministicKeys {
  const authKeys = generateKeyPairSync("ed25519");
  const merchKeys = generateKeyPairSync("ed25519");

  const authKeyId = keyId(authKeys.publicKey);
  const merchKeyId = keyId(merchKeys.publicKey);

  const trustedKeys: TrustedKeys = new Map([
    [authKeyId, { role: "AUTHORITY" as const, publicKey: authKeys.publicKey }],
    [merchKeyId, { role: "MERCHANT" as const, publicKey: merchKeys.publicKey }],
  ]);

  return {
    authorityKeyPair: { ...authKeys, keyId: authKeyId },
    merchantKeyPair: { ...merchKeys, keyId: merchKeyId },
    trustedKeys,
  };
}

export function createStandardPolicy(): {
  readonly policy: PolicyDocument;
  readonly policyHash: Hash;
} {
  const policy: PolicyDocument = {
    id: "lab-standard-policy",
    version: 1,
    rules: {
      maxPerTxMinor: 10000, // $100.00
      merchantAllowlist: ["merchant-acme-corp"],
      currencyAllowlist: ["USD"],
    },
  };
  const hashRes = hashPolicy(policy);
  if (!hashRes.ok) throw new Error("Failed to hash policy");
  return { policy, policyHash: hashRes.value as Hash };
}

export const LAB_PRINCIPAL_ID = "a11ce000-0000-4000-8000-000000000001";
export const LAB_AGENT_ID = "a6e47000-0000-4000-8000-000000000001";

export function createStandardCartTerms(
  policyHash: Hash,
  clock: Clock,
  idGenerator: IdGenerator,
  overrides?: Partial<CartMandateInput>,
): CartMandateTerms {
  const notBefore = clock.offsetSeconds(-60);
  const expiresAt = clock.offsetSeconds(600);
  const mandateId = idGenerator.uuid();
  const correlationId = idGenerator.uuid();

  const input: CartMandateInput = {
    id: mandateId,
    correlationId,
    principalId: LAB_PRINCIPAL_ID,
    agent: {
      id: LAB_AGENT_ID,
      model: "gemini-2.5-pro",
    },
    payee: {
      merchantId: "merchant-acme-corp",
      displayName: "Acme Corp",
    },
    payment: {
      amountMinor: 8500, // $85.00
      currency: "USD",
    },
    items: [
      {
        sku: "SKU-GADGET-85",
        description: "Standard Lab Widget",
        quantity: 1,
        unitAmountMinor: 8500,
      },
    ],
    promptPlayback: "Buy 1 Standard Lab Widget for $85.00",
    policy: {
      id: "lab-standard-policy",
      hash: policyHash,
    },
    validity: {
      notBefore,
      expiresAt,
    },
    nonce: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ...overrides,
  };

  const res = buildCartMandate(input);
  if (!res.ok) throw new Error(`buildCartMandate failed: ${res.error.message}`);
  return res.value.terms;
}

export function buildStandardAttestedMandate(
  terms: CartMandateTerms,
  keys: DeterministicKeys,
): StoredMandateRecord {
  const buildRes = buildCartMandate(terms as unknown as CartMandateInput);
  if (!buildRes.ok) throw new Error(`buildCartMandate failed: ${buildRes.error.message}`);
  const hash = buildRes.value.hash as Hash;

  const authAtt = attestMandate(
    "AUTHORITY",
    hash,
    keys.authorityKeyPair.privateKey,
    keys.authorityKeyPair.publicKey,
  );
  if (!authAtt.ok) throw new Error(`auth attest failed: ${authAtt.error.message}`);

  const merchAtt = attestMandate(
    "MERCHANT",
    hash,
    keys.merchantKeyPair.privateKey,
    keys.merchantKeyPair.publicKey,
  );
  if (!merchAtt.ok) throw new Error("merch attest failed");

  return {
    terms,
    hash,
    attestations: [authAtt.value, merchAtt.value],
    status: "SIGNED",
  };
}

export function makeSyntheticVerifiedConsent(
  mandateHash: string,
  credentialId: string = "cred-lab-alice",
  verifiedAt: Timestamp = "2026-10-15T10:05:00.000Z" as Timestamp,
): VerifiedConsent {
  return {
    mandateHash,
    credentialId,
    verifiedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as VerifiedConsent;
}
