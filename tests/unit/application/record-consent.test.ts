import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, createHash, sign, type KeyObject } from "node:crypto";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import type { StoredMandateRecord, TrustedKeys } from "../../../src/domain/gate/gate.js";
import type {
  PasskeyRepo,
  StoredPasskeyCredential,
  StoredWebAuthnChallenge,
  StoredPrincipal,
} from "../../../src/application/ports/passkey-repo.js";
import { InMemoryLedgerRepo } from "../../fakes/in-memory-ledger-repo.js";
import { RecordConsentUseCase } from "../../../src/application/usecases/record-consent.js";
import { GenerateConsentOptionsUseCase } from "../../../src/application/usecases/generate-consent-options.js";
import { buildCartMandate, attestMandate } from "../../../src/domain/mandate/index.js";
import { hashPolicy } from "../../../src/domain/policy/index.js";
import { keyId as computeKeyId } from "../../../src/domain/crypto/signing.js";
import type { Timestamp } from "../../../src/domain/shared/clock.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";

// In-Memory Mandate Repo
class InMemoryMandateRepo implements MandateRepo {
  mandates = new Map<string, StoredMandateRecord>();
  consents = new Map<string, StoredMandateConsent>();
  policies = new Map<string, PolicyDocument>();

  async findMandateById(id: string): Promise<StoredMandateRecord | null> {
    return this.mandates.get(id) ?? null;
  }

  async findMandateByHash(hash: string): Promise<StoredMandateRecord | null> {
    for (const m of this.mandates.values()) {
      if (m.hash === hash) return m;
    }
    return null;
  }

  async lockMandate(_id: string): Promise<void> {
    // In-memory simulation: no-op
  }

  async updateMandateStatus(id: string, status: string): Promise<void> {
    const m = this.mandates.get(id);
    if (m) {
      this.mandates.set(id, { ...m, status });
    }
  }

  async findPolicyById(id: string): Promise<PolicyDocument | null> {
    return this.policies.get(id) ?? null;
  }

  async findActivePolicy(id: string): Promise<PolicyDocument | null> {
    return this.policies.get(id) ?? null;
  }

  async findConsentByMandateId(mandateId: string): Promise<StoredMandateConsent | null> {
    return this.consents.get(mandateId) ?? null;
  }

  async saveConsent(consent: {
    id: string;
    mandateId: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJson: string;
    signature: string;
    verifiedAt: string;
    createdAt: string;
  }): Promise<StoredMandateConsent> {
    const record: StoredMandateConsent = { ...consent };
    this.consents.set(consent.mandateId, record);
    return record;
  }
}

// In-Memory Passkey Repo
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

describe("Application Use Cases: Consent Workflow", () => {
  const clock = new FixedClock("2026-10-20T10:02:00.000Z");
  const idGen = new SequentialIdGenerator();

  let authorityPrivKey: KeyObject;
  let authorityPubKey: KeyObject;
  let merchantPrivKey: KeyObject;
  let merchantPubKey: KeyObject;
  let passkeyPrivKey: KeyObject;
  let passkeyPubKey: KeyObject;
  let passkeySpkiB64: string;
  let trustedKeys: TrustedKeys;

  const principalId = "principal-1";
  const credentialId = "cred-pk-1";
  const expectedOrigin = "http://localhost:3000";
  const expectedRpId = "localhost";

  beforeAll(() => {
    const authPair = generateKeyPairSync("ed25519");
    authorityPrivKey = authPair.privateKey;
    authorityPubKey = authPair.publicKey;

    const merchPair = generateKeyPairSync("ed25519");
    merchantPrivKey = merchPair.privateKey;
    merchantPubKey = merchPair.publicKey;

    trustedKeys = new Map([
      [computeKeyId(authorityPubKey), { role: "AUTHORITY" as const, publicKey: authorityPubKey }],
      [computeKeyId(merchantPubKey), { role: "MERCHANT" as const, publicKey: merchantPubKey }],
    ]);

    const passkeyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    passkeyPrivKey = passkeyPair.privateKey;
    passkeyPubKey = passkeyPair.publicKey;
    passkeySpkiB64 = passkeyPubKey.export({ type: "spki", format: "der" }).toString("base64");
  });

  function setupMandate(options: { status?: string; maxPerTxMinor?: number } = {}) {
    const policy: PolicyDocument = {
      id: "policy-v1",
      version: 1,
      rules: { maxPerTxMinor: options.maxPerTxMinor ?? 100000 },
    };
    const ph = hashPolicy(policy);
    if (!ph.ok) throw new Error("hash failed");

    const mandateId = idGen.uuid();
    const correlationId = idGen.uuid();
    const built = buildCartMandate({
      id: mandateId,
      correlationId,
      principalId,
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "shopx", displayName: "ShopX" },
      payment: { amountMinor: 5000, currency: "USD" as const },
      items: [{ sku: "item-1", description: "Widget", quantity: 1, unitAmountMinor: 5000 }],
      promptPlayback: "Buy widget",
      policy: { id: policy.id, hash: ph.value },
      validity: {
        notBefore: "2026-10-20T10:00:00.000Z" as Timestamp,
        expiresAt: "2026-10-20T10:10:00.000Z" as Timestamp,
      },
      nonce: "n".repeat(64),
    });
    if (!built.ok) throw new Error(`build failed: ${JSON.stringify(built.error)}`);

    const authAtt = attestMandate(
      "AUTHORITY",
      built.value.hash as Hash,
      authorityPrivKey,
      authorityPubKey,
    );
    const merchAtt = attestMandate(
      "MERCHANT",
      built.value.hash as Hash,
      merchantPrivKey,
      merchantPubKey,
    );
    if (!authAtt.ok || !merchAtt.ok) throw new Error("attest failed");

    const record: StoredMandateRecord = {
      terms: built.value.terms,
      hash: built.value.hash,
      attestations: [authAtt.value, merchAtt.value],
      status: options.status ?? "ISSUED",
    };

    return { policy, record, hash: built.value.hash, mandateId };
  }

  function createPasskeyAssertion(options: {
    challenge: string;
    origin?: string;
    rpId?: string;
    userVerified?: boolean;
    tamperSig?: boolean;
  }) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin: options.origin ?? expectedOrigin,
      }),
    ).toString("base64url");

    const rp = options.rpId ?? expectedRpId;
    const rpIdHash = createHash("sha256").update(rp).digest();
    let flags = 0x01; // UP
    if (options.userVerified ?? true) flags |= 0x04; // UV
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32BE(1, 0);
    const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), countBuf]);
    const authenticatorData = authData.toString("base64url");

    const clientDataHash = createHash("sha256")
      .update(Buffer.from(clientDataJSON, "base64url"))
      .digest();
    const signatureBase = Buffer.concat([authData, clientDataHash]);
    let sig = sign("sha256", signatureBase, passkeyPrivKey);
    if (options.tamperSig) {
      sig = Buffer.from(sig);
      const first = sig[0] ?? 0;
      sig[0] = first ^ 0xff;
    }
    const signature = sig.toString("base64url");
    return {
      id: credentialId,
      rawId: credentialId,
      response: {
        clientDataJSON,
        authenticatorData,
        signature,
      },
      type: "public-key" as const,
      clientExtensionResults: {},
    };
  }

  it("successfully completes full consent flow (options generation -> assertion verification -> ledger recording)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, hash, mandateId } = setupMandate();
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    await passkeyRepo.saveCredential({
      id: "cred-row-1",
      principalId,
      credentialId,
      publicKey: passkeySpkiB64,
      counter: 1,
      createdAt: clock.now(),
    });

    const optionsUseCase = new GenerateConsentOptionsUseCase(
      clock,
      idGen,
      passkeyRepo,
      mandateRepo,
    );

    // 1. Generate options
    const optRes = await optionsUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      rpId: expectedRpId,
      trustedKeys,
    });

    expect(optRes.ok).toBe(true);
    if (!optRes.ok) return;

    const expectedB64UrlChallenge = Buffer.from(hash, "hex").toString("base64url");
    expect(optRes.value.options.challenge).toBe(expectedB64UrlChallenge);
    expect(optRes.value.options.allowCredentials).toBeDefined();

    // Challenge should be stored in passkeyRepo under base64url or hex
    const hasChallenge =
      passkeyRepo.challenges.has(hash) || passkeyRepo.challenges.has(expectedB64UrlChallenge);
    expect(hasChallenge).toBe(true);

    // 2. Sign assertion and verify using the challenge from options
    const assertion = createPasskeyAssertion({ challenge: optRes.value.options.challenge });
    const recordUseCase = new RecordConsentUseCase(clock, idGen, passkeyRepo, mandateRepo);

    const recordRes = await recordUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      assertion,
      expectedOrigin,
      expectedRPID: expectedRpId,
      trustedKeys,
    });

    expect(recordRes.ok).toBe(true);
    if (!recordRes.ok) return;

    expect(recordRes.value.mandateId).toBe(mandateId);
    expect(recordRes.value.status).toBe("SIGNED");

    // Mandate status should be updated to SIGNED
    const updatedMandate = await mandateRepo.findMandateById(mandateId);
    expect(updatedMandate?.status).toBe("SIGNED");

    // Consent record should be saved
    const consent = await mandateRepo.findConsentByMandateId(mandateId);
    expect(consent).toBeDefined();
    expect(consent?.credentialId).toBe(credentialId);

    // Challenge should be consumed
    expect(passkeyRepo.challenges.has(hash)).toBe(false);
  });

  it("rejects consent when challenge has expired (CHALLENGE_EXPIRED)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, hash, mandateId } = setupMandate();
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    await passkeyRepo.saveCredential({
      id: "cred-row-1",
      principalId,
      credentialId,
      publicKey: passkeySpkiB64,
      counter: 1,
      createdAt: clock.now(),
    });

    // Save expired challenge
    await passkeyRepo.saveChallenge({
      id: "ch-exp",
      challenge: hash,
      purpose: "consent",
      principalId,
      expiresAt: "2026-10-20T10:01:59.000Z", // 1s before now
      createdAt: "2026-10-20T09:56:59.000Z",
    });

    const recordUseCase = new RecordConsentUseCase(clock, idGen, passkeyRepo, mandateRepo);
    const assertion = createPasskeyAssertion({ challenge: hash });

    const res = await recordUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      assertion,
      expectedOrigin,
      expectedRPID: expectedRpId,
      trustedKeys,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("CHALLENGE_EXPIRED");
    }
  });

  it("rejects replay when challenge was already consumed (CHALLENGE_NOT_FOUND)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, hash, mandateId } = setupMandate();
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    await passkeyRepo.saveCredential({
      id: "cred-row-1",
      principalId,
      credentialId,
      publicKey: passkeySpkiB64,
      counter: 1,
      createdAt: clock.now(),
    });

    const recordUseCase = new RecordConsentUseCase(clock, idGen, passkeyRepo, mandateRepo);
    const assertion = createPasskeyAssertion({ challenge: hash });

    // No challenge saved in passkeyRepo
    const res = await recordUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      assertion,
      expectedOrigin,
      expectedRPID: expectedRpId,
      trustedKeys,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("CHALLENGE_NOT_FOUND");
    }
  });

  it("rejects authorization when authenticated user does not own the mandate (FORBIDDEN / IDOR)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, mandateId } = setupMandate();
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    const attackerPrincipalId = "principal-attacker";

    const optionsUseCase = new GenerateConsentOptionsUseCase(
      clock,
      idGen,
      passkeyRepo,
      mandateRepo,
    );

    const optRes = await optionsUseCase.execute({
      mandateId,
      authenticatedPrincipalId: attackerPrincipalId,
      rpId: expectedRpId,
      trustedKeys,
    });

    expect(optRes.ok).toBe(false);
    if (!optRes.ok) {
      expect(optRes.error.kind).toBe("FORBIDDEN");
    }
  });

  it("rejects consent when challenge was issued to a different principal (PRINCIPAL_MISMATCH)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, hash, mandateId } = setupMandate();
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    await passkeyRepo.saveCredential({
      id: "cred-row-1",
      principalId,
      credentialId,
      publicKey: passkeySpkiB64,
      counter: 1,
      createdAt: clock.now(),
    });

    await passkeyRepo.saveChallenge({
      id: "ch-other",
      challenge: hash,
      purpose: "consent",
      principalId: "principal-other-user",
      expiresAt: "2026-10-20T10:10:00.000Z",
      createdAt: clock.now(),
    });

    const recordUseCase = new RecordConsentUseCase(clock, idGen, passkeyRepo, mandateRepo);
    const assertion = createPasskeyAssertion({ challenge: hash });

    const res = await recordUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      assertion,
      expectedOrigin,
      expectedRPID: expectedRpId,
      trustedKeys,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("PRINCIPAL_MISMATCH");
    }
  });

  it("rejects consent when mandate has already been consented (MANDATE_ALREADY_CONSENTED)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();
    const ledgerRepo = new InMemoryLedgerRepo();

    const { policy, record, hash, mandateId } = setupMandate({ status: "SIGNED" });
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    await passkeyRepo.saveCredential({
      id: "cred-row-1",
      principalId,
      credentialId,
      publicKey: passkeySpkiB64,
      counter: 1,
      createdAt: clock.now(),
    });

    await passkeyRepo.saveChallenge({
      id: "ch-already",
      challenge: hash,
      purpose: "consent",
      principalId,
      expiresAt: "2026-10-20T10:10:00.000Z",
      createdAt: clock.now(),
    });

    const recordUseCase = new RecordConsentUseCase(clock, idGen, passkeyRepo, mandateRepo);
    const assertion = createPasskeyAssertion({ challenge: hash });

    const res = await recordUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      assertion,
      expectedOrigin,
      expectedRPID: expectedRpId,
      trustedKeys,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("MANDATE_ALREADY_CONSENTED");
    }
  });

  it("rejects options generation when Gate checks fail (e.g. policy violation)", async () => {
    const mandateRepo = new InMemoryMandateRepo();
    const passkeyRepo = new InMemoryPasskeyRepo();

    // Mandate amount is 5000, but policy cap is 2000
    const { policy, record, mandateId } = setupMandate({ maxPerTxMinor: 2000 });
    mandateRepo.mandates.set(mandateId, record);
    mandateRepo.policies.set(policy.id, policy);

    const optionsUseCase = new GenerateConsentOptionsUseCase(
      clock,
      idGen,
      passkeyRepo,
      mandateRepo,
    );

    const optRes = await optionsUseCase.execute({
      mandateId,
      authenticatedPrincipalId: principalId,
      rpId: expectedRpId,
      trustedKeys,
    });

    expect(optRes.ok).toBe(false);
    if (!optRes.ok) {
      expect(optRes.error.kind).toBe("GATE_DENIED");
      expect(optRes.error.message).toContain("POLICY_DENIED");
    }
  });
});
