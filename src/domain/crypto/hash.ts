/**
 * Hashing utilities over canonical bytes.
 *
 * sha256Hex: compute SHA-256 of a string or Buffer, return 64 lowercase hex chars.
 * Hash: branded 64-char lowercase hex string.
 * hashCanonical: canonicalize a value and hash it.
 * timingSafeEqualHex: constant-time comparison of two hex strings (I-05, CODING.md §7).
 *
 * CODING.md §7: "Always hash canonical bytes. Never hash JSON.stringify output."
 * INVARIANT: I-04 (tamper-evident ledger), I-10 (no floats).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Brand } from "../shared/brand.js";
import { type Result, ok, err } from "../shared/result.js";
import { canonicalize, type CanonicalError } from "./canonical.js";

/** A SHA-256 digest encoded as 64 lowercase hex characters. */
export type Hash = Brand<string, "Hash">;

/** 64 lowercase hex zeros — used as prevHash for the first ledger event. */
export const ZERO_HASH = "0".repeat(64) as Hash;

/**
 * Compute SHA-256 of a UTF-8 string or Buffer.
 * Returns a Hash (64 lowercase hex chars).
 */
export function sha256Hex(input: string | Buffer): Hash {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? Buffer.from(input, "utf8") : input);
  return hash.digest("hex") as Hash;
}

/**
 * Canonicalize a value (RFC 8785 JCS subset) and SHA-256 hash it.
 * Returns Err if canonicalization fails.
 */
export function hashCanonical(value: unknown): Result<Hash, CanonicalError> {
  const r = canonicalize(value);
  if (!r.ok) return r;
  return ok(sha256Hex(r.value));
}

/**
 * Constant-time comparison of two hex strings.
 *
 * Returns false if lengths differ (different hash algorithms / truncation),
 * without leaking timing information about content.
 *
 * Uses node:crypto timingSafeEqual on the byte buffers.
 * CODING.md §7: "Compare secrets and hashes with timingSafeEqual."
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
