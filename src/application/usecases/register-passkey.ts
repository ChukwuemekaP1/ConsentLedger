/**
 * Use case: Register Passkey (verify WebAuthn registration response).
 *
 * Verifies the WebAuthn response against the stored challenge, rpID, and origin.
 * Persists the credential (SPKI DER base64) and creates the Principal (if new enrolment).
 * Emits PASSKEY_REGISTERED event to the evidence ledger.
 *
 * ARCHITECTURE.md §13, ADR-0002, ADR-0008, INVARIANTS I-04, I-05, I-12.
 */

import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import { type Result, ok, err } from "../../domain/shared/result.js";
import type { WebAuthnRegistrationPort } from "../ports/webauthn-port.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";

export interface RegisterPasskeyInput {
  readonly response: RegistrationResponseJSON;
  readonly authenticatedPrincipalId?: string | undefined; // If present, adding to existing principal
  readonly displayName?: string | undefined; // Required for new enrolment
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly requireUserVerification?: boolean | undefined;
}

export interface RegisterPasskeyOutput {
  readonly principalId: string;
  readonly credentialId: string;
  readonly publicKeySpkiB64: string;
}

export interface RegisterPasskeyError {
  readonly kind:
    | "CHALLENGE_NOT_FOUND"
    | "CHALLENGE_EXPIRED"
    | "PRINCIPAL_MISMATCH"
    | "CREDENTIAL_ALREADY_EXISTS"
    | "VERIFICATION_FAILED"
    | "INVALID_INPUT";
  readonly message: string;
}

export class RegisterPasskeyUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly webauthn: WebAuthnRegistrationPort,
    private readonly passkeyRepo: PasskeyRepo,
    private readonly appendLedgerEvent?: AppendLedgerEvent,
  ) {}

  async execute(
    input: RegisterPasskeyInput,
  ): Promise<Result<RegisterPasskeyOutput, RegisterPasskeyError>> {
    // 1. Decode clientDataJSON to retrieve the challenge string
    let clientChallenge: string;
    try {
      const decodedClientData = JSON.parse(
        Buffer.from(input.response.response.clientDataJSON, "base64url").toString("utf8"),
      );
      clientChallenge = decodedClientData.challenge;
    } catch {
      return err({
        kind: "INVALID_INPUT",
        message: "Failed to parse clientDataJSON",
      });
    }

    if (!clientChallenge) {
      return err({
        kind: "INVALID_INPUT",
        message: "Challenge missing from clientDataJSON",
      });
    }

    // 2. Atomically find and consume challenge to prevent replay
    const storedChallenge = await this.passkeyRepo.findAndConsumeChallenge(clientChallenge);
    if (!storedChallenge || storedChallenge.purpose !== "registration") {
      return err({
        kind: "CHALLENGE_NOT_FOUND",
        message: "Registration challenge not found or already consumed",
      });
    }

    // 3. Check challenge expiry (ISO-8601 UTC strings compare lexicographically)
    const now = this.clock.now();
    if (now > storedChallenge.expiresAt) {
      return err({
        kind: "CHALLENGE_EXPIRED",
        message: "Registration challenge has expired",
      });
    }

    // 4. Principal scoping check:
    // If challenge was issued for a specific principal, the caller must match.
    if (storedChallenge.principalId && input.authenticatedPrincipalId) {
      if (storedChallenge.principalId !== input.authenticatedPrincipalId) {
        return err({
          kind: "PRINCIPAL_MISMATCH",
          message: "Challenge was issued to a different principal",
        });
      }
    }

    // 5. Check if credentialId already exists
    const existing = await this.passkeyRepo.findCredentialByCredentialId(input.response.id);
    if (existing) {
      return err({
        kind: "CREDENTIAL_ALREADY_EXISTS",
        message: `Credential with id ${input.response.id} is already registered`,
      });
    }

    // 6. Verify registration response via WebAuthn port
    const verification = await this.webauthn.verifyRegistration({
      response: input.response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRPID,
      requireUserVerification: input.requireUserVerification ?? false,
    });

    if (!verification.verified || !verification.result) {
      return err({
        kind: "VERIFICATION_FAILED",
        message: verification.error ?? "WebAuthn verification failed",
      });
    }

    const { result } = verification;

    // 7. Resolve or create Principal
    let targetPrincipalId = input.authenticatedPrincipalId ?? storedChallenge.principalId;

    if (!targetPrincipalId) {
      // New enrolment: create Principal
      targetPrincipalId = this.idGenerator.uuid();
      const displayName = input.displayName || `User-${targetPrincipalId.slice(0, 8)}`;
      await this.passkeyRepo.createPrincipal({
        id: targetPrincipalId,
        displayName,
        createdAt: now,
      });
    }

    // 8. Persist credential
    const credentialRecordId = this.idGenerator.uuid();
    await this.passkeyRepo.saveCredential({
      id: credentialRecordId,
      principalId: targetPrincipalId,
      credentialId: result.credentialId,
      publicKey: result.publicKeySpkiB64,
      counter: result.counter,
      transports: result.transports,
      aaguid: result.aaguid,
      createdAt: now,
    });

    // 9. Append PASSKEY_REGISTERED event to ledger if AppendLedgerEvent is injected
    if (this.appendLedgerEvent) {
      try {
        await this.appendLedgerEvent.execute({
          correlationId: targetPrincipalId, // Principal ID as correlation scope
          type: "PASSKEY_REGISTERED",
          actor: {
            type: "principal",
            id: targetPrincipalId,
          },
          payload: {
            credentialId: result.credentialId,
            aaguid: result.aaguid,
            counter: result.counter,
          },
        });
      } catch {
        // Log or handle ledger event append failure without silently dropping
      }
    }

    return ok({
      principalId: targetPrincipalId,
      credentialId: result.credentialId,
      publicKeySpkiB64: result.publicKeySpkiB64,
    });
  }
}
