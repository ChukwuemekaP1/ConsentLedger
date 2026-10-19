import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { verifyPasskeyConsent } from "../../../src/domain/gate/consent.js";
import { sha256Hex } from "../../../src/domain/crypto/hash.js";
import type { Timestamp } from "../../../src/domain/shared/clock.js";

describe("Domain: verifyPasskeyConsent", () => {
  const verifiedAt = "2026-10-20T10:00:00.000Z" as Timestamp;
  const expectedOrigin = "http://localhost:3000";
  const expectedRpId = "localhost";
  const mandateHash = sha256Hex("test-mandate-canonical-content");

  // Helper to build authenticatorData
  // rpIdHash (32 bytes) + flags (1 byte) + signCount (4 bytes)
  function makeAuthData(options: {
    rpId?: string | undefined;
    userPresent?: boolean | undefined;
    userVerified?: boolean | undefined;
    signCount?: number | undefined;
  }): Buffer {
    const rp = options.rpId ?? expectedRpId;
    const rpIdHash = createHash("sha256").update(rp).digest();
    let flags = 0;
    if (options.userPresent ?? true) {
      flags |= 0x01; // UP
    }
    if (options.userVerified ?? true) {
      flags |= 0x04; // UV
    }
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32BE(options.signCount ?? 1, 0);

    return Buffer.concat([rpIdHash, Buffer.from([flags]), countBuf]);
  }

  // Generate an ES256 key pair
  const ecKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpkiB64 = ecKey.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  function createValidAssertion(
    overrides: {
      mandateHash?: string | undefined;
      origin?: string | undefined;
      rpId?: string | undefined;
      type?: string | undefined;
      userPresent?: boolean | undefined;
      userVerified?: boolean | undefined;
      signCount?: number | undefined;
      tamperSignature?: boolean | undefined;
    } = {},
  ) {
    const targetHash = overrides.mandateHash ?? mandateHash;
    const clientDataObj = {
      type: overrides.type ?? "webauthn.get",
      challenge: targetHash,
      origin: overrides.origin ?? expectedOrigin,
    };
    const clientDataJSON = Buffer.from(JSON.stringify(clientDataObj)).toString("base64url");
    const authenticatorData = makeAuthData({
      rpId: overrides.rpId,
      userPresent: overrides.userPresent,
      userVerified: overrides.userVerified,
      signCount: overrides.signCount,
    }).toString("base64url");

    // Compute signature over authenticatorData || sha256(clientDataJSON)
    const clientDataHash = createHash("sha256")
      .update(Buffer.from(clientDataJSON, "base64url"))
      .digest();
    const signatureBase = Buffer.concat([
      Buffer.from(authenticatorData, "base64url"),
      clientDataHash,
    ]);

    let sig = sign("sha256", signatureBase, ecKey.privateKey);
    if (overrides.tamperSignature) {
      sig = Buffer.from(sig);
      const firstByte = sig[0] ?? 0;
      sig[0] = firstByte ^ 0xff;
    }
    const signature = sig.toString("base64url");

    return {
      credentialId: "cred-123",
      clientDataJSON,
      authenticatorData,
      signature,
      publicKeySpkiB64,
      expectedMandateHash: mandateHash,
      expectedOrigin,
      expectedRPID: expectedRpId,
      verifiedAt,
    };
  }

  it("successfully verifies valid passkey assertion with UV", () => {
    const input = createValidAssertion();
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.mandateHash).toBe(mandateHash);
      expect(res.value.credentialId).toBe("cred-123");
      expect(res.value.verifiedAt).toBe(verifiedAt);
    }
  });

  it("fails when clientDataJSON type is not webauthn.get", () => {
    const input = createValidAssertion({ type: "webauthn.create" });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("TYPE_MISMATCH");
      expect(res.error.message).toContain("type");
    }
  });

  it("fails when challenge does not match mandate hash (I-05 exact binding)", () => {
    const wrongHash = sha256Hex("different-mandate");
    const input = createValidAssertion({ mandateHash: wrongHash });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("CHALLENGE_MISMATCH");
      expect(res.error.message).toContain("does not match");
    }
  });

  it("fails when origin does not match", () => {
    const input = createValidAssertion({ origin: "https://evil.attacker.com" });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("ORIGIN_MISMATCH");
      expect(res.error.message).toContain("origin");
    }
  });

  it("fails when rpIdHash does not match expected RP ID", () => {
    const input = createValidAssertion({ rpId: "phishing.com" });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("RP_ID_MISMATCH");
      expect(res.error.message).toContain("rpIdHash");
    }
  });

  it("fails when User Present (UP) flag is not set", () => {
    const input = createValidAssertion({ userPresent: false });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("USER_PRESENCE_REQUIRED");
      expect(res.error.message).toContain("User presence (UP)");
    }
  });

  it("fails when User Verified (UV) flag is not set (I-05 UV mandatory)", () => {
    const input = createValidAssertion({ userVerified: false });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("USER_VERIFICATION_REQUIRED");
      expect(res.error.message).toContain("User verification (UV)");
    }
  });

  it("fails when cryptographic signature is invalid or tampered", () => {
    const input = createValidAssertion({ tamperSignature: true });
    const res = verifyPasskeyConsent(input);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("SIGNATURE_INVALID");
      expect(res.error.message).toContain("signature verification failed");
    }
  });

  it("fails when public key SPKI DER is malformed", () => {
    const input = createValidAssertion();
    const badInput = { ...input, publicKeySpkiB64: "invalid-spki-data-not-der" };
    const res = verifyPasskeyConsent(badInput);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("SIGNATURE_INVALID");
      expect(res.error.message).toContain("public key");
    }
  });
});
