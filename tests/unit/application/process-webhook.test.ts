/**
 * Unit tests for ProcessWebhookUseCase (Phase 5C: PayPal Webhooks and Payment Reconciliation).
 *
 * Verifies:
 * - Fail closed on missing webhook configuration (I-11)
 * - Validation of event envelope and signature verification
 * - Deduplication via webhook_deliveries (I-06)
 * - Safe event ordering (never overwrite terminal states)
 * - Strict terms checking: amount and currency match stored payment terms (I-02)
 * - Single atomic transaction for state mutation and ledger events (I-04)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ProcessWebhookUseCase } from "../../../src/application/usecases/process-webhook.js";
import { FakePaymentProvider } from "../../../src/infrastructure/paypal/fake-payment-provider.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import { InMemoryLedgerRepo } from "../../fakes/in-memory-ledger-repo.js";
import { AppendLedgerEvent } from "../../../src/application/usecases/append-ledger-event.js";
import type {
  WebhookRepo,
  WebhookDeliveryRecord,
} from "../../../src/application/ports/webhook-repo.js";
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

class InMemoryWebhookRepo implements WebhookRepo {
  public deliveries: Map<string, WebhookDeliveryRecord> = new Map();

  async findDeliveryById(paypalEventId: string): Promise<WebhookDeliveryRecord | null> {
    return this.deliveries.get(paypalEventId) ?? null;
  }

  async recordDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
    this.deliveries.set(delivery.paypalEventId, delivery);
  }
}

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
    private readonly webhookRepo: WebhookRepo,
    private readonly ledgerRepo: InMemoryLedgerRepo,
  ) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({
      mandates: this.mandateRepo,
      paymentMandates: this.paymentMandateRepo,
      webhooks: this.webhookRepo,
      ledger: this.ledgerRepo,
    });
  }
}

describe("ProcessWebhookUseCase", () => {
  let clock: FixedClock;
  let idGen: SequentialIdGenerator;
  let webhookRepo: InMemoryWebhookRepo;
  let mandateRepo: InMemoryMandateRepo;
  let paymentMandateRepo: InMemoryPaymentMandateRepo;
  let paymentProvider: FakePaymentProvider;
  let ledgerRepo: InMemoryLedgerRepo;
  let appendLedger: AppendLedgerEvent;
  let uow: PassthroughUnitOfWork;

  const WEBHOOK_ID = "WH-TEST-12345";

  beforeEach(() => {
    clock = new FixedClock("2026-10-20T10:00:00.000Z");
    idGen = new SequentialIdGenerator("evt-");
    webhookRepo = new InMemoryWebhookRepo();
    mandateRepo = new InMemoryMandateRepo();
    paymentMandateRepo = new InMemoryPaymentMandateRepo();
    paymentProvider = new FakePaymentProvider();
    ledgerRepo = new InMemoryLedgerRepo();
    uow = new PassthroughUnitOfWork(mandateRepo, paymentMandateRepo, webhookRepo, ledgerRepo);
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
    payment: { amountMinor: 4999, currency: "USD" },
    agentId: "agent-1",
    createdAt: "2026-10-20T09:00:00.000Z",
  };

  const sampleWebhookHeaders = {
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/cert.pem",
    transmissionId: "trans-001",
    transmissionSig: "sig-xyz-001",
    transmissionTime: "2026-10-20T10:00:00.000Z",
  };

  it("fails closed when webhookId is not configured (I-11)", async () => {
    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      undefined, // Missing webhook ID
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-1",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-001" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("WEBHOOK_CONFIG_MISSING");
  });

  it("rejects malformed webhook event envelopes", async () => {
    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
    );

    // Missing event_type
    const result1 = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: { id: "WH-EV-1" },
    });
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.error.kind).toBe("MALFORMED_EVENT");

    // Missing resource
    const result2 = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: { id: "WH-EV-1", event_type: "CHECKOUT.ORDER.APPROVED" },
    });
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.error.kind).toBe("MALFORMED_EVENT");
  });

  it("deduplicates redelivered events without duplicate state changes or ledger entries (I-06)", async () => {
    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    // Seed existing delivery record
    await webhookRepo.recordDelivery({
      paypalEventId: "WH-EV-ALREADY-RECEIVED",
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceId: "ORD-001",
      resourceStatus: "APPROVED",
      receivedAt: "2026-10-20T09:30:00.000Z",
    });

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-ALREADY-RECEIVED",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-001" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("DUPLICATE_IGNORED");

    // Provider verifyWebhookSignature should not even be called
    expect(paymentProvider.verifyWebhookCalls.length).toBe(0);
    // Zero ledger events appended
    expect(ledgerRepo.events.length).toBe(0);
  });

  it("rejects events with invalid webhook signatures", async () => {
    paymentProvider.nextVerifyResult = false;

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-INVALID-SIG",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-001" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(webhookRepo.deliveries.size).toBe(0);
    expect(ledgerRepo.events.length).toBe(0);
  });

  it("handles unhandled event types safely by recording delivery and returning IGNORED", async () => {
    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-OTHER",
        event_type: "CUSTOMER.DISPUTE.CREATED",
        resource: { id: "DISPUTE-001", status: "OPEN" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("IGNORED");
    expect(webhookRepo.deliveries.has("WH-EV-OTHER")).toBe(true);
  });

  it("processes CHECKOUT.ORDER.APPROVED and transitions payment mandate to APPROVED", async () => {
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

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-APP-001",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-001", status: "APPROVED" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("PROCESSED");

    // Check payment mandate status updated
    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(updatedPm?.status).toBe("APPROVED");

    // Check webhook delivery recorded
    expect(webhookRepo.deliveries.has("WH-EV-APP-001")).toBe(true);

    // Check ledger event appended
    expect(ledgerRepo.events.length).toBe(1);
    expect(ledgerRepo.events[0]?.type).toBe("WEBHOOK_RECEIVED");
  });

  it("processes PAYMENT.CAPTURE.COMPLETED: verifies terms and transitions to CAPTURED / SETTLED (I-02, I-04)", async () => {
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
      terms: baseTerms, // 4999 minor units = "49.99" USD
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-CAP-001",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-001",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "49.99" },
          supplementary_data: { related_ids: { order_id: "ORD-001" } },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("PROCESSED");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(updatedPm?.status).toBe("CAPTURED");
    expect(updatedPm?.paypalCaptureId).toBe("CAP-001");

    const updatedMandate = await mandateRepo.findMandateById("mand-001");
    expect(updatedMandate?.status).toBe("SETTLED");

    expect(ledgerRepo.events.length).toBe(1);
    expect(ledgerRepo.events[0]?.type).toBe("CAPTURE_COMPLETED");
  });

  it("aborts PAYMENT.CAPTURE.COMPLETED when terms mismatch (I-02)", async () => {
    await paymentMandateRepo.createPaymentMandate({
      id: "pm-001",
      mandateId: "mand-001",
      correlationId: "corr-001",
      paypalOrderId: "ORD-001",
      terms: baseTerms, // 49.99 USD
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    // Webhook has tampered / unexpected amount
    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-CAP-MISMATCH",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-001",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "99.99" }, // mismatch!
          supplementary_data: { related_ids: { order_id: "ORD-001" } },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("TERMS_MISMATCH");

    // Mandate must NOT be transitioned to CAPTURED
    const pm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(pm?.status).toBe("CAPTURE_REQUESTED");
    expect(ledgerRepo.events.length).toBe(0);
  });

  it("handles PAYMENT.CAPTURE.DENIED: transitions to FAILED and appends PROVIDER_ERROR", async () => {
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

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-DENIED",
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: {
          id: "CAP-DENIED",
          status: "DENIED",
          supplementary_data: { related_ids: { order_id: "ORD-001" } },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("PROCESSED");

    const updatedPm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    expect(updatedPm?.status).toBe("FAILED");

    const updatedMandate = await mandateRepo.findMandateById("mand-001");
    expect(updatedMandate?.status).toBe("FAILED");

    expect(ledgerRepo.events.length).toBe(1);
    expect(ledgerRepo.events[0]?.type).toBe("PROVIDER_ERROR");
  });

  it("safe event ordering: old webhook delivery does not overwrite terminal CAPTURED state", async () => {
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

    const useCase = new ProcessWebhookUseCase(
      clock,
      idGen,
      webhookRepo,
      mandateRepo,
      paymentMandateRepo,
      paymentProvider,
      WEBHOOK_ID,
      uow,
      appendLedger,
    );

    // Delayed CHECKOUT.ORDER.APPROVED arrives after capture was already completed
    const result = await useCase.execute({
      ...sampleWebhookHeaders,
      rawBody: {
        id: "WH-EV-DELAYED-APP",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-001", status: "APPROVED" },
      },
    });

    expect(result.ok).toBe(true);
    const pm = await paymentMandateRepo.findPaymentMandateById("pm-001");
    // Must remain CAPTURED, NOT regressed to APPROVED
    expect(pm?.status).toBe("CAPTURED");
  });
});
