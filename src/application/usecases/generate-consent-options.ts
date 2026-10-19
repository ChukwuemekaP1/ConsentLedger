/**
 * Use case: Generate Mandate Consent Options.
 *
 * Checks pre-consent Gate eligibility (mandate validity, hash integrity, attestations, policy).
 * Generates an authentication challenge bound to the exact mandate hash.
 * Persists challenge with principal/mandate scope and 5-minute TTL.
 *
 * ARCHITECTURE.md §4.2, §13, INVARIANTS I-05, I-11, I-12.
 */

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import { type Result, ok, err } from "../../domain/shared/result.js";
import type { PasskeyRepo } from "../ports/passkey-repo.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { TrustedKeys } from "../../domain/gate/gate.js";
import { evaluatePreConsentGate } from "../../domain/gate/gate.js";

export interface GenerateConsentOptionsInput {
  readonly mandateId: string;
  readonly authenticatedPrincipalId: string;
  readonly rpId: string;
  readonly trustedKeys: TrustedKeys;
}

export interface GenerateConsentOptionsOutput {
  readonly options: PublicKeyCredentialRequestOptionsJSON;
  readonly mandateHash: string;
}

export interface ConsentOptionsError {
  readonly kind:
    "MANDATE_NOT_FOUND" | "FORBIDDEN" | "POLICY_NOT_FOUND" | "GATE_DENIED" | "NO_CREDENTIALS";
  readonly message: string;
}

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export class GenerateConsentOptionsUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly passkeyRepo: PasskeyRepo,
    private readonly mandateRepo: MandateRepo,
  ) {}

  async execute(
    input: GenerateConsentOptionsInput,
  ): Promise<Result<GenerateConsentOptionsOutput, ConsentOptionsError>> {
    // 1. Load authoritative mandate
    const mandate = await this.mandateRepo.findMandateById(input.mandateId);
    if (!mandate) {
      return err({ kind: "MANDATE_NOT_FOUND", message: `Mandate ${input.mandateId} not found` });
    }

    // 2. Ownership / IDOR check (principalId on mandate terms must match authenticated user)
    if (mandate.terms.principalId !== input.authenticatedPrincipalId) {
      return err({
        kind: "FORBIDDEN",
        message: "Principal does not have authorization to consent to this mandate",
      });
    }

    // 3. Load policies for Gate check
    const pinnedPolicyRef = mandate.terms.policy;
    const pinnedPolicy = await this.mandateRepo.findPolicyById(pinnedPolicyRef.id);
    if (!pinnedPolicy) {
      return err({
        kind: "POLICY_NOT_FOUND",
        message: `Pinned policy ${pinnedPolicyRef.id} not found`,
      });
    }

    const currentPolicy =
      (await this.mandateRepo.findActivePolicy(pinnedPolicyRef.id)) ?? pinnedPolicy;

    // 4. Run pre-consent Gate check (status, validity, hash integrity, attestations, policy drift)
    const now = this.clock.now();
    const gateResult = evaluatePreConsentGate({
      mandate,
      trustedKeys: input.trustedKeys,
      pinnedPolicy,
      currentPolicy,
      now,
    });

    if (!gateResult.ok) {
      return err({
        kind: "GATE_DENIED",
        message: `Gate denied approval preparation: ${gateResult.error.message} (${gateResult.error.code})`,
      });
    }

    // 5. Look up registered passkeys for this principal
    const credentials = await this.passkeyRepo.listCredentialsByPrincipalId(
      input.authenticatedPrincipalId,
    );
    if (credentials.length === 0) {
      return err({
        kind: "NO_CREDENTIALS",
        message: "Principal has no registered passkey credentials",
      });
    }

    // 6. Challenge is the mandate hash (base64url encoded for WebAuthn API)
    // mandate.hash is a 64-char hex string. Buffer.from(hash, "hex").toString("base64url")
    const challengeB64Url = Buffer.from(mandate.hash, "hex").toString("base64url");

    // 7. Save challenge server-side bound to mandate and principal with 5 min TTL
    const expiresAt = this.clock.offsetSeconds(CHALLENGE_TTL_SECONDS);
    await this.passkeyRepo.saveChallenge({
      id: this.idGenerator.uuid(),
      challenge: challengeB64Url,
      purpose: "consent",
      principalId: input.authenticatedPrincipalId,
      expiresAt,
      createdAt: now,
    });

    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge: challengeB64Url,
      rpId: input.rpId,
      timeout: 60000,
      userVerification: "required", // INVARIANT I-05: UV is mandatory
      allowCredentials: credentials.map((c) => {
        const item: {
          id: string;
          type: "public-key";
          transports?: ("usb" | "ble" | "nfc" | "internal")[];
        } = {
          id: c.credentialId,
          type: "public-key",
        };
        if (c.transports && c.transports.length > 0) {
          item.transports = c.transports as ("usb" | "ble" | "nfc" | "internal")[];
        }
        return item;
      }),
    };

    return ok({
      options,
      mandateHash: mandate.hash,
    });
  }
}
