/**
 * Unit tests for ReconcilePaymentUseCase (Phase 5C: Payment Reconciliation).
 *
 * Verifies:
 * - Error handling when local order or mandate does not exist
 * - Short-circuiting when already in terminal CAPTURED state
 * - Handling PayPal provider errors
 * - Reconciling to CAPTURED/SETTLED with RECONCILED_OK when PayPal reports COMPLETED
 * - Reconciling to FAILED with RECONCILED_MISMATCH when PayPal reports VOIDED
 * - Handling buyer APPROVED state awaiting capture
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ReconcilePaymentUseCase } from "../../../src/application/usecases/reconcile-payment.js";
import { FakePaymentProvider } from "../../../src/infrastructure/paypal/fake-payment-provider.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import { InMemoryLedgerRepo } from "../../fakes/in-memory-ledger-repo.js";
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
import type { StoredMandateRecord } from "../../../src/domain/gate/index.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import type { PaymentMandateTerms } from "../../../src/domain/mandate/types.js";
import type { UnitOfWork, TxContext } from "../../../src/application/ports/unit-of-work.js";

class InMemoryPaymentMandateRepo implements PaymentMandateRepo {
  public records: Map<string, StoredPaymentMandateRecord> = new Map();

  async findPaymentMandateById(id: string): Promise<StoredPaymentMandateRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findPaymentMandateByOrderId(orderId: string): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.paypalOrderId === orderId) return r;
    }
    return null;
  }

  async findPaymentMandateByMandateId(
    mandateId: string,
  ): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.mandateId === mandateId) return r;
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

  async lockPaymentMandate(_id: string): Promise<void> {}

  async insertPaymentMandate(record: {
    readonly id: string;
    readonly mandateId: string;
    readonly correlationId: string;
    readonly sequence: number;
    readonly terms: StoredPaymentMandateRecord["terms"];
    readonly hash: string;
    readonly authoritySignature: string;
    readonly status: PaymentMandateStatus;
    readonly requestId: string;
    readonly createdAt: string;
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

  async createPaymentMandate(record: {
    id: string;
    mandateId: string;
    correlationId: string;
    paypalOrderId: string;
    terms: PaymentMandateTerms;
    status: PaymentMandateStatus;
    createdAt: string;
  }): Promise<StoredPaymentMandateRecord> {
    const stored: StoredPaymentMandateRecord = {
      id: record.id,
      mandateId: record.mandateId,
      correlationId: record.correlationId,
      sequence: 1,
      terms: record.terms,
      hash: "h".repeat(64),
      authoritySignature: "sig",
      status: record.status,
      requestId: "req-" + record.id,
      captureRequestId: null,
      paypalOrderId: record.paypalOrderId,
      paypalCaptureId: null,
      createdAt: record.createdAt,
    };
    this.records.set(record.id, stored);
    return stored;
  }

  async updatePaymentMandateStatus(
    id: string,
    update: {
      readonly status: PaymentMandateStatus;
      readonly paypalOrderId?: string | undefined;
      readonly captureRequestId?: string | undefined;
      readonly paypalCaptureId?: string | undefined;
    },
  ): Promise<void> {
    const current = this.records.get(id);
    if (!current) throw new Error(`Payment mandate not found: ${id}`);
    const updated: StoredPaymentMandateRecord = {
      ...current,
      status: update.status,
      paypalOrderId: update.paypalOrderId ?? current.paypalOrderId ?? null,
      captureRequestId: update.captureRequestId ?? current.captureRequestId ?? null,
      paypalCaptureId: update.paypalCaptureId ?? current.paypalCaptureId ?? null,
    };
    this.records.set(id, updated);
  }
}

class InMemoryMandateRepo implements MandateRepo {
  public mandates: Map<string, StoredMandateRecord> = new Map();
  public consents: Map<string, StoredMandateConsent> = new Map();
  public policies: Map<string, PolicyDocument> = new Map();

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

class PassthroughUnitOfWork implements UnitOfWork {
  constructor(
    private readonly mandateRepo: MandateRepo,
    private readonly paymentMandateRepo: PaymentMandateRepo,
    private readonly ledgerRepo: InMemoryLedgerRepo,
  ) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({
      mandates: this.mandateRepo,
      paymentMandates: this.paymentMandateRepo,
      ledger: this.ledgerRepo,
    });
  }
}

describe("ReconcilePaymentUseCase", () => {
  let clock: FixedClock;
  let idGen: SequentialIdGenerator;
  let mandateRepo: InMemoryMandateRepo;
  let paymentMandateRepo: InMemoryPaymentMandateRepo;
  let paymentProvider: FakePaymentProvider;
  let ledgerRepo: InMemoryLedgerRepo;
  let appendLedger: AppendLedgerEvent;
  let uow: PassthroughUnitOfWork;

  beforeEach(() => {
    clock = new FixedClock("2026-10-20T10:00:00.000Z");
    idGen = new SequentialIdGenerator("evt-rec-");
    mandateRepo = new InMemoryMandateRepo();
    paymentMandateRepo = new InMemoryPaymentMandateRepo();
    paymentProvider = new FakePaymentProvider();
    ledgerRepo = new InMemoryLedgerRepo();
    uow = new PassthroughUnitOfWork(mandateRepo, paymentMandateRepo, ledgerRepo);
    appendLedger = new AppendLedgerEvent(clock, idGen, uow);
  });

  const baseTerms: PaymentMandateTerms = {
    v: 1,
    kind: "PAYMENT",
    id: "pm-001",
    correlationId: "corr-001",
    parent: { mandateId: "mand-001", hash: "a".repeat(64), kind: "CART" },
    modality: "HP",
    sequence: 1,
    payee: { merchantId: "merchant-1" },
    payment: { amountMinor: 2500, currency: "USD" },
    agentId: "agent-1",
    createdAt: "2026-10-20T09:00:00.000Z",
  };

  it("returns ORDER_NOT_FOUND when order does not exist locally", async () => {
    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-NONEXISTENT" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ORDER_NOT_FOUND");
  });

  it("returns MANDATE_NOT_FOUND when parent mandate is missing", async () => {
    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-MISSING",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "ORDER_CREATED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("MANDATE_NOT_FOUND");
  });

  it("returns immediately without querying provider if already CAPTURED", async () => {
    await mandateRepo.createMandate({
      id: "mand-001",
      kind: "CART",
      correlationId: "corr-001",
      principalId: "user-1",
      agentId: "agent-1",
      terms: baseTerms as unknown as StoredMandateRecord["terms"],
      hash: "h".repeat(64),
      attestations: [],
      status: "SETTLED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "CAPTURED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("CAPTURED");
    expect(result.value.details).toContain("already marked CAPTURED");
    expect(ledgerRepo.events.length).toBe(0);
  });

  it("returns PROVIDER_ERROR when PayPal getOrder fails", async () => {
    await mandateRepo.createMandate({
      id: "mand-001",
      kind: "CART",
      correlationId: "corr-001",
      principalId: "user-1",
      agentId: "agent-1",
      terms: baseTerms as unknown as StoredMandateRecord["terms"],
      hash: "h".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "UNKNOWN",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    // In FakePaymentProvider, if order was never created in it, getOrder returns VALIDATION_FAILED (404)
    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PROVIDER_ERROR");
  });

  it("reconciles UNKNOWN order to CAPTURED / SETTLED when PayPal reports COMPLETED (I-04, I-11)", async () => {
    await mandateRepo.createMandate({
      id: "mand-001",
      kind: "CART",
      correlationId: "corr-001",
      principalId: "user-1",
      agentId: "agent-1",
      terms: baseTerms as unknown as StoredMandateRecord["terms"],
      hash: "h".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "UNKNOWN",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    // Seed FakePaymentProvider with order having COMPLETED status
    paymentProvider.createdOrders.set("ORD-001", {
      orderId: "ORD-001",
      status: "COMPLETED",
      requestId: "req-1",
      paymentMandateId: "pm-001",
      amountValue: "25.00",
      currency: "USD",
    });

    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("CAPTURED");
    expect(result.value.reconciled).toBe(true);

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(updatedPm?.status).toBe("CAPTURED");

    const updatedMandate = await mandateRepo.findMandateById("mand-001");
    expect(updatedMandate?.status).toBe("SETTLED");

    expect(ledgerRepo.events.length).toBe(1);
    expect(ledgerRepo.events[0]?.type).toBe("RECONCILED_OK");
  });

  it("reconciles order to FAILED when PayPal reports VOIDED", async () => {
    await mandateRepo.createMandate({
      id: "mand-001",
      kind: "CART",
      correlationId: "corr-001",
      principalId: "user-1",
      agentId: "agent-1",
      terms: baseTerms as unknown as StoredMandateRecord["terms"],
      hash: "h".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    paymentProvider.createdOrders.set("ORD-001", {
      orderId: "ORD-001",
      status: "VOIDED",
      requestId: "req-1",
      paymentMandateId: "pm-001",
      amountValue: "25.00",
      currency: "USD",
    });

    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("FAILED");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(updatedPm?.status).toBe("FAILED");

    const updatedMandate = await mandateRepo.findMandateById("mand-001");
    expect(updatedMandate?.status).toBe("FAILED");

    expect(ledgerRepo.events.length).toBe(1);
    expect(ledgerRepo.events[0]?.type).toBe("RECONCILED_MISMATCH");
  });

  it("reports APPROVED status when PayPal order is approved by buyer awaiting capture", async () => {
    await mandateRepo.createMandate({
      id: "mand-001",
      kind: "CART",
      correlationId: "corr-001",
      principalId: "user-1",
      agentId: "agent-1",
      terms: baseTerms as unknown as StoredMandateRecord["terms"],
      hash: "h".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms,
      status: "ORDER_CREATED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    paymentProvider.createdOrders.set("ORD-001", {
      orderId: "ORD-001",
      status: "APPROVED",
      requestId: "req-1",
      paymentMandateId: "pm-001",
      amountValue: "25.00",
      currency: "USD",
    });

    const useCase = new ReconcilePaymentUseCase(
      clock,
      idGen,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({ orderId: "ORD-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("APPROVED");
    expect(result.value.details).toContain("awaiting capture");
  });
});
