/**
 * makeVerifiedConsent — test-only factory for VerifiedConsent.
 *
 * The real VerifiedConsent constructor lives in issue 4 (passkey verification).
 * This fake bypasses passkey verification for unit tests.
 *
 * NEVER import this from src/domain or src/application — tests only.
 * NEVER export from src/domain/gate/index.ts.
 */

import type { VerifiedConsent } from "../../src/domain/gate/types.js";
import type { Timestamp } from "../../src/domain/shared/clock.js";

/**
 * Create a VerifiedConsent for testing.
 * The mandateHash must match the mandate being tested (I-05).
 */
export function makeVerifiedConsent(
  mandateHash: string,
  credentialId: string = "test-credential-id",
  verifiedAt: Timestamp = "2026-10-20T10:01:00.000Z" as Timestamp,
): VerifiedConsent {
  // Cast is safe in tests — the brand is a symbol that only exists at compile-time
  return {
    mandateHash,
    credentialId,
    verifiedAt,
  } as unknown as VerifiedConsent;
}
