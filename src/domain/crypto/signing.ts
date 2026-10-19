/**
 * Ed25519 signing utilities.
 *
 * signHash / verifyHash:
 *   The signed bytes are the 32 raw hash bytes decoded from the 64-char hex
 *   Hash. We sign the raw bytes, not the hex string, so the signed payload
 *   is always 32 bytes regardless of encoding.
 *
 *   Why raw bytes: signing a fixed-length decoded binary digest is the
 *   standard practice (e.g. JWT, TLS). Signing the hex string would double
 *   the byte count with no security benefit and could create confusion about
 *   what exactly is signed.
 *
 * keyId: SHA-256 thumbprint of the SubjectPublicKeyInfo (SPKI) DER bytes,
 *   encoded as 64 lowercase hex chars. Stable across algorithm parameters.
 *
 * importPrivateKeyPkcs8Base64 / importPublicKeySpkiBase64:
 *   Load keys from base64-encoded DER. PKCS#8 for private, SPKI for public.
 *   These are the formats node:crypto generates and stores.
 *
 * exportPublicJwk: export public key as a JWK for inclusion in bundles.
 *
 * ARCHITECTURE.md §4.2: "Authority attestation: Ed25519 over the hash bytes."
 * CODING.md §7: "Use node:crypto. No hand-rolled primitives."
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { type Result, ok, err } from "../shared/result.js";
import type { Hash } from "./hash.js";

export type { KeyObject };

export interface SigningError {
  readonly kind: "SIGN_FAILED" | "VERIFY_FAILED" | "IMPORT_FAILED";
  readonly message: string;
}

/**
 * Sign a mandate hash with an Ed25519 private key.
 *
 * @param hash   - The 64-char hex Hash string (32 bytes when decoded).
 * @param privateKey - An Ed25519 KeyObject (private).
 * @returns Base64url-encoded signature (64 bytes / 88 base64url chars).
 *
 * Signed bytes: Buffer.from(hash, "hex") — the 32 raw SHA-256 bytes.
 */
export function signHash(hash: Hash, privateKey: KeyObject): Result<string, SigningError> {
  try {
    const data = Buffer.from(hash, "hex");
    // Ed25519 sign returns a Buffer of 64 bytes
    const sig = cryptoSign(null, data, privateKey);
    return ok(sig.toString("base64url"));
  } catch (e) {
    return err({
      kind: "SIGN_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Verify an Ed25519 signature over a mandate hash.
 *
 * @param hash      - The 64-char hex Hash string (32 bytes when decoded).
 * @param signature - Base64url-encoded signature (as returned by signHash).
 * @param publicKey - An Ed25519 KeyObject (public).
 * @returns true if valid; false if invalid (never throws for bad sig).
 *
 * Verified bytes: Buffer.from(hash, "hex") — the same 32 raw bytes.
 */
export function verifyHash(hash: Hash, signature: string, publicKey: KeyObject): boolean {
  try {
    const data = Buffer.from(hash, "hex");
    const sigBuf = Buffer.from(signature, "base64url");
    return cryptoVerify(null, data, publicKey, sigBuf);
  } catch {
    // Any parse failure (bad base64, wrong key type) is a verification failure
    return false;
  }
}

/**
 * Compute the keyId for a public key: SHA-256 of the SPKI DER bytes, hex.
 *
 * The SPKI DER encoding includes the algorithm OID, so the thumbprint is
 * stable and unique per key even across key types.
 */
export function keyId(publicKey: KeyObject): string {
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return createHash("sha256").update(spki).digest("hex");
}

/**
 * Export a public key as a JWK (plain object, JSON-serialisable).
 * Used in evidence bundles so a verifier can import the key.
 */
export function exportPublicJwk(publicKey: KeyObject): Record<string, unknown> {
  return publicKey.export({ format: "jwk" }) as Record<string, unknown>;
}

/**
 * Import an Ed25519 private key from base64-encoded PKCS#8 DER.
 * The base64 string comes from AUTHORITY_PRIVATE_KEY_B64 in config.
 */
export function importPrivateKeyPkcs8Base64(b64: string): Result<KeyObject, SigningError> {
  try {
    const der = Buffer.from(b64, "base64");
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return ok(key);
  } catch (e) {
    return err({
      kind: "IMPORT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Import an Ed25519 public key from base64-encoded SPKI DER.
 * The base64 string comes from AUTHORITY_PUBLIC_KEY_B64 in config.
 */
export function importPublicKeySpkiBase64(b64: string): Result<KeyObject, SigningError> {
  try {
    const der = Buffer.from(b64, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return ok(key);
  } catch (e) {
    return err({
      kind: "IMPORT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
