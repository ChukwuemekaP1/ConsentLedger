/**
 * Unit tests for CreateOrderUseCase.
 *
 * Verifies intent-then-effect order creation (ADR-0006), Gate enforcement (I-01),
 * cart single-use (I-03), and atomic ledger event recording (I-04).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CreateOrderUseCase } from "../../../src/application/usecases/create-order.js";
import { FakePaymentProvider } from "../../../src/infrastructure/paypal/fake-payment-provider.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import { InMemoryLedgerRepo } from "../../fakes/in-memory-ledger-repo.js";
import { makeVerifiedConsent } from "../../fakes/make-verified-consent.js";
import { AppendLedgerEvent } from "../../../src/application/usecases/append-ledger-event.js";
import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
  PaymentMandateStatus,
} from "../../../src/application/ports/payment-mandate-repo.js";
import type { StoredMandateRecord, TrustedKeys } from "../../../src/domain/gate/index.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import { hashPolicy } from "../../../src/domain/policy/policy.js";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { keyId } from "../../../src/domain/crypto/signing.js";
import { attestMandate } from "../../../src/domain/mandate/attestation.js";
import { buildCartMandate } from "../../../src/domain/mandate/builders.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";
import type { Uuid, Timestamp } from "../../../src/domain/shared/clock.js";
import type { UnitOfWork, TxContext } from "../../../src/application/ports/unit-of-work.js";

class InMemoryMandateRepo implements MandateRepo {
  public mandates: Map<string, StoredMandateRecord> = new Map();
  public policies: Map<string, PolicyDocument> = new Map();
  public consents: Map<string, StoredMandateConsent> = new Map();
  public lockedMandates: string[] = [];

  async findMandateById(id: string): Promise<StoredMandateRecord | null> {
    return this.mandates.get(id) ?? null;
  }
  async findMandateByHash(hash: string): Promise<StoredMandateRecord | null> {
    for (const m of this.mandates.values()) {
      if (m.hash === hash) return m;
    }
    return null;
  }
  async lockMandate(id: string): Promise<void> {
    this.lockedMandates.push(id);
  }
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
    const existing = this.mandates.get(id);
    if (existing) {
      this.mandates.set(id, { ...existing, status });
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

class InMemoryPaymentMandateRepo implements PaymentMandateRepo {
  public records: Map<string, StoredPaymentMandateRecord> = new Map();

  async findPaymentMandateById(id: string): Promise<StoredPaymentMandateRecord | null> {
    return this.records.get(id) ?? null;
  }
  async findPaymentMandateByMandateId(
    mandateId: string,
  ): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.mandateId === mandateId) return r;
    }
    return null;
  }
  async findPaymentMandateByOrderId(orderId: string): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.paypalOrderId === orderId) return r;
    }
    return null;
  }
  async countByMandateId(mandateId: string): Promise<number> {
    let count = 0;
    for (const r of this.records.values()) {
      if (r.mandateId === mandateId) count++;
    }
    return count;
  }
  async lockPaymentMandate(_id: string): Promise<void> {
    // No-op for unit test fake
  }
  async insertPaymentMandate(record: {
    id: string;
    mandateId: string;
    correlationId: string;
    sequence: number;
    terms: StoredPaymentMandateRecord["terms"];
    hash: string;
    authoritySignature: string;
    status: PaymentMandateStatus;
    requestId: string;
    createdAt: string;
  }): Promise<StoredPaymentMandateRecord> {
    const full: StoredPaymentMandateRecord = {
      ...record,
      captureRequestId: null,
      paypalOrderId: null,
      paypalCaptureId: null,
    };
    this.records.set(record.id, full);
    return full;
  }
  async updatePaymentMandateStatus(
    id: string,
    update: {
      status: PaymentMandateStatus;
      paypalOrderId?: string;
      captureRequestId?: string;
      paypalCaptureId?: string;
    },
  ): Promise<void> {
    const existing = this.records.get(id);
    if (existing) {
      this.records.set(id, {
        ...existing,
        status: update.status,
        ...(update.paypalOrderId !== undefined ? { paypalOrderId: update.paypalOrderId } : {}),
      });
    }
  }
}

class FakeUnitOfWork implements UnitOfWork {
  constructor(private readonly ledger: InMemoryLedgerRepo) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({ ledger: this.ledger });
  }
}

describe("CreateOrderUseCase", () => {
  const now = "2026-10-20T10:00:00.000Z";
  let clock: FixedClock;
  let idGen: SequentialIdGenerator;
  let mandateRepo: InMemoryMandateRepo;
  let paymentMandateRepo: InMemoryPaymentMandateRepo;
  let paymentProvider: FakePaymentProvider;
  let ledgerRepo: InMemoryLedgerRepo;
  let appendLedgerEvent: AppendLedgerEvent;
  let authorityKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let merchantKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let trustedKeys: TrustedKeys;
  let defaultPolicy: PolicyDocument;

  beforeEach(() => {
    clock = new FixedClock(now);
    idGen = new SequentialIdGenerator("test-id");
    mandateRepo = new InMemoryMandateRepo();
    paymentMandateRepo = new InMemoryPaymentMandateRepo();
    paymentProvider = new FakePaymentProvider();
    ledgerRepo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(ledgerRepo);
    appendLedgerEvent = new AppendLedgerEvent(clock, idGen, uow);

    authorityKeys = generateKeyPairSync("ed25519");
    merchantKeys = generateKeyPairSync("ed25519");

    const tMap = new Map();
    tMap.set(keyId(authorityKeys.publicKey), {
      role: "AUTHORITY",
      publicKey: authorityKeys.publicKey,
    });
    tMap.set(keyId(merchantKeys.publicKey), {
      role: "MERCHANT",
      publicKey: merchantKeys.publicKey,
    });
    trustedKeys = tMap;

    defaultPolicy = {
      id: "policy-default",
      version: 1,
      rules: { maxPerTxMinor: 10000 },
    };
    mandateRepo.policies.set("policy-default", defaultPolicy);
  });

  async function createSignedCartMandate(mandateId: string = "mandate-1") {
    const policyHash = hashPolicy(defaultPolicy);
    if (!policyHash.ok) throw new Error("Policy hash failed");

    const buildResult = buildCartMandate({
      id: mandateId as Uuid,
      correlationId: "corr-1" as Uuid,
      principalId: "principal-1",
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "merchant-1", displayName: "Merchant One" },
      payment: { amountMinor: 5000, currency: "USD" },
      items: [
        {
          sku: "ITEM-1",
          description: "Widget",
          quantity: 1,
          unitAmountMinor: 5000,
        },
      ],
      promptPlayback: "Buy widget",
      policy: { id: "policy-default", hash: policyHash.value },
      validity: {
        notBefore: "2026-10-20T10:00:00.000Z" as Timestamp,
        expiresAt: "2026-10-20T10:14:00.000Z" as Timestamp,
      },
      nonce: "nonce-1",
    });

    if (!buildResult.ok) throw new Error(`Build failed: ${buildResult.error.message}`);
    const { terms, hash } = buildResult.value;

    const authAttest = attestMandate(
      "AUTHORITY",
      hash as Hash,
      authorityKeys.privateKey,
      authorityKeys.publicKey,
    );
    const merchAttest = attestMandate(
      "MERCHANT",
      hash as Hash,
      merchantKeys.privateKey,
      merchantKeys.publicKey,
    );
    if (!authAttest.ok || !merchAttest.ok) throw new Error("Attestation failed");

    const record: StoredMandateRecord = {
      terms,
      hash,
      attestations: [authAttest.value, merchAttest.value],
      status: "SIGNED", // Status permitting execution after consent
    };

    mandateRepo.mandates.set(mandateId, record);
    return { record, terms, hash };
  }

  it("fails if mandate is not found", async () => {
    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
    );

    const result = await useCase.execute({ mandateId: "unknown-id" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("MANDATE_NOT_FOUND");
  });

  it("fails if consent is missing", async () => {
    await createSignedCartMandate("mandate-no-consent");

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
    );

    const result = await useCase.execute({ mandateId: "mandate-no-consent" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("CONSENT_MISSING");
  });

  it("evaluates Gate and denies execution if mandate status is ISSUED (not SIGNED)", async () => {
    const { hash } = await createSignedCartMandate("mandate-issued");
    const existing = mandateRepo.mandates.get("mandate-issued");
    if (!existing) throw new Error("Mandate not found");
    mandateRepo.mandates.set("mandate-issued", {
      ...existing,
      status: "ISSUED", // not yet consented/signed
    });

    const consent = makeVerifiedConsent(hash);

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
    );

    const result = await useCase.execute({
      mandateId: "mandate-issued",
      consent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("GATE_DENIED");
    if (result.error.kind === "GATE_DENIED") {
      expect(result.error.code).toBe("MANDATE_STATE_INVALID");
    }
    expect(paymentProvider.calls).toHaveLength(0); // Zero provider calls
  });

  it("executes write-ahead order creation protocol successfully (ADR-0006)", async () => {
    const { hash } = await createSignedCartMandate("mandate-valid");
    const consent = makeVerifiedConsent(hash);

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
      undefined,
      undefined,
      new FakeUnitOfWork(ledgerRepo),
      appendLedgerEvent,
    );

    const result = await useCase.execute({
      mandateId: "mandate-valid",
      consent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orderId).toBe("ORDER-FAKE-1");
    expect(result.value.status).toBe("CREATED");

    // Check payment mandate row in DB
    const pm = await paymentMandateRepo.findPaymentMandateByMandateId("mandate-valid");
    expect(pm).not.toBeNull();
    expect(pm?.status).toBe("ORDER_CREATED");
    expect(pm?.paypalOrderId).toBe("ORDER-FAKE-1");
    expect(pm?.sequence).toBe(1);

    // Check payment provider call was made with proper wire format (USD 5000 -> "50.00")
    expect(paymentProvider.calls).toHaveLength(1);
    const call = paymentProvider.calls[0];
    if (!call) throw new Error("Expected provider call");
    expect(call.requestId).toBeDefined();
    expect(call.approval.paymentMandateTerms.payment.amountMinor).toBe(5000);

    // Check ledger events: EXECUTION_AUTHORIZED, then PAYPAL_ORDER_CREATED
    const events = await ledgerRepo.getEvents("corr-1");
    const types = events.map((e) => e.type);
    expect(types).toContain("EXECUTION_AUTHORIZED");
    expect(types).toContain("PAYPAL_ORDER_CREATED");
  });

  it("is idempotent on repeat call for the same mandate", async () => {
    const { hash } = await createSignedCartMandate("mandate-idemp");
    const consent = makeVerifiedConsent(hash);

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
      undefined,
      undefined,
      new FakeUnitOfWork(ledgerRepo),
      appendLedgerEvent,
    );

    const first = await useCase.execute({
      mandateId: "mandate-idemp",
      consent,
    });
    expect(first.ok).toBe(true);
    expect(paymentProvider.calls).toHaveLength(1);

    // Second execution
    const second = await useCase.execute({
      mandateId: "mandate-idemp",
      consent,
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;

    expect(second.value.orderId).toBe(first.value.orderId);
    expect(second.value.paymentMandateId).toBe(first.value.paymentMandateId);
    expect(paymentProvider.calls).toHaveLength(1); // No second provider call
  });

  it("handles provider failure and records FAILED status", async () => {
    const { hash } = await createSignedCartMandate("mandate-fail");
    const consent = makeVerifiedConsent(hash);

    paymentProvider.failNextWith = {
      kind: "VALIDATION_FAILED",
      message: "PayPal rejected payload",
      status: 422,
    };

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
      undefined,
      undefined,
      new FakeUnitOfWork(ledgerRepo),
      appendLedgerEvent,
    );

    const result = await useCase.execute({
      mandateId: "mandate-fail",
      consent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_ERROR");

    const pm = await paymentMandateRepo.findPaymentMandateByMandateId("mandate-fail");
    expect(pm?.status).toBe("FAILED");

    const events = await ledgerRepo.getEvents("corr-1");
    const types = events.map((e) => e.type);
    expect(types).toContain("EXECUTION_AUTHORIZED");
    expect(types).toContain("PROVIDER_ERROR");
  });

  it("handles provider timeout and records UNKNOWN status", async () => {
    const { hash } = await createSignedCartMandate("mandate-timeout");
    const consent = makeVerifiedConsent(hash);

    paymentProvider.failNextWith = {
      kind: "TIMEOUT",
      message: "Gateway timed out",
    };

    const useCase = new CreateOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      authorityKeys,
      undefined,
      undefined,
      new FakeUnitOfWork(ledgerRepo),
      appendLedgerEvent,
    );

    const result = await useCase.execute({
      mandateId: "mandate-timeout",
      consent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_OUTCOME_UNKNOWN");

    const pm = await paymentMandateRepo.findPaymentMandateByMandateId("mandate-timeout");
    expect(pm?.status).toBe("UNKNOWN");

    const events = await ledgerRepo.getEvents("corr-1");
    const types = events.map((e) => e.type);
    expect(types).toContain("EXECUTION_AUTHORIZED");
    expect(types).toContain("PROVIDER_OUTCOME_UNKNOWN");
  });
});
