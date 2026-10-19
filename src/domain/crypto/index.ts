// Layer: domain/crypto
// Pure cryptographic primitives: canonical JSON, hashing, Ed25519 signing.
// Uses node:crypto only. No I/O.
export type { CanonicalError } from "./canonical.js";
export { canonicalize } from "./canonical.js";
export type { Hash } from "./hash.js";
export { sha256Hex, hashCanonical, timingSafeEqualHex, ZERO_HASH } from "./hash.js";
export type { KeyObject, SigningError } from "./signing.js";
export {
  signHash,
  verifyHash,
  keyId,
  exportPublicJwk,
  importPrivateKeyPkcs8Base64,
  importPublicKeySpkiBase64,
} from "./signing.js";
