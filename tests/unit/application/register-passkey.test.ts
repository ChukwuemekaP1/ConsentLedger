import { describe, it, expect } from "vitest";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import type {
  PasskeyRepo,
  StoredPasskeyCredential,
  StoredWebAuthnChallenge,
  StoredPrincipal,
} from "../../../src/application/ports/passkey-repo.js";
import type {
  WebAuthnRegistrationPort,
  GenerateRegistrationOptionsParams,
  VerifyRegistrationParams,
} from "../../../src/application/ports/webauthn-port.js";
import { GenerateRegistrationOptionsUseCase } from "../../../src/application/usecases/generate-registration-options.js";
import { RegisterPasskeyUseCase } from "../../../src/application/usecases/register-passkey.js";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

class InMemoryPasskeyRepo implements PasskeyRepo {
  principals = new Map<string, StoredPrincipal>();
  challenges = new Map<string, StoredWebAuthnChallenge>();
  credentials = new Map<string, StoredPasskeyCredential>();

  async findPrincipalById(id: string): Promise<StoredPrincipal | null> {
    return this.principals.get(id) ?? null;
  }

  async createPrincipal(principal: {
    id: string;
    displayName: string;
    createdAt: string;
  }): Promise<StoredPrincipal> {
    const record: StoredPrincipal = { ...principal };
    this.principals.set(principal.id, record);
    return record;
  }

  async saveChallenge(challenge: {
    id: string;
    challenge: string;
    purpose: "registration" | "authentication" | "consent";
    principalId?: string | undefined;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredWebAuthnChallenge> {
    const record: StoredWebAuthnChallenge = { ...challenge };
    this.challenges.set(challenge.challenge, record);
    return record;
  }

  async findAndConsumeChallenge(challenge: string): Promise<StoredWebAuthnChallenge | null> {
    const record = this.challenges.get(challenge);
    if (!record) return null;
    this.challenges.delete(challenge);
    return record;
  }

  async findCredentialByCredentialId(
    credentialId: string,
  ): Promise<StoredPasskeyCredential | null> {
    return this.credentials.get(credentialId) ?? null;
  }

  async listCredentialsByPrincipalId(principalId: string): Promise<StoredPasskeyCredential[]> {
    return Array.from(this.credentials.values()).filter((c) => c.principalId === principalId);
  }

  async saveCredential(credential: {
    id: string;
    principalId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[] | undefined;
    aaguid?: string | undefined;
    createdAt: string;
  }): Promise<StoredPasskeyCredential> {
    const record: StoredPasskeyCredential = { ...credential };
    this.credentials.set(credential.credentialId, record);
    return record;
  }
}

class FakeWebAuthnAdapter implements WebAuthnRegistrationPort {
  mockVerifyResult: { verified: boolean; error?: string } = { verified: true };

  async generateOptions(params: GenerateRegistrationOptionsParams) {
    return {
      options: {
        challenge: "test-challenge-123",
        rp: { name: params.rpName, id: params.rpID },
        user: { id: params.userID, name: params.userName, displayName: params.userDisplayName },
        pubKeyCredParams: [{ alg: -7, type: "public-key" as const }],
      },
      challenge: "test-challenge-123",
    };
  }

  async verifyRegistration(_params: VerifyRegistrationParams) {
    if (!this.mockVerifyResult.verified) {
      return { verified: false, error: this.mockVerifyResult.error ?? "Verification failed" };
    }

    return {
      verified: true,
      result: {
        credentialId: "cred-abc-123",
        publicKeySpkiB64: "mock-spki-b64",
        counter: 1,
        userVerified: true,
      },
    };
  }
}

describe("Passkey Registration Use Cases", () => {
  const clock = new FixedClock("2026-10-19T12:00:00.000Z");
  const idGen = new SequentialIdGenerator();

  function makeRegistrationResponse(
    challenge: string,
    credId = "cred-abc-123",
  ): RegistrationResponseJSON {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge,
        origin: "http://localhost:3000",
      }),
    ).toString("base64url");

    return {
      id: credId,
      rawId: credId,
      response: {
        clientDataJSON,
        attestationObject: "mock-attestation",
      },
      type: "public-key",
      clientExtensionResults: {},
    };
  }

  it("successfully generates options for a new enrolment and saves challenge", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();
    const useCase = new GenerateRegistrationOptionsUseCase(clock, idGen, webauthn, repo);

    const result = await useCase.execute({
      displayName: "Alice",
      rpId: "localhost",
      rpName: "ConsentLedger",
      origin: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.options.challenge).toBe("test-challenge-123");
    }

    // Verify challenge was saved with 5 min TTL
    expect(repo.challenges.has("test-challenge-123")).toBe(true);
    const saved = repo.challenges.get("test-challenge-123");
    expect(saved?.expiresAt).toBe("2026-10-19T12:05:00.000Z");
    expect(saved?.purpose).toBe("registration");
  });

  it("successfully registers a passkey on new enrolment and creates Principal", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();

    // Prepare challenge
    await repo.saveChallenge({
      id: "ch-1",
      challenge: "valid-challenge",
      purpose: "registration",
      expiresAt: "2026-10-19T12:05:00.000Z",
      createdAt: clock.now(),
    });

    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);
    const response = makeRegistrationResponse("valid-challenge", "cred-1");

    const result = await useCase.execute({
      response,
      displayName: "Alice",
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.credentialId).toBe("cred-abc-123");
      expect(result.value.principalId).toBeDefined();

      // Check principal was created
      const principal = await repo.findPrincipalById(result.value.principalId);
      expect(principal?.displayName).toBe("Alice");

      // Check credential was persisted
      const credential = await repo.findCredentialByCredentialId("cred-abc-123");
      expect(credential?.principalId).toBe(result.value.principalId);
      expect(credential?.publicKey).toBe("mock-spki-b64");
    }

    // Check challenge was consumed (single-use)
    expect(repo.challenges.has("valid-challenge")).toBe(false);
  });

  it("rejects registration when challenge is not found (or already consumed)", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();
    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);

    const response = makeRegistrationResponse("missing-challenge");
    const result = await useCase.execute({
      response,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("CHALLENGE_NOT_FOUND");
    }
  });

  it("rejects registration when challenge is expired", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();

    // Challenge expired 1 second ago
    await repo.saveChallenge({
      id: "ch-expired",
      challenge: "expired-challenge",
      purpose: "registration",
      expiresAt: "2026-10-19T11:59:59.000Z",
      createdAt: "2026-10-19T11:54:59.000Z",
    });

    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);
    const response = makeRegistrationResponse("expired-challenge");
    const result = await useCase.execute({
      response,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("CHALLENGE_EXPIRED");
    }
  });

  it("rejects registration when credential ID already exists", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();

    await repo.saveCredential({
      id: "c-existing",
      principalId: "p-1",
      credentialId: "cred-duplicate",
      publicKey: "key",
      counter: 0,
      createdAt: clock.now(),
    });

    await repo.saveChallenge({
      id: "ch-dup",
      challenge: "dup-challenge",
      purpose: "registration",
      expiresAt: "2026-10-19T12:05:00.000Z",
      createdAt: clock.now(),
    });

    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);
    const response = makeRegistrationResponse("dup-challenge", "cred-duplicate");
    const result = await useCase.execute({
      response,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("CREDENTIAL_ALREADY_EXISTS");
    }
  });

  it("rejects registration when challenge belongs to another principal (cross-user attack)", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();

    await repo.saveChallenge({
      id: "ch-user1",
      challenge: "user1-challenge",
      purpose: "registration",
      principalId: "principal-user-1",
      expiresAt: "2026-10-19T12:05:00.000Z",
      createdAt: clock.now(),
    });

    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);
    const response = makeRegistrationResponse("user1-challenge");

    // Attacker authenticated as principal-user-2 attempts to claim user1's challenge
    const result = await useCase.execute({
      response,
      authenticatedPrincipalId: "principal-user-2",
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("PRINCIPAL_MISMATCH");
    }
  });

  it("rejects registration when WebAuthn verification fails", async () => {
    const repo = new InMemoryPasskeyRepo();
    const webauthn = new FakeWebAuthnAdapter();
    webauthn.mockVerifyResult = { verified: false, error: "RP ID mismatch" };

    await repo.saveChallenge({
      id: "ch-fail",
      challenge: "fail-challenge",
      purpose: "registration",
      expiresAt: "2026-10-19T12:05:00.000Z",
      createdAt: clock.now(),
    });

    const useCase = new RegisterPasskeyUseCase(clock, idGen, webauthn, repo);
    const response = makeRegistrationResponse("fail-challenge");

    const result = await useCase.execute({
      response,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("VERIFICATION_FAILED");
      expect(result.error.message).toBe("RP ID mismatch");
    }

    // Confirm that failed verification never persists credential or creates principal
    expect(repo.credentials.size).toBe(0);
    expect(repo.principals.size).toBe(0);
  });
});
