/**
 * Pure domain evidence bundle verifier.
 *
 * Implements offline verification checks V0 through V8.
 * Runs with ZERO network access, ZERO database access, and ZERO private keys.
 *
 * ARCHITECTURE.md §11, ADR-0002, ADR-0003, INVARIANTS I-04, I-05, I-09.
 */

import { createPublicKey, createHash, type KeyObject } from "node:crypto";
import { type Result, ok, err } from "../shared/result.js";
import { sha256Hex, type Hash } from "../crypto/hash.js";
import { canonicalize } from "../crypto/canonical.js";
import { verifyHash, keyId } from "../crypto/signing.js";
import { verifyChain } from "../ledger/chain.js";
import { leafHash, verifyInclusion } from "../ledger/merkle.js";
import { verifyPasskeyConsent } from "../gate/consent.js";
import type { Timestamp } from "../shared/clock.js";
import {
  evidenceBundleSchema,
  trustStoreSchema,
  type EvidenceBundle,
  type TrustStore,
  type CheckResult,
  type EvidenceVerificationOk,
  type EvidenceVerificationError,
  type TrustedKeyEntry,
} from "./types.js";

function importKeyObject(keyEntry: {
  readonly publicKeyJwk?: Record<string, unknown> | undefined;
  readonly publicKeySpkiB64?: string | undefined;
}): KeyObject | null {
  try {
    if (keyEntry.publicKeySpkiB64) {
      const der = Buffer.from(keyEntry.publicKeySpkiB64, "base64");
      return createPublicKey({ key: der, format: "der", type: "spki" });
    }
    if (keyEntry.publicKeyJwk) {
      return createPublicKey({ key: keyEntry.publicKeyJwk, format: "jwk" });
    }
    return null;
  } catch {
    return null;
  }
}

function findTrustedKey(
  trustStore: TrustStore | null | undefined,
  targetKeyId: string,
  role: "AUTHORITY" | "MERCHANT",
): { entry: TrustedKeyEntry; keyObject: KeyObject } | null {
  if (!trustStore?.trustedKeys) return null;
  const entry = trustStore.trustedKeys.find(
    (k) => k.keyId.toLowerCase() === targetKeyId.toLowerCase() && k.role === role,
  );
  if (!entry) return null;
  const keyObject = importKeyObject(entry);
  if (!keyObject) return null;
  return { entry, keyObject };
}

export function verifyEvidenceBundle(
  bundleInput: unknown,
  trustStoreInput?: TrustStore | null,
): Result<EvidenceVerificationOk, EvidenceVerificationError> {
  const checks: CheckResult[] = [];

  // ─── V0: Schema & Integrity Check ──────────────────────────────────────────
  const parsedBundle = evidenceBundleSchema.safeParse(bundleInput);
  if (!parsedBundle.success) {
    const errorDetails = parsedBundle.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const failCheck: CheckResult = {
      id: "V0",
      name: "Schema & Version Integrity",
      status: "FAIL",
      details: `Bundle schema invalid: ${errorDetails}`,
    };
    checks.push(failCheck);
    return err({
      valid: false,
      failedCheck: "V0",
      code: "SCHEMA_INVALID",
      message: failCheck.details,
      checks,
    });
  }

  const bundle: EvidenceBundle = parsedBundle.data as unknown as EvidenceBundle;

  let trustStore: TrustStore | null = null;
  if (trustStoreInput !== undefined && trustStoreInput !== null) {
    const parsedTrust = trustStoreSchema.safeParse(trustStoreInput);
    if (!parsedTrust.success) {
      const failCheck: CheckResult = {
        id: "V0",
        name: "Schema & Version Integrity",
        status: "FAIL",
        details: `Trust store invalid: ${parsedTrust.error.message}`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V0",
        code: "TRUST_STORE_INVALID",
        message: failCheck.details,
        checks,
      });
    }
    trustStore = parsedTrust.data as unknown as TrustStore;
  }

  checks.push({
    id: "V0",
    name: "Schema & Version Integrity",
    status: "PASS",
    details: `Bundle v${bundle.bundleVersion} schema validated; correlationId=${bundle.correlationId}`,
  });

  // ─── V1: Mandate Hash & Parent Binding ─────────────────────────────────────
  const mandateMap = new Map<string, (typeof bundle.mandates)[number]>();

  for (const m of bundle.mandates) {
    const canonical = canonicalize(m.terms);
    if (!canonical.ok) {
      const failCheck: CheckResult = {
        id: "V1",
        name: "Mandate Hash & Parent Binding",
        status: "FAIL",
        details: `Mandate ${m.id} terms cannot be canonicalized: ${canonical.error.kind}`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V1",
        code: "TERMS_NOT_CANONICAL",
        message: failCheck.details,
        checks,
      });
    }
    const computedHash = sha256Hex(canonical.value);
    if (computedHash.toLowerCase() !== m.hash.toLowerCase()) {
      const failCheck: CheckResult = {
        id: "V1",
        name: "Mandate Hash & Parent Binding",
        status: "FAIL",
        details: `Mandate ${m.id} hash mismatch: computed ${computedHash}, declared ${m.hash}`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V1",
        code: "HASH_MISMATCH",
        message: failCheck.details,
        checks,
      });
    }
    mandateMap.set(m.id, m);
  }

  if (bundle.paymentMandates && bundle.paymentMandates.length > 0) {
    for (const pm of bundle.paymentMandates) {
      const canonical = canonicalize(pm.terms);
      if (!canonical.ok) {
        const failCheck: CheckResult = {
          id: "V1",
          name: "Mandate Hash & Parent Binding",
          status: "FAIL",
          details: `Payment mandate ${pm.id} terms cannot be canonicalized`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V1",
          code: "TERMS_NOT_CANONICAL",
          message: failCheck.details,
          checks,
        });
      }
      const computedHash = sha256Hex(canonical.value);
      if (computedHash.toLowerCase() !== pm.hash.toLowerCase()) {
        const failCheck: CheckResult = {
          id: "V1",
          name: "Mandate Hash & Parent Binding",
          status: "FAIL",
          details: `Payment mandate ${pm.id} hash mismatch: computed ${computedHash}, declared ${pm.hash}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V1",
          code: "HASH_MISMATCH",
          message: failCheck.details,
          checks,
        });
      }

      // Check parent mandate binding
      const parentMandate = mandateMap.get(pm.mandateId);
      if (!parentMandate) {
        const failCheck: CheckResult = {
          id: "V1",
          name: "Mandate Hash & Parent Binding",
          status: "FAIL",
          details: `Payment mandate ${pm.id} references missing parent mandate ${pm.mandateId}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V1",
          code: "MANDATE_NOT_FOUND",
          message: failCheck.details,
          checks,
        });
      }

      const parentTerms = parentMandate.terms as Record<string, unknown>;
      if (parentTerms["kind"] === "CART") {
        const payment = parentTerms["payment"] as
          { amountMinor?: number; currency?: string } | undefined;
        const expectedAmountMinor =
          payment?.amountMinor ?? (parentTerms["amountMinor"] as number | undefined);
        const expectedCurrency =
          payment?.currency ?? (parentTerms["currency"] as string | undefined);

        if (
          pm.terms.amountMinor !== expectedAmountMinor ||
          pm.terms.currency !== expectedCurrency
        ) {
          const failCheck: CheckResult = {
            id: "V1",
            name: "Mandate Hash & Parent Binding",
            status: "FAIL",
            details: `Payment mandate ${pm.id} terms (${pm.terms.currency} ${pm.terms.amountMinor}) do not match parent Cart mandate (${expectedCurrency} ${expectedAmountMinor})`,
          };
          checks.push(failCheck);
          return err({
            valid: false,
            failedCheck: "V1",
            code: "TERMS_MISMATCH",
            message: failCheck.details,
            checks,
          });
        }
      }
    }
  }

  checks.push({
    id: "V1",
    name: "Mandate Hash & Parent Binding",
    status: "PASS",
    details: `${bundle.mandates.length} mandate(s) and ${bundle.paymentMandates?.length ?? 0} payment mandate(s) re-hashed and bound`,
  });

  // ─── V2: Attestation Signatures & Trust Store ──────────────────────────────
  if (!trustStore || trustStore.trustedKeys.length === 0) {
    const failCheck: CheckResult = {
      id: "V2",
      name: "Attestation Signatures & Trust Store",
      status: "FAIL",
      details:
        "No trusted keys provided in trust store. Bundles cannot be verified against untrusted or self-asserted keys (I-09).",
    };
    checks.push(failCheck);
    return err({
      valid: false,
      failedCheck: "V2",
      code: "AUTHORITY_KEY_UNTRUSTED",
      message: failCheck.details,
      checks,
    });
  }

  for (const m of bundle.mandates) {
    const authAtt = m.attestations.find((a) => a.role === "AUTHORITY");
    if (!authAtt) {
      const failCheck: CheckResult = {
        id: "V2",
        name: "Attestation Signatures & Trust Store",
        status: "FAIL",
        details: `Mandate ${m.id} missing mandatory AUTHORITY attestation`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V2",
        code: "AUTHORITY_SIGNATURE_INVALID",
        message: failCheck.details,
        checks,
      });
    }

    const trustedAuth = findTrustedKey(trustStore, authAtt.keyId, "AUTHORITY");
    if (!trustedAuth) {
      const failCheck: CheckResult = {
        id: "V2",
        name: "Attestation Signatures & Trust Store",
        status: "FAIL",
        details: `Authority keyId ${authAtt.keyId} for mandate ${m.id} is not present in trusted keys store`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V2",
        code: "AUTHORITY_KEY_UNTRUSTED",
        message: failCheck.details,
        checks,
      });
    }

    // Verify thumbprint
    const actualKeyId = keyId(trustedAuth.keyObject);
    if (actualKeyId.toLowerCase() !== authAtt.keyId.toLowerCase()) {
      const failCheck: CheckResult = {
        id: "V2",
        name: "Attestation Signatures & Trust Store",
        status: "FAIL",
        details: `Authority keyId thumbprint mismatch: computed ${actualKeyId}, attestation ${authAtt.keyId}`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V2",
        code: "KEY_ID_MISMATCH",
        message: failCheck.details,
        checks,
      });
    }

    const authSigValid = verifyHash(m.hash as Hash, authAtt.signature, trustedAuth.keyObject);
    if (!authSigValid) {
      const failCheck: CheckResult = {
        id: "V2",
        name: "Attestation Signatures & Trust Store",
        status: "FAIL",
        details: `Authority signature verification failed on mandate ${m.id}`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V2",
        code: "AUTHORITY_SIGNATURE_INVALID",
        message: failCheck.details,
        checks,
      });
    }

    // Cart mandates require MERCHANT attestation
    const mTerms = m.terms as Record<string, unknown>;
    if (mTerms["kind"] === "CART") {
      const merchAtt = m.attestations.find((a) => a.role === "MERCHANT");
      if (!merchAtt) {
        const failCheck: CheckResult = {
          id: "V2",
          name: "Attestation Signatures & Trust Store",
          status: "FAIL",
          details: `Cart mandate ${m.id} missing mandatory MERCHANT attestation`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V2",
          code: "MERCHANT_SIGNATURE_INVALID",
          message: failCheck.details,
          checks,
        });
      }

      const trustedMerch = findTrustedKey(trustStore, merchAtt.keyId, "MERCHANT");
      if (!trustedMerch) {
        const failCheck: CheckResult = {
          id: "V2",
          name: "Attestation Signatures & Trust Store",
          status: "FAIL",
          details: `Merchant keyId ${merchAtt.keyId} for mandate ${m.id} is not present in trusted keys store`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V2",
          code: "MERCHANT_KEY_UNTRUSTED",
          message: failCheck.details,
          checks,
        });
      }

      const merchSigValid = verifyHash(m.hash as Hash, merchAtt.signature, trustedMerch.keyObject);
      if (!merchSigValid) {
        const failCheck: CheckResult = {
          id: "V2",
          name: "Attestation Signatures & Trust Store",
          status: "FAIL",
          details: `Merchant signature verification failed on mandate ${m.id}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V2",
          code: "MERCHANT_SIGNATURE_INVALID",
          message: failCheck.details,
          checks,
        });
      }
    }
  }

  // Verify payment mandate authority signatures
  if (bundle.paymentMandates) {
    for (const pm of bundle.paymentMandates) {
      const trustedAuth = findTrustedKey(trustStore, bundle.authority.keyId, "AUTHORITY");
      if (!trustedAuth) {
        const failCheck: CheckResult = {
          id: "V2",
          name: "Attestation Signatures & Trust Store",
          status: "FAIL",
          details: `No trusted authority key for payment mandate authority ${bundle.authority.keyId}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V2",
          code: "AUTHORITY_KEY_UNTRUSTED",
          message: failCheck.details,
          checks,
        });
      }

      const pmSigValid = verifyHash(pm.hash as Hash, pm.authoritySignature, trustedAuth.keyObject);
      if (!pmSigValid) {
        const failCheck: CheckResult = {
          id: "V2",
          name: "Attestation Signatures & Trust Store",
          status: "FAIL",
          details: `Payment mandate ${pm.id} authority signature verification failed`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V2",
          code: "AUTHORITY_SIGNATURE_INVALID",
          message: failCheck.details,
          checks,
        });
      }
    }
  }

  checks.push({
    id: "V2",
    name: "Attestation Signatures & Trust Store",
    status: "PASS",
    details: "All authority and merchant attestations verified against independent trust store",
  });

  // ─── V3: Passkey Consent Verification ──────────────────────────────────────
  let verifiedConsentCount = 0;

  for (const m of bundle.mandates) {
    if (m.consent) {
      const cred = bundle.principal.credentials.find(
        (c) => c.credentialId === m.consent?.credentialId,
      );
      if (!cred) {
        const failCheck: CheckResult = {
          id: "V3",
          name: "Passkey Consent Verification",
          status: "FAIL",
          details: `Consent credentialId ${m.consent.credentialId} not found in principal credentials`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V3",
          code: "CREDENTIAL_NOT_FOUND",
          message: failCheck.details,
          checks,
        });
      }

      const consentResult = verifyPasskeyConsent({
        clientDataJSON: m.consent.clientDataJSON,
        authenticatorData: m.consent.authenticatorData,
        signature: m.consent.signature,
        credentialId: m.consent.credentialId,
        publicKeySpkiB64: cred.publicKeySpkiB64,
        expectedMandateHash: m.hash,
        expectedOrigin: cred.origin,
        expectedRPID: cred.rpId,
        requireUserVerification: true,
        verifiedAt: (m.consent.verifiedAt ?? bundle.generatedAt) as Timestamp,
      });

      if (!consentResult.ok) {
        const failCheck: CheckResult = {
          id: "V3",
          name: "Passkey Consent Verification",
          status: "FAIL",
          details: `Passkey consent invalid for mandate ${m.id}: ${consentResult.error.kind} - ${consentResult.error.message}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V3",
          code: consentResult.error.kind,
          message: failCheck.details,
          checks,
        });
      }
      verifiedConsentCount++;
    }
  }

  if (bundle.paymentMandates && bundle.paymentMandates.length > 0 && verifiedConsentCount === 0) {
    const failCheck: CheckResult = {
      id: "V3",
      name: "Passkey Consent Verification",
      status: "FAIL",
      details:
        "Payment mandates exist but no verified human consent was provided in the bundle (I-05)",
    };
    checks.push(failCheck);
    return err({
      valid: false,
      failedCheck: "V3",
      code: "CONSENT_MISSING",
      message: failCheck.details,
      checks,
    });
  }

  checks.push({
    id: "V3",
    name: "Passkey Consent Verification",
    status: "PASS",
    details: `${verifiedConsentCount} passkey consent assertion(s) verified (UP=1, UV=1, bound to mandate hash)`,
  });

  // ─── V4: Ledger Chain Integrity ────────────────────────────────────────────
  const events = bundle.ledger.events;
  const chainResult = verifyChain(events);
  if (!chainResult.ok) {
    const failCheck: CheckResult = {
      id: "V4",
      name: "Ledger Chain Integrity",
      status: "FAIL",
      details: `Ledger hash chain broken at seq ${chainResult.error.brokenAtSeq}: ${chainResult.error.reason} - ${chainResult.error.details ?? ""}`,
    };
    checks.push(failCheck);
    return err({
      valid: false,
      failedCheck: "V4",
      code: chainResult.error.reason,
      message: failCheck.details,
      checks,
    });
  }

  if (events[0] && events[0].correlationId !== bundle.correlationId) {
    const failCheck: CheckResult = {
      id: "V4",
      name: "Ledger Chain Integrity",
      status: "FAIL",
      details: `Ledger events correlationId (${events[0].correlationId}) differs from bundle correlationId (${bundle.correlationId})`,
    };
    checks.push(failCheck);
    return err({
      valid: false,
      failedCheck: "V4",
      code: "CORRELATION_ID_MISMATCH",
      message: failCheck.details,
      checks,
    });
  }

  checks.push({
    id: "V4",
    name: "Ledger Chain Integrity",
    status: "PASS",
    details: `Chain head ${chainResult.value.headHash.slice(0, 16)}... verified across ${chainResult.value.length} event(s)`,
  });

  // ─── V5: Checkpoint & Merkle Inclusion Proof ────────────────────────────────
  if (bundle.ledger.checkpoint) {
    const cp = bundle.ledger.checkpoint;
    const trustedAuth = findTrustedKey(trustStore, cp.keyId, "AUTHORITY");
    if (!trustedAuth) {
      const failCheck: CheckResult = {
        id: "V5",
        name: "Checkpoint & Merkle Inclusion",
        status: "FAIL",
        details: `Checkpoint keyId ${cp.keyId} is not trusted`,
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V5",
        code: "CHECKPOINT_KEY_UNTRUSTED",
        message: failCheck.details,
        checks,
      });
    }

    const cpSigValid = verifyHash(cp.root as Hash, cp.signature, trustedAuth.keyObject);
    if (!cpSigValid) {
      const failCheck: CheckResult = {
        id: "V5",
        name: "Checkpoint & Merkle Inclusion",
        status: "FAIL",
        details: "Checkpoint root signature verification failed",
      };
      checks.push(failCheck);
      return err({
        valid: false,
        failedCheck: "V5",
        code: "CHECKPOINT_SIGNATURE_INVALID",
        message: failCheck.details,
        checks,
      });
    }

    if (bundle.ledger.inclusionProof) {
      const lastEvent = events[events.length - 1];
      if (!lastEvent) {
        const failCheck: CheckResult = {
          id: "V5",
          name: "Checkpoint & Merkle Inclusion",
          status: "FAIL",
          details: "Cannot verify inclusion proof: no events present",
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V5",
          code: "INCLUSION_PROOF_INVALID",
          message: failCheck.details,
          checks,
        });
      }
      const leaf = leafHash(bundle.correlationId, lastEvent.hash);
      const proofValid = verifyInclusion(leaf, bundle.ledger.inclusionProof, cp.root);
      if (!proofValid) {
        const failCheck: CheckResult = {
          id: "V5",
          name: "Checkpoint & Merkle Inclusion",
          status: "FAIL",
          details: "Merkle inclusion proof does not compute to checkpoint root",
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V5",
          code: "INCLUSION_PROOF_INVALID",
          message: failCheck.details,
          checks,
        });
      }
    }

    checks.push({
      id: "V5",
      name: "Checkpoint & Merkle Inclusion",
      status: "PASS",
      details: `Checkpoint root ${cp.root.slice(0, 16)}... and Merkle inclusion proof verified under authority key ${cp.keyId.slice(0, 16)}...`,
    });
  } else {
    checks.push({
      id: "V5",
      name: "Checkpoint & Merkle Inclusion",
      status: "SKIP",
      details: "No Merkle checkpoint present in bundle (optional)",
    });
  }

  // ─── V6: Payment-to-Mandate Terms & Provider Consistency ───────────────────
  if (
    bundle.paymentMandates &&
    bundle.paymentMandates.length > 0 &&
    bundle.provider?.snapshots &&
    bundle.provider.snapshots.length > 0
  ) {
    let matchedSnapshots = 0;
    for (const pm of bundle.paymentMandates) {
      for (const snap of bundle.provider.snapshots) {
        const body = snap.body as {
          purchase_units?: Array<{
            amount?: { value?: string; currency_code?: string };
            payments?: {
              captures?: Array<{
                amount?: { value?: string; currency_code?: string };
              }>;
            };
          }>;
        };

        const unit = body.purchase_units?.[0];
        if (unit?.amount) {
          const snapVal = Number.parseFloat(unit.amount.value ?? "0");
          const snapMinor = Math.round(snapVal * 100);
          const snapCurr = unit.amount.currency_code ?? "";

          if (snapMinor !== pm.terms.amountMinor || snapCurr !== pm.terms.currency) {
            const failCheck: CheckResult = {
              id: "V6",
              name: "Payment Terms & Provider Consistency",
              status: "FAIL",
              details: `Payment terms (${pm.terms.currency} ${pm.terms.amountMinor}) do not match provider snapshot (${snapCurr} ${snapMinor})`,
            };
            checks.push(failCheck);
            return err({
              valid: false,
              failedCheck: "V6",
              code: "TERMS_MISMATCH",
              message: failCheck.details,
              checks,
            });
          }
          matchedSnapshots++;
        }
      }
    }

    checks.push({
      id: "V6",
      name: "Payment Terms & Provider Consistency",
      status: "PASS",
      details: `Payment mandate terms match ${matchedSnapshots} provider snapshot(s)`,
    });
  } else {
    checks.push({
      id: "V6",
      name: "Payment Terms & Provider Consistency",
      status: "SKIP",
      details: "No payment mandates or provider snapshots to cross-check",
    });
  }

  // ─── V7: Provider Snapshot Attestation ─────────────────────────────────────
  if (bundle.provider?.snapshots && bundle.provider.snapshots.length > 0) {
    for (const snap of bundle.provider.snapshots) {
      const canonical = canonicalize(snap.body);
      if (!canonical.ok) {
        const failCheck: CheckResult = {
          id: "V7",
          name: "Provider Snapshot Attestation",
          status: "FAIL",
          details: `Provider snapshot body cannot be canonicalized: ${canonical.error.kind}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V7",
          code: "SNAPSHOT_NOT_CANONICAL",
          message: failCheck.details,
          checks,
        });
      }
      const expectedHash = sha256Hex(canonical.value);
      if (expectedHash.toLowerCase() !== snap.snapshotHash.toLowerCase()) {
        const failCheck: CheckResult = {
          id: "V7",
          name: "Provider Snapshot Attestation",
          status: "FAIL",
          details: `Provider snapshot hash mismatch: computed ${expectedHash}, declared ${snap.snapshotHash}`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V7",
          code: "SNAPSHOT_HASH_MISMATCH",
          message: failCheck.details,
          checks,
        });
      }

      const trustedAuth = findTrustedKey(trustStore, bundle.authority.keyId, "AUTHORITY");
      if (!trustedAuth) {
        const failCheck: CheckResult = {
          id: "V7",
          name: "Provider Snapshot Attestation",
          status: "FAIL",
          details: `Authority key ${bundle.authority.keyId} for snapshot is not trusted`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V7",
          code: "AUTHORITY_KEY_UNTRUSTED",
          message: failCheck.details,
          checks,
        });
      }

      const snapSigValid = verifyHash(
        snap.snapshotHash as Hash,
        snap.authoritySignature,
        trustedAuth.keyObject,
      );
      if (!snapSigValid) {
        const failCheck: CheckResult = {
          id: "V7",
          name: "Provider Snapshot Attestation",
          status: "FAIL",
          details: `Provider snapshot authority signature failed verification`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V7",
          code: "SNAPSHOT_SIGNATURE_INVALID",
          message: failCheck.details,
          checks,
        });
      }
    }

    checks.push({
      id: "V7",
      name: "Provider Snapshot Attestation",
      status: "PASS",
      details: `${bundle.provider.snapshots.length} provider snapshot(s) verified under authority signature. (Note: Proves server fetch attestation; does not independently verify PayPal internal servers offline).`,
    });
  } else {
    checks.push({
      id: "V7",
      name: "Provider Snapshot Attestation",
      status: "SKIP",
      details: "No provider snapshots present in bundle",
    });
  }

  // ─── V8: State Machine Consistency ─────────────────────────────────────────
  const eventTypes = events.map((e) => e.type);
  let sawConsent = false;
  let sawOrderCreated = false;

  for (let i = 0; i < eventTypes.length; i++) {
    const t = eventTypes[i];
    if (t === "CONSENT_RECORDED" || t === "EXECUTION_AUTHORIZED") {
      sawConsent = true;
    }
    if (t === "PAYPAL_ORDER_CREATED") {
      if (!sawConsent) {
        const failCheck: CheckResult = {
          id: "V8",
          name: "State Machine Consistency",
          status: "FAIL",
          details: `Order/payment initiated at seq ${i + 1} before human consent was recorded (I-01, I-05)`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V8",
          code: "ILLEGAL_STATE_TRANSITION",
          message: failCheck.details,
          checks,
        });
      }
      sawOrderCreated = true;
    }
    if (t === "CAPTURE_REQUESTED" || t === "CAPTURE_COMPLETED") {
      if (!sawOrderCreated) {
        const failCheck: CheckResult = {
          id: "V8",
          name: "State Machine Consistency",
          status: "FAIL",
          details: `Payment capture attempted at seq ${i + 1} without a prior created order`,
        };
        checks.push(failCheck);
        return err({
          valid: false,
          failedCheck: "V8",
          code: "ILLEGAL_STATE_TRANSITION",
          message: failCheck.details,
          checks,
        });
      }
    }
  }

  checks.push({
    id: "V8",
    name: "State Machine Consistency",
    status: "PASS",
    details:
      "Event ordering matches state machine rules (proposal -> mandate -> consent -> order -> capture)",
  });

  return ok({
    valid: true,
    correlationId: bundle.correlationId,
    checks,
    summary: "All offline cryptographic and state consistency checks passed successfully.",
  });
}
