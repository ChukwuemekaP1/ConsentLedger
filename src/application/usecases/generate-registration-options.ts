/**
 * Use case: Generate Passkey Registration Options.
 *
 * Implements server-side WebAuthn registration option generation, challenge creation,
 * challenge persistence with expiry, and user/principal scoping.
 *
 * ARCHITECTURE.md §13, ADR-0002, ADR-0008, INVARIANTS I-05, I-12.
 */

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import { type Result, ok, err } from "../../domain/shared/result.js";
import type { WebAuthnRegistrationPort } from "../ports/webauthn-port.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";

export interface GenerateRegistrationOptionsInput {
  readonly principalId?: string | undefined; // Present if already authenticated; absent if new enrolment
  readonly displayName: string;
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
}

export interface GenerateRegistrationOptionsOutput {
  readonly options: PublicKeyCredentialCreationOptionsJSON;
}

export interface RegistrationOptionsError {
  readonly kind: "PRINCIPAL_NOT_FOUND" | "INVALID_INPUT";
  readonly message: string;
}

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export class GenerateRegistrationOptionsUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly webauthn: WebAuthnRegistrationPort,
    private readonly passkeyRepo: PasskeyRepo,
  ) {}

  async execute(
    input: GenerateRegistrationOptionsInput,
  ): Promise<Result<GenerateRegistrationOptionsOutput, RegistrationOptionsError>> {
    let existingCredentialIds: string[] = [];

    const targetUserId = input.principalId ?? this.idGenerator.uuid();
    if (input.principalId) {
      const principal = await this.passkeyRepo.findPrincipalById(input.principalId);
      if (!principal) {
        return err({
          kind: "PRINCIPAL_NOT_FOUND",
          message: `Principal with id ${input.principalId} not found`,
        });
      }
      const credentials = await this.passkeyRepo.listCredentialsByPrincipalId(input.principalId);
      existingCredentialIds = credentials.map((c) => c.credentialId);
    }

    const { options, challenge } = await this.webauthn.generateOptions({
      rpName: input.rpName,
      rpID: input.rpId,
      userID: targetUserId,
      userName: input.displayName,
      userDisplayName: input.displayName,
      excludeCredentialIDs: existingCredentialIds,
    });

    const now = this.clock.now();
    const expiresAt = this.clock.offsetSeconds(CHALLENGE_TTL_SECONDS);

    await this.passkeyRepo.saveChallenge({
      id: this.idGenerator.uuid(),
      challenge,
      purpose: "registration",
      principalId: input.principalId, // undefined if initial enrolment
      expiresAt,
      createdAt: now,
    });

    return ok({ options });
  }
}
