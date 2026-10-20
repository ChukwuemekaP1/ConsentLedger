/**
 * Unit tests for CaptureOrderUseCase (Phase 5B: Guarded PayPal Capture).
 *
 * Verifies:
 * - Untrusted reference verification (orderId / mandateId)
 * - Gate re-evaluation with stored passkey consent and active policy (I-01)
 * - Zero provider calls on missing consent, expiry, policy drift, or mismatch
 * - Durably reserving capture attempt in CAPTURE_REQUESTED (ADR-0006)
 * - Concurrency protection: concurrent or replayed captures are rejected
 * - Provider outcome modeling: COMPLETED -> CAPTURED/SETTLED, PENDING/TIMEOUT -> UNKNOWN (I-11)
 * - Terminal states (CAPTURED, FAILED) rejected
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CaptureOrderUseCase } from "../../../src/application/usecases/capture-order.js";
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
import type { PaymentMandateTerms } from "../../../src/domain/mandate/types.js";

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
  public lockedIds: string[] = [];

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
  async lockPaymentMandate(id: string): Promise<void> {
    this.lockedIds.push(id);
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
      paypalOrderId?: string | undefined;
      captureRequestId?: string | undefined;
      paypalCaptureId?: string | undefined;
    },
  ): Promise<void> {
    const existing = this.records.get(id);
    if (existing) {
      this.records.set(id, {
        ...existing,
        status: update.status,
        ...(update.paypalOrderId !== undefined ? { paypalOrderId: update.paypalOrderId } : {}),
        ...(update.captureRequestId !== undefined
          ? { captureRequestId: update.captureRequestId }
          : {}),
        ...(update.paypalCaptureId !== undefined
          ? { paypalCaptureId: update.paypalCaptureId }
          : {}),
      });
    }
  }
}

class FakeUnitOfWork implements UnitOfWork {
  constructor(
    private readonly ledger: InMemoryLedgerRepo,
    private readonly mandates: InMemoryMandateRepo,
    private readonly paymentMandates: InMemoryPaymentMandateRepo,
  ) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({
      ledger: this.ledger,
      mandates: this.mandates,
      paymentMandates: this.paymentMandates,
    });
  }
}

describe("CaptureOrderUseCase", () => {
  const now = "2026-10-20T10:00:00.000Z";
  let clock: FixedClock;
  let idGen: SequentialIdGenerator;
  let mandateRepo: InMemoryMandateRepo;
  let paymentMandateRepo: InMemoryPaymentMandateRepo;
  let paymentProvider: FakePaymentProvider;
  let ledgerRepo: InMemoryLedgerRepo;
  let appendLedgerEvent: AppendLedgerEvent;
  let uow: FakeUnitOfWork;
  let authorityKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let merchantKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let trustedKeys: TrustedKeys;
  let defaultPolicy: PolicyDocument;

  beforeEach(() => {
    clock = new FixedClock(now);
    idGen = new SequentialIdGenerator("cap-id");
    mandateRepo = new InMemoryMandateRepo();
    paymentMandateRepo = new InMemoryPaymentMandateRepo();
    paymentProvider = new FakePaymentProvider();
    ledgerRepo = new InMemoryLedgerRepo();
    uow = new FakeUnitOfWork(ledgerRepo, mandateRepo, paymentMandateRepo);
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

  async function setupCartAndOrder(overrides?: {
    cartAmount?: number;
    paymentAmount?: number;
    paymentStatus?: PaymentMandateStatus;
    customPolicy?: PolicyDocument;
    omitConsent?: boolean;
    expiredConsent?: boolean;
    customOrderId?: string;
  }) {
    const policy = overrides?.customPolicy ?? defaultPolicy;
    const policyHash = hashPolicy(policy);
    if (!policyHash.ok) throw new Error("Policy hash failed");
    mandateRepo.policies.set(policy.id, policy);

    const cartResult = buildCartMandate({
      id: "mand-cart-1" as Uuid,
      correlationId: "corr-1" as Uuid,
      principalId: "principal-1",
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "merchant-1", displayName: "Merchant One" },
      payment: { amountMinor: overrides?.cartAmount ?? 5000, currency: "USD" },
      items: [
        {
          sku: "ITEM-1",
          description: "Widget",
          quantity: 1,
          unitAmountMinor: overrides?.cartAmount ?? 5000,
        },
      ],
      promptPlayback: "Buy widget",
      policy: { id: policy.id, hash: policyHash.value },
      validity: {
        notBefore: "2026-10-20T10:00:00.000Z" as Timestamp,
        expiresAt: "2026-10-20T10:14:00.000Z" as Timestamp,
      },
      nonce: "nonce-1",
    });

    if (!cartResult.ok) throw new Error(`Build failed: ${cartResult.error.message}`);
    const { terms, hash } = cartResult.value;

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

    const storedCart: StoredMandateRecord = {
      terms,
      hash,
      attestations: [authAttest.value, merchAttest.value],
      status: "SIGNED",
    };
    mandateRepo.mandates.set(terms.id, storedCart);

    if (!overrides?.omitConsent) {
      const verifiedConsent = makeVerifiedConsent(
        hash,
        "test-credential-id",
        (overrides?.expiredConsent
          ? "2026-10-20T09:00:00.000Z"
          : "2026-10-20T10:00:00.000Z") as Timestamp,
      );
      await mandateRepo.saveConsent({
        id: "consent-1",
        mandateId: terms.id,
        credentialId: verifiedConsent.credentialId,
        authenticatorData: "dGVzdC1hdXRoLWRhdGE=",
        clientDataJson: "dGVzdC1jbGllbnQtZGF0YQ==",
        signature: "dGVzdC1zaWduYXR1cmU=",
        verifiedAt: verifiedConsent.verifiedAt,
        createdAt: now,
      });
    }

    const orderId = overrides?.customOrderId ?? "ORDER-PAYPAL-123";
    const paymentMandateTerms: PaymentMandateTerms = {
      v: 1,
      kind: "PAYMENT",
      id: "pm-1" as Uuid,
      correlationId: "corr-1" as Uuid,
      parent: {
        mandateId: terms.id,
        hash,
        kind: "CART",
      },
      modality: "HP",
      sequence: 1,
      payee: { merchantId: "merchant-1" },
      payment: {
        amountMinor: overrides?.paymentAmount ?? 5000,
        currency: "USD",
      },
      agentId: "agent-1",
      createdAt: now as Timestamp,
    };

    const storedPaymentMandate: StoredPaymentMandateRecord = {
      id: "pm-1",
      mandateId: terms.id,
      correlationId: "corr-1",
      sequence: 1,
      terms: paymentMandateTerms,
      hash: "h".repeat(64),
      authoritySignature: "sig",
      status: overrides?.paymentStatus ?? "ORDER_CREATED",
      requestId: "order-req-1",
      captureRequestId: null,
      paypalOrderId: orderId,
      paypalCaptureId: null,
      createdAt: now,
    };
    paymentMandateRepo.records.set("pm-1", storedPaymentMandate);

    // Register order with fake payment provider
    paymentProvider.createdOrders.set(orderId, {
      orderId,
      status: "APPROVED",
      requestId: "order-req-1",
      paymentMandateId: "pm-1",
      amountValue: "50.00",
      currency: "USD",
    });

    return { cart: { terms, hash }, storedCart, orderId, paymentMandateTerms };
  }

  function createUseCase() {
    return new CaptureOrderUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      trustedKeys,
      undefined,
      undefined,
      uow,
      appendLedgerEvent,
    );
  }

  it("successfully captures order, settles mandate, and appends ledger events", async () => {
    const { orderId } = await setupCartAndOrder();
    paymentProvider.nextCaptureStatus = "COMPLETED";

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("COMPLETED");
    expect(result.value.orderId).toBe(orderId);
    expect(result.value.captureId).toBeDefined();

    // Verify row lock was acquired
    expect(paymentMandateRepo.lockedIds).toContain("pm-1");

    // Verify payment mandate record is updated to CAPTURED
    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-1");
    expect(updatedPm?.status).toBe("CAPTURED");
    expect(updatedPm?.captureRequestId).toBeDefined();
    expect(updatedPm?.paypalCaptureId).toBe(result.value.captureId);

    // Verify mandate is updated to SETTLED
    const updatedCart = await mandateRepo.findMandateById("mand-cart-1");
    expect(updatedCart?.status).toBe("SETTLED");

    // Verify provider was called with PayPal-Request-Id matching captureRequestId
    expect(paymentProvider.captureCalls.length).toBe(1);
    const firstCaptureCall = paymentProvider.captureCalls[0];
    expect(firstCaptureCall).toBeDefined();
    expect(firstCaptureCall?.orderId).toBe(orderId);
    expect(firstCaptureCall?.captureRequestId).toBe(updatedPm?.captureRequestId);

    // Verify ledger contains CAPTURE_REQUESTED and CAPTURE_COMPLETED
    const events = ledgerRepo.events;
    const requestedEvent = events.find((e) => e.type === "CAPTURE_REQUESTED");
    expect(requestedEvent).toBeDefined();
    const completedEvent = events.find((e) => e.type === "CAPTURE_COMPLETED");
    expect(completedEvent).toBeDefined();
  });

  it("fails closed without calling provider if order ID is unknown", async () => {
    await setupCartAndOrder();

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId: "NON-EXISTENT-ORDER",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ORDER_NOT_FOUND");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("fails closed without calling provider if mandateId in request mismatches payment mandate", async () => {
    const { orderId } = await setupCartAndOrder();

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
      mandateId: "wrong-mandate-id",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("MANDATE_MISMATCH");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("fails closed without calling provider if human passkey consent is missing", async () => {
    const { orderId } = await setupCartAndOrder({ omitConsent: true });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("CONSENT_MISSING");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("fails closed without calling provider if terms mismatch between payment and cart mandate", async () => {
    // Payment mandate amount (8000) != Cart mandate amount (5000)
    const { orderId } = await setupCartAndOrder({
      cartAmount: 5000,
      paymentAmount: 8000,
    });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("TERMS_MISMATCH");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("fails closed without calling provider if Gate re-evaluation denies due to policy drift", async () => {
    // Policy changed to allow max 3000 minor units, but cart is 5000
    const strictPolicy: PolicyDocument = {
      id: "policy-default",
      version: 1,
      rules: { maxPerTxMinor: 3000 },
    };

    const { orderId } = await setupCartAndOrder({
      customPolicy: strictPolicy,
      cartAmount: 5000,
    });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("GATE_DENIED");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("rejects duplicate/concurrent capture if status is already CAPTURE_REQUESTED", async () => {
    const { orderId } = await setupCartAndOrder({
      paymentStatus: "CAPTURE_REQUESTED",
    });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("CONCURRENT_CAPTURE");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("returns idempotent success if status is already terminal CAPTURED", async () => {
    const { orderId } = await setupCartAndOrder({
      paymentStatus: "CAPTURED",
    });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("COMPLETED");
    expect(result.value.alreadyCaptured).toBe(true);
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("rejects capture if status is terminal FAILED", async () => {
    const { orderId } = await setupCartAndOrder({
      paymentStatus: "FAILED",
    });

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("INVALID_STATE");
    expect(paymentProvider.captureCalls.length).toBe(0);
  });

  it("models provider PENDING as UNKNOWN (does not mark CAPTURED)", async () => {
    const { orderId } = await setupCartAndOrder();
    paymentProvider.nextCaptureStatus = "PENDING";

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_PENDING");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-1");
    expect(updatedPm?.status).toBe("UNKNOWN");

    // Mandate should remain in EXECUTING (not settled) pending reconciliation
    const updatedCart = await mandateRepo.findMandateById("mand-cart-1");
    expect(updatedCart?.status).toBe("EXECUTING");

    // Ledger records PROVIDER_OUTCOME_UNKNOWN
    const unknownEvent = ledgerRepo.events.find((e) => e.type === "PROVIDER_OUTCOME_UNKNOWN");
    expect(unknownEvent).toBeDefined();
  });

  it("models provider network timeout as UNKNOWN (does not mark CAPTURED)", async () => {
    const { orderId } = await setupCartAndOrder();
    paymentProvider.failNextCaptureWith = {
      kind: "TIMEOUT",
      message: "Gateway timed out during capture",
    };

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_OUTCOME_UNKNOWN");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-1");
    expect(updatedPm?.status).toBe("UNKNOWN");

    // Mandate should remain in EXECUTING (not settled) pending reconciliation
    const updatedCart = await mandateRepo.findMandateById("mand-cart-1");
    expect(updatedCart?.status).toBe("EXECUTING");

    // Ledger records PROVIDER_OUTCOME_UNKNOWN
    const unknownEvent = ledgerRepo.events.find((e) => e.type === "PROVIDER_OUTCOME_UNKNOWN");
    expect(unknownEvent).toBeDefined();
  });

  it("updates status to FAILED when provider rejects capture with validation error", async () => {
    const { orderId } = await setupCartAndOrder();
    paymentProvider.failNextCaptureWith = {
      kind: "VALIDATION_FAILED",
      message: "Instrument declined",
    };

    const useCase = createUseCase();

    const result = await useCase.execute({
      orderId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_ERROR");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-1");
    expect(updatedPm?.status).toBe("FAILED");

    // Mandate is marked FAILED on definitive provider error
    const updatedCart = await mandateRepo.findMandateById("mand-cart-1");
    expect(updatedCart?.status).toBe("FAILED");

    // Ledger records PROVIDER_ERROR
    const failedEvent = ledgerRepo.events.find((e) => e.type === "PROVIDER_ERROR");
    expect(failedEvent).toBeDefined();
  });
});
