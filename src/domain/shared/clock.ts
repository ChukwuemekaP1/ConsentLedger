/**
 * Clock and IdGenerator ports — types only.
 *
 * Domain and application code never call Date.now(), new Date(), Math.random(),
 * or crypto.randomUUID() directly. They receive a Clock or IdGenerator through
 * dependency injection.
 *
 * Implementations live in src/infrastructure/clock/.
 * Fakes for testing live in tests/fakes/.
 *
 * CODING.md §4: "Purity, time and randomness."
 * INVARIANTS: I-12, enforced additionally by ESLint no-restricted-* rules.
 */

import type { Brand } from "./brand.js";

/** ISO-8601 UTC timestamp string, e.g. "2026-10-11T14:00:00.000Z". */
export type Timestamp = Brand<string, "Timestamp">;

/** RFC 4122 UUID v4 string. */
export type Uuid = Brand<string, "Uuid">;

/**
 * Clock port — provides the current time.
 * Inject this wherever domain or application code needs "now".
 */
export interface Clock {
  /** Returns the current time as a branded Timestamp (ISO-8601 UTC). */
  now(): Timestamp;

  /** Returns an ISO-8601 UTC timestamp offset by seconds from now. */
  offsetSeconds(seconds: number): Timestamp;
}

/**
 * IdGenerator port — provides cryptographically random identifiers.
 * Inject this wherever domain or application code needs a fresh UUID or nonce.
 */
export interface IdGenerator {
  /** Returns a fresh UUID v4. */
  uuid(): Uuid;

  /**
   * Returns `bytes` random bytes as a lowercase hex string.
   * Used for mandate nonces (32 bytes → 64-char hex).
   */
  nonceHex(bytes: number): string;
}
