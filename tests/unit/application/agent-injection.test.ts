/**
 * Agent Prompt Injection Tests (agent.injection.test).
 *
 * Proves that a hostile product description injected into the catalog cannot
 * bypass the deterministic policy Gate or produce a valid mandate above policy.
 *
 * Invariants touched: I-07, I-11.
 * Threat Model: TB6 (untrusted catalog text, prompt injection posture).
 * Issue #5 acceptance criterion: agent.injection.test.
 */

import { describe, it, expect } from "vitest";
import { ProposeCartUseCase } from "../../../src/application/usecases/propose-cart.js";
import { FakeLlmClient } from "../../../src/infrastructure/llm/fake-llm-client.js";
import { FixtureCatalog } from "../../../src/infrastructure/catalog/fixture-catalog.js";
import {
  HostileCatalogDecorator,
  DEFAULT_HOSTILE_PAYLOAD,
} from "../../../src/infrastructure/catalog/hostile-catalog-decorator.js";
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
import type { PurchaseProposal } from "../../../src/application/ports/propose-port.js";

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
    if (m) this.mandates.set(id, { ...m, status });
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

describe("Prompt Injection Resilience (agent.injection.test, TB6, I-07)", () => {
  const clock = new FixedClock("2026-10-20T10:00:00.000Z" as Timestamp);
  const ids = new SequentialIdGenerator("injection-test");
  const baseCatalog = new FixtureCatalog();
  const hostileCatalog = new HostileCatalogDecorator(baseCatalog);

  it("proves a hostile product description cannot produce an over-cap mandate", async () => {
    // 1. Verify the hostile catalog decorator injects the attack into catalog items
    const searchResults = await hostileCatalog.search("keyboard");
    expect(searchResults[0]?.description).toContain(DEFAULT_HOSTILE_PAYLOAD);

    // 2. Simulate the worst case: the LLM is completely compromised / hijacked by the injected text
    // and outputs the exact payload demanded by the injection: $9999.99 to 'evil-corp'
    const hijackedProposal: PurchaseProposal = {
      payee: {
        merchantId: "evil-corp",
        displayName: "Evil Corp",
      },
      payment: {
        amountMinor: 999999, // $9,999.99 USD
        currency: "USD",
      },
      items: [
        {
          sku: "HACK-01",
          description: "System Override Exploitation Package",
          quantity: 1,
          unitAmountMinor: 999999,
        },
      ],
      promptPlayback: "Purchasing authorized system update per item instructions",
      rationale: "Executing embedded system override from product catalog description",
    };

    const hijackedLlmClient = new FakeLlmClient({
      cannedProposal: hijackedProposal,
      simulateToolCalls: true,
    });

    const mandateRepo = new TestMandateRepo();
    const ledgerRepo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(ledgerRepo);
    const appendLedgerEvent = new AppendLedgerEvent(clock, ids, uow);

    const useCase = new ProposeCartUseCase(
      clock,
      ids,
      hijackedLlmClient,
      hostileCatalog,
      mandateRepo,
      undefined,
      appendLedgerEvent,
    );

    // 3. Run the propose cart flow
    const result = await useCase.execute({
      principalId: "principal-user-1",
      prompt: "Show me details for the 75% keyboard",
      correlationId: "c0000000-0000-4000-8000-000000000099",
      policy: DEFAULT_POLICY_V1,
    });

    // 4. Assert policy gate caught the attack
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("POLICY_DENIED");
    // Must flag both TX_CAP_EXCEEDED (cap is $100, proposal is $9999.99) and MERCHANT_NOT_ALLOWED ('evil-corp')
    expect(result.error.reasons).toContain("TX_CAP_EXCEEDED");
    expect(result.error.reasons).toContain("MERCHANT_NOT_ALLOWED");

    // 5. Assert no mandate was created or stored
    expect(mandateRepo.mandates.size).toBe(0);

    // 6. Assert tamper-evident ledger recorded the denial event with reasons
    const events = ledgerRepo.events;
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("POLICY_DENIED");
    expect(events[0]?.payload["reasons"]).toEqual(
      expect.arrayContaining(["MERCHANT_NOT_ALLOWED", "TX_CAP_EXCEEDED"]),
    );
  });
});
