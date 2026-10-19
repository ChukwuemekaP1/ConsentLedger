/**
 * WebAuthn port definitions.
 *
 * Provides abstraction for WebAuthn option generation and registration verification.
 * Decouples use cases from @simplewebauthn/server.
 *
 * ARCHITECTURE.md §3, ADR-0008.
 */

import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

export interface GenerateRegistrationOptionsParams {
  readonly rpName: string;
  readonly rpID: string;
  readonly userID: string;
  readonly userName: string;
  readonly userDisplayName: string;
  readonly timeoutMs?: number | undefined;
  readonly excludeCredentialIDs?: string[] | undefined;
}

export interface VerifyRegistrationParams {
  readonly response: RegistrationResponseJSON;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly requireUserVerification?: boolean | undefined;
}

export interface VerifiedRegistrationResult {
  readonly credentialId: string;
  readonly publicKeySpkiB64: string;
  readonly counter: number;
  readonly aaguid?: string | undefined;
  readonly transports?: string[] | undefined;
  readonly userVerified: boolean;
}

export interface WebAuthnRegistrationPort {
  generateOptions(
    params: GenerateRegistrationOptionsParams,
  ): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challenge: string }>;

  verifyRegistration(params: VerifyRegistrationParams): Promise<{
    verified: boolean;
    result?: VerifiedRegistrationResult | undefined;
    error?: string | undefined;
  }>;
}
