/**
 * ProposeCartUseCase Unit Tests.
 *
 * Verifies end-to-end proposal generation, policy evaluation, authority signing,
 * persistence, and tamper-evident ledger event emission.
 *
 * Issue #5, ARCHITECTURE.md §4.1, §5, §14, INVARIANTS I-04, I-07, I-10, I-11.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  ProposeCartUseCase,
  type AuthorityKeyPair,
} from "../../../src/application/usecases/propose-cart.js";
import { FakeLlmClient } from "../../../src/infrastructure/llm/fake-llm-client.js";
import { FixtureCatalog } from "../../../src/infrastructure/catalog/fixture-catalog.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import { InMemoryLedgerRepo, FakeUnitOfWork } from "../../fakes/in-memory-ledger-repo.js";
import { AppendLedgerEvent } from "../../../src/application/usecases/append-ledger-event.js";
import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../../src/domain/gate/gate.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import { DEFAULT_POLICY_V1 } from "../../../src/domain/policy/policy.js";
import type { Timestamp } from "../../../src/domain/shared/clock.js";
import { verifyHash } from "../../../src/domain/crypto/signing.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";

class TestMandateRepo implements MandateRepo {
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

  async lockMandate(_id: string): Promise<void> {}

  async createMandate(mandate: {
    id: string;
    kind: "CART" | "INTENT";
    correlationId: string;
    principalId: string;
    agentId: string;
    terms: StoredMandateRecord["terms"];
    hash: string;
    attestations: StoredMandateRecord["attestations"];
    status: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredMandateRecord> {
    const record: StoredMandateRecord = {
      terms: mandate.terms,
      hash: mandate.hash,
      attestations: mandate.attestations,
      status: mandate.status,
    };
    this.mandates.set(mandate.id, record);
    return record;
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
    this.consents.set(consent.mandateId, consent);
    return consent;
  }
}

describe("ProposeCartUseCase", () => {
  let authorityPair: AuthorityKeyPair;
  const clock = new FixedClock("2026-10-20T10:00:00.000Z" as Timestamp);
  const ids = new SequentialIdGenerator("proposal-test");
  const catalog = new FixtureCatalog();

  beforeAll(() => {
    const pair = generateKeyPairSync("ed25519");
    authorityPair = {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    };
  });

  it("happy path: generates proposal, evaluates policy, builds mandate, attests, and records ledger events", async () => {
    const mandateRepo = new TestMandateRepo();
    const ledgerRepo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(ledgerRepo);
    const appendLedgerEvent = new AppendLedgerEvent(clock, ids, uow);
    const llmClient = new FakeLlmClient();

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      llmClient,
      catalog,
      mandateRepo,
      authorityPair,
      appendLedgerEvent,
    );

    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "I want to buy a 75% mechanical keyboard from ShopX",
      correlationId: "c0000000-0000-4000-8000-000000000001",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { mandate, proposal, evaluation } = result.value;

    // 1. Verify proposal details
    expect(proposal.payee.merchantId).toBe("shopx");
    expect(proposal.payment.amountMinor).toBe(8500); // $85.00
    expect(proposal.payment.currency).toBe("USD");
    expect(proposal.promptPlayback).toContain("Buy the 75% keyboard from ShopX for $85.00");

    // 2. Verify policy passed
    expect(evaluation.decision).toBe("ALLOW");
    expect(evaluation.reasons).toEqual([]);

    // 3. Verify mandate terms
    expect(mandate.terms.kind).toBe("CART");
    if (mandate.terms.kind !== "CART") return;
    expect(mandate.terms.principalId).toBe("principal-user-1");
    expect(mandate.terms.payment.amountMinor).toBe(8500);
    expect(mandate.terms.payment.currency).toBe("USD");
    expect(mandate.terms.promptPlayback).toBe(proposal.promptPlayback);
    expect(mandate.status).toBe("ISSUED");

    // 4. Verify authority attestation signature over hash
    expect(mandate.attestations).toHaveLength(1);
    expect(mandate.attestations[0]?.role).toBe("AUTHORITY");
    const sigValid = verifyHash(
      mandate.hash as Hash,
      mandate.attestations[0]?.signature ?? "",
      authorityPair.publicKey,
    );
    expect(sigValid).toBe(true);

    // 5. Verify persisted in MandateRepo
    const stored = await mandateRepo.findMandateById(mandate.terms.id);
    expect(stored).not.toBeNull();
    expect(stored?.hash).toBe(mandate.hash);

    // 6. Verify ledger events emitted
    const events = ledgerRepo.events;
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe("PROPOSAL_CREATED");
    expect(events[0]?.actor.type).toBe("agent");
    expect(events[1]?.type).toBe("MANDATE_ISSUED");
    expect(events[1]?.actor.type).toBe("system");
    expect(events[1]?.actor.id).toBe("authority");
  });

  it("denies proposals exceeding transaction cap with POLICY_DENIED and reason code TX_CAP_EXCEEDED", async () => {
    const mandateRepo = new TestMandateRepo();
    const ledgerRepo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(ledgerRepo);
    const appendLedgerEvent = new AppendLedgerEvent(clock, ids, uow);
    const llmClient = new FakeLlmClient();

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      llmClient,
      catalog,
      mandateRepo,
      authorityPair,
      appendLedgerEvent,
    );

    // "expensive" triggers $2500 proposal, which exceeds policy cap ($100 / 10000 minor units)
    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "Buy the most expensive luxury keyboard over-cap",
      correlationId: "c0000000-0000-4000-8000-000000000002",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("POLICY_DENIED");
    expect(result.error.reasons).toContain("TX_CAP_EXCEEDED");
    expect(result.error.proposal?.payment.amountMinor).toBe(250000);

    // Mandate must NEVER be persisted on policy denial
    expect(mandateRepo.mandates.size).toBe(0);

    // POLICY_DENIED event recorded to ledger
    const events = ledgerRepo.events;
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("POLICY_DENIED");
    expect(events[0]?.payload["reasons"]).toContain("TX_CAP_EXCEEDED");
  });

  it("denies proposals with unapproved merchants with MERCHANT_NOT_ALLOWED", async () => {
    const mandateRepo = new TestMandateRepo();
    const llmClient = new FakeLlmClient();

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      llmClient,
      catalog,
      mandateRepo,
      authorityPair,
    );

    // "rogue" triggers rogue-merchant proposal
    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "Buy from rogue unauthorized vendor",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("POLICY_DENIED");
    expect(result.error.reasons).toContain("MERCHANT_NOT_ALLOWED");
    expect(mandateRepo.mandates.size).toBe(0);
  });

  it("denies proposals with disallowed currency with CURRENCY_NOT_ALLOWED", async () => {
    const mandateRepo = new TestMandateRepo();
    const llmClient = new FakeLlmClient();

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      llmClient,
      catalog,
      mandateRepo,
      authorityPair,
    );

    // "yen" triggers JPY proposal
    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "Buy keyboard in yen JPY",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("POLICY_DENIED");
    expect(result.error.reasons).toContain("CURRENCY_NOT_ALLOWED");
    expect(mandateRepo.mandates.size).toBe(0);
  });

  it("propagates LLM error without creating mandate or emitting policy denial", async () => {
    const mandateRepo = new TestMandateRepo();
    const llmClient = new FakeLlmClient({
      cannedError: {
        kind: "RATE_LIMITED",
        message: "Gemini 429 rate limit",
        retryable: true,
      },
    });

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      llmClient,
      catalog,
      mandateRepo,
      authorityPair,
    );

    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "Buy a keyboard",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("LLM_ERROR");
    expect(result.error.message).toContain("Gemini 429");
    expect(mandateRepo.mandates.size).toBe(0);
  });
});
