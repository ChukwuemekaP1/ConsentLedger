/**
 * SimpleWebAuthn Adapter implementing WebAuthnRegistrationPort.
 *
 * Wraps @simplewebauthn/server and converts COSE public keys to SPKI DER base64.
 *
 * ARCHITECTURE.md §3, ADR-0008.
 */

import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type {
  WebAuthnRegistrationPort,
  GenerateRegistrationOptionsParams,
  VerifyRegistrationParams,
  VerifiedRegistrationResult,
} from "../../application/ports/webauthn-port.js";
import { coseToSpkiBase64 } from "./cose-to-spki.js";

export class SimpleWebAuthnAdapter implements WebAuthnRegistrationPort {
  async generateOptions(params: GenerateRegistrationOptionsParams) {
    const excludeCredentials = params.excludeCredentialIDs
      ? params.excludeCredentialIDs.map((id) => ({ id }))
      : undefined;

    const options = await generateRegistrationOptions({
      rpName: params.rpName,
      rpID: params.rpID,
      userID: new TextEncoder().encode(params.userID),
      userName: params.userName,
      userDisplayName: params.userDisplayName,
      timeout: params.timeoutMs ?? 60000,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      ...(excludeCredentials ? { excludeCredentials } : {}),
    });

    return {
      options,
      challenge: options.challenge,
    };
  }

  async verifyRegistration(params: VerifyRegistrationParams): Promise<{
    verified: boolean;
    result?: VerifiedRegistrationResult | undefined;
    error?: string | undefined;
  }> {
    try {
      const verification = await verifyRegistrationResponse({
        response: params.response,
        expectedChallenge: params.expectedChallenge,
        expectedOrigin: params.expectedOrigin,
        expectedRPID: params.expectedRPID,
        requireUserVerification: params.requireUserVerification ?? false,
      });

      if (!verification.verified) {
        return { verified: false, error: "Registration verification failed" };
      }

      const { credential, aaguid, userVerified } = verification.registrationInfo;

      const spkiB64 = coseToSpkiBase64(credential.publicKey);

      const result: VerifiedRegistrationResult = {
        credentialId: credential.id,
        publicKeySpkiB64: spkiB64,
        counter: credential.counter,
        userVerified,
        ...(aaguid ? { aaguid } : {}),
        ...(credential.transports ? { transports: credential.transports } : {}),
      };

      return {
        verified: true,
        result,
      };
    } catch (err) {
      return {
        verified: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
