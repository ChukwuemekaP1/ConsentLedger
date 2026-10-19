import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { coseToSpkiBase64 } from "../../../src/infrastructure/webauthn/cose-to-spki.js";
import { isoCBOR } from "@simplewebauthn/server/helpers";

describe("coseToSpkiBase64", () => {
  it("converts EC2 P-256 COSE key to SPKI DER base64 matching node:crypto export", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    const x = Buffer.from(jwk.x as string, "base64url");
    const y = Buffer.from(jwk.y as string, "base64url");

    const coseMap = new Map();
    coseMap.set(1, 2); // kty = EC2
    coseMap.set(3, -7); // alg = ES256
    coseMap.set(-1, 1); // crv = P-256
    coseMap.set(-2, x);
    coseMap.set(-3, y);
    const coseBytes = isoCBOR.encode(coseMap);

    const spkiB64 = coseToSpkiBase64(coseBytes);
    const expectedSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );

    expect(spkiB64).toBe(expectedSpkiB64);
  });

  it("converts OKP Ed25519 COSE key to SPKI DER base64", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" });
    const x = Buffer.from(jwk.x as string, "base64url");

    const coseMap = new Map();
    coseMap.set(1, 1); // kty = OKP
    coseMap.set(3, -8); // alg = EdDSA
    coseMap.set(-1, 6); // crv = Ed25519
    coseMap.set(-2, x);
    const coseBytes = isoCBOR.encode(coseMap);

    const spkiB64 = coseToSpkiBase64(coseBytes);
    const expectedSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );

    expect(spkiB64).toBe(expectedSpkiB64);
  });

  it("converts RSA RS256 COSE key to SPKI DER base64", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const n = Buffer.from(jwk.n as string, "base64url");
    const e = Buffer.from(jwk.e as string, "base64url");

    const coseMap = new Map();
    coseMap.set(1, 3); // kty = RSA
    coseMap.set(3, -257); // alg = RS256
    coseMap.set(-1, n);
    coseMap.set(-2, e);
    const coseBytes = isoCBOR.encode(coseMap);

    const spkiB64 = coseToSpkiBase64(coseBytes);
    const expectedSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );

    expect(spkiB64).toBe(expectedSpkiB64);
  });

  it("throws for unsupported COSE key type", () => {
    const coseMap = new Map();
    coseMap.set(1, 99); // unsupported
    const coseBytes = isoCBOR.encode(coseMap);

    expect(() => coseToSpkiBase64(coseBytes)).toThrow("Unsupported COSE key type: 99");
  });
});
