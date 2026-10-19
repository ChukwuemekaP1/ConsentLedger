/**
 * Pure domain WebAuthn assertion verification and VerifiedConsent capability minting.
 *
 * Implements assertion verification using node:crypto without external library dependencies,
 * meeting ADR-0008, INVARIANTS I-05, I-09, and Threat Model TB1/TB2.
 *
 * Checks:
 *   1. clientDataJSON.type === "webauthn.get"
 *   2. clientDataJSON.challenge === mandateHash (base64url or hex)
 *   3. clientDataJSON.origin === expectedOrigin
 *   4. clientDataJSON.crossOrigin !== true
 *   5. SHA-256(expectedRPID) === authData.rpIdHash
 *   6. UP (user present) flag is set
 *   7. UV (user verified) flag is set (INVARIANT I-05)
 *   8. Cryptographic signature over (authData || SHA-256(clientDataJSON)) verifies under the credential public key (SPKI DER)
 */

import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import type { VerifiedConsent } from "../gate/types.js";
import type { Timestamp } from "../shared/clock.js";
import { type Result, ok, err } from "../shared/result.js";

export interface VerifyConsentInput {
  readonly clientDataJSON: string; // base64url or utf8
  readonly authenticatorData: string; // base64url
  readonly signature: string; // base64url
  readonly credentialId: string;
  readonly publicKeySpkiB64: string; // SPKI DER in base64
  readonly expectedMandateHash: string; // 64 hex chars
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly requireUserVerification?: boolean | undefined; // Defaults to true per I-05
  readonly verifiedAt: Timestamp;
}

export type ConsentVerificationError =
  | { readonly kind: "CLIENT_DATA_INVALID"; readonly message: string }
  | { readonly kind: "TYPE_MISMATCH"; readonly message: string }
  | { readonly kind: "CHALLENGE_MISMATCH"; readonly message: string }
  | { readonly kind: "ORIGIN_MISMATCH"; readonly message: string }
  | { readonly kind: "CROSS_ORIGIN_DENIED"; readonly message: string }
  | { readonly kind: "RP_ID_MISMATCH"; readonly message: string }
  | { readonly kind: "USER_PRESENCE_REQUIRED"; readonly message: string }
  | { readonly kind: "USER_VERIFICATION_REQUIRED"; readonly message: string }
  | { readonly kind: "SIGNATURE_INVALID"; readonly message: string };

/**
 * Mint a VerifiedConsent capability. Private to this module, exported as evaluate/verify only.
 */
function _mintVerifiedConsent(
  mandateHash: string,
  credentialId: string,
  verifiedAt: Timestamp,
): VerifiedConsent {
  return {
    mandateHash,
    credentialId,
    verifiedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as VerifiedConsent;
}

export function verifyPasskeyConsent(
  input: VerifyConsentInput,
): Result<VerifiedConsent, ConsentVerificationError> {
  // 1. Decode clientDataJSON
  let clientDataRaw: Buffer;
  try {
    clientDataRaw = input.clientDataJSON.includes("{")
      ? Buffer.from(input.clientDataJSON, "utf8")
      : Buffer.from(input.clientDataJSON, "base64url");
  } catch {
    return err({ kind: "CLIENT_DATA_INVALID", message: "Failed to decode clientDataJSON" });
  }

  let clientData: {
    type?: string;
    challenge?: string;
    origin?: string;
    crossOrigin?: boolean;
  };
  try {
    clientData = JSON.parse(clientDataRaw.toString("utf8"));
  } catch {
    return err({ kind: "CLIENT_DATA_INVALID", message: "clientDataJSON is not valid JSON" });
  }

  // 2. Check type === "webauthn.get"
  if (clientData.type !== "webauthn.get") {
    return err({
      kind: "TYPE_MISMATCH",
      message: `Expected clientDataJSON type 'webauthn.get', got '${clientData.type}'`,
    });
  }

  // 3. Challenge must equal mandate hash
  // Challenge can arrive as base64url or hex or exact string
  const challenge = clientData.challenge ?? "";
  const expectedHash = input.expectedMandateHash;
  // Convert expected hex hash to base64url if needed
  const expectedHashB64Url = Buffer.from(expectedHash, "hex").toString("base64url");

  const challengeMatches =
    challenge === expectedHash ||
    challenge === expectedHashB64Url ||
    challenge.toLowerCase() === expectedHash.toLowerCase();

  if (!challengeMatches) {
    return err({
      kind: "CHALLENGE_MISMATCH",
      message: `Assertion challenge does not match mandate hash`,
    });
  }

  // 4. Origin check
  if (clientData.origin !== input.expectedOrigin) {
    return err({
      kind: "ORIGIN_MISMATCH",
      message: `Expected origin '${input.expectedOrigin}', got '${clientData.origin}'`,
    });
  }

  // 5. Cross origin check
  if (clientData.crossOrigin === true) {
    return err({
      kind: "CROSS_ORIGIN_DENIED",
      message: "Cross-origin WebAuthn assertions are not permitted",
    });
  }

  // 6. Decode and parse authenticatorData
  let authData: Buffer;
  try {
    authData = Buffer.from(input.authenticatorData, "base64url");
  } catch {
    return err({ kind: "CLIENT_DATA_INVALID", message: "Failed to decode authenticatorData" });
  }

  if (authData.length < 37) {
    return err({
      kind: "CLIENT_DATA_INVALID",
      message: "authenticatorData is too short (< 37 bytes)",
    });
  }

  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32] ?? 0;
  // const signCount = authData.readUInt32BE(33);

  // 7. Check RP ID hash
  const expectedRpIdHash = createHash("sha256").update(input.expectedRPID).digest();
  if (rpIdHash.length !== 32 || !timingSafeEqual(rpIdHash, expectedRpIdHash)) {
    return err({
      kind: "RP_ID_MISMATCH",
      message: "authenticatorData rpIdHash does not match expected RP ID",
    });
  }

  // 8. Check flags: UP (bit 0) and UV (bit 2)
  const up = (flags & 0x01) !== 0;
  const uv = (flags & 0x04) !== 0;

  if (!up) {
    return err({
      kind: "USER_PRESENCE_REQUIRED",
      message: "User presence (UP) flag is required",
    });
  }

  const requireUv = input.requireUserVerification ?? true;
  if (requireUv && !uv) {
    return err({
      kind: "USER_VERIFICATION_REQUIRED",
      message: "User verification (UV) flag is required (INVARIANT I-05)",
    });
  }

  // 9. Verify cryptographic signature over (authenticatorData || SHA-256(clientDataJSON))
  const clientDataHash = createHash("sha256").update(clientDataRaw).digest();
  const signedPayload = Buffer.concat([authData, clientDataHash]);

  let sigBuffer: Buffer;
  try {
    sigBuffer = Buffer.from(input.signature, "base64url");
  } catch {
    return err({ kind: "SIGNATURE_INVALID", message: "Failed to decode signature" });
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    const spkiDer = Buffer.from(input.publicKeySpkiB64, "base64");
    publicKey = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
  } catch (e) {
    return err({
      kind: "SIGNATURE_INVALID",
      message: `Invalid public key: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  let verified = false;
  try {
    // Try verification without pre-hash (for Ed25519) or with SHA-256 (for EC2 / RSA)
    if (publicKey.asymmetricKeyType === "ed25519") {
      verified = cryptoVerify(null, signedPayload, publicKey, sigBuffer);
    } else {
      verified = cryptoVerify("sha256", signedPayload, publicKey, sigBuffer);
    }
  } catch {
    verified = false;
  }

  if (!verified) {
    return err({
      kind: "SIGNATURE_INVALID",
      message: "Cryptographic signature verification failed",
    });
  }

  return ok(_mintVerifiedConsent(input.expectedMandateHash, input.credentialId, input.verifiedAt));
}
