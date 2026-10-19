/**
 * Mandate attestations.
 *
 * Attestations are signed over the hash bytes, stored beside terms, never inside.
 * requiredRoles: CART requires AUTHORITY + MERCHANT; INTENT + PAYMENT require AUTHORITY only.
 *
 * ADR-0002: Two-signature mandates.
 * ARCHITECTURE.md §4.2.
 */

import type { AttestationRole, MandateKind } from "./types.js";
import type { Hash } from "../crypto/hash.js";
import type { KeyObject } from "../crypto/signing.js";
import { signHash, verifyHash, keyId as computeKeyId } from "../crypto/signing.js";
import { type Result, ok, err } from "../shared/result.js";
import type { SigningError } from "../crypto/signing.js";
import { hashCanonical } from "../crypto/hash.js";
import type { MandateTerms } from "./types.js";

export interface Attestation {
  readonly role: AttestationRole;
  readonly keyId: string;
  readonly signature: string;
}

/**
 * Returns the roles required for a mandate of the given kind.
 * CART: ["AUTHORITY", "MERCHANT"]
 * INTENT, PAYMENT: ["AUTHORITY"]
 */
export function requiredRoles(kind: MandateKind): AttestationRole[] {
  switch (kind) {
    case "CART":
      return ["AUTHORITY", "MERCHANT"];
    case "INTENT":
      return ["AUTHORITY"];
    case "PAYMENT":
      return ["AUTHORITY"];
    default: {
      // Exhaustive never check
      const _exhaustive: never = kind;
      throw new Error(`Unknown mandate kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Sign a mandate hash with the given role and private key.
 * Returns an Attestation whose keyId is computed from the public key.
 *
 * Note: The caller must pass the public key separately (derived from the private key)
 * for keyId computation, because node:crypto doesn't expose a direct "get public from private".
 */
export function attestMandate(
  role: AttestationRole,
  hash: Hash,
  privateKey: KeyObject,
  publicKey: KeyObject,
): Result<Attestation, SigningError> {
  const sigResult = signHash(hash, privateKey);
  if (!sigResult.ok) return sigResult;

  const kid = computeKeyId(publicKey);
  return ok({
    role,
    keyId: kid,
    signature: sigResult.value,
  });
}

/**
 * Recompute the hash of a set of terms. Used by the Gate to verify integrity.
 * Returns the same hash that buildCartMandate / buildIntentMandate / derivePaymentMandate computed.
 */
export function recomputeHash(terms: MandateTerms): Result<string, { message: string }> {
  const r = hashCanonical(terms);
  if (!r.ok) {
    return err({ message: `Failed to canonicalize terms: ${r.error.kind}` });
  }
  return ok(r.value);
}
