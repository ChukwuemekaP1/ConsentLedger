/**
 * COSE to SPKI public key conversion utility.
 *
 * Converts CBOR-encoded COSE public keys from WebAuthn authenticators into
 * standard SubjectPublicKeyInfo (SPKI) DER base64 strings.
 *
 * ADR-0008: "At registration the credential's public key is converted to SPKI DER and stored."
 */

import { createPublicKey } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

export function coseToSpkiBase64(cosePublicKey: Uint8Array): string {
  // Ensure underlying buffer is ArrayBuffer (not ArrayBufferLike / SharedArrayBuffer)
  const copy = new Uint8Array(new ArrayBuffer(cosePublicKey.byteLength));
  copy.set(cosePublicKey);
  const map = isoCBOR.decodeFirst(copy);
  if (!(map instanceof Map)) {
    throw new Error("Invalid COSE public key: not a valid CBOR map");
  }

  const kty = map.get(1); // 1 = kty
  // alg is map.get(3)

  if (kty === 2) {
    // EC2 key (e.g. ES256, P-256)
    const crv = map.get(-1); // -1 = crv
    const xCoord = map.get(-2); // -2 = x
    const yCoord = map.get(-3); // -3 = y

    if (!xCoord || !yCoord) {
      throw new Error("EC2 COSE public key missing x or y coordinate");
    }

    const jwk = {
      kty: "EC",
      crv: crv === 1 ? "P-256" : "P-256",
      x: Buffer.from(xCoord as Uint8Array).toString("base64url"),
      y: Buffer.from(yCoord as Uint8Array).toString("base64url"),
    };

    const key = createPublicKey({ key: jwk, format: "jwk" });
    return (key.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  }

  if (kty === 1) {
    // OKP key (e.g. EdDSA, Ed25519)
    const crv = map.get(-1);
    const xCoord = map.get(-2);

    if (!xCoord) {
      throw new Error("OKP COSE public key missing x coordinate");
    }

    const jwk = {
      kty: "OKP",
      crv: crv === 6 ? "Ed25519" : "Ed25519",
      x: Buffer.from(xCoord as Uint8Array).toString("base64url"),
    };

    const key = createPublicKey({ key: jwk, format: "jwk" });
    return (key.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  }

  if (kty === 3) {
    // RSA key (e.g. RS256)
    const n = map.get(-1);
    const e = map.get(-2);

    if (!n || !e) {
      throw new Error("RSA COSE public key missing n or e coordinate");
    }

    const jwk = {
      kty: "RSA",
      n: Buffer.from(n as Uint8Array).toString("base64url"),
      e: Buffer.from(e as Uint8Array).toString("base64url"),
    };

    const key = createPublicKey({ key: jwk, format: "jwk" });
    return (key.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  }

  throw new Error(`Unsupported COSE key type: ${String(kty)}`);
}
