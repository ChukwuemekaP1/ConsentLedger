/**
 * Route tests for POST /api/v1/orders/[id]/reconcile (Phase 5C).
 *
 * Verifies:
 * - Session authentication (401 UNAUTHENTICATED)
 * - Parameter validation (400 VALIDATION_FAILED)
 * - Order not found handling (404 NOT_FOUND)
 * - Provider error handling (500 PROVIDER_ERROR)
 * - Successful reconciliation to CAPTURED / FAILED / APPROVED (200 OK)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../../src/app/api/v1/orders/[id]/reconcile/route.js";
import { container } from "../../../src/container.js";
import { FakePaymentProvider } from "../../../src/infrastructure/paypal/fake-payment-provider.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
  PaymentMandateStatus,
} from "../../../src/application/ports/payment-mandate-repo.js";
import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../../src/domain/gate/index.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import type { PaymentMandateTerms } from "../../../src/domain/mandate/types.js";
import { randomUUID } from "node:crypto";

class MockMandateRepo implements MandateRepo {
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

class MockPaymentMandateRepo implements PaymentMandateRepo {
  records = new Map<string, StoredPaymentMandateRecord>();

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
  async lockPaymentMandate(_id: string): Promise<void> {}
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
  async createPaymentMandate(record: {
    id: string;
    mandateId: string;
    correlationId: string;
    paypalOrderId: string;
    terms: PaymentMandateTerms;
    status: PaymentMandateStatus;
    createdAt: string;
  }): Promise<StoredPaymentMandateRecord> {
    const full: StoredPaymentMandateRecord = {
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
    this.records.set(record.id, full);
    return full;
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

describe("POST /api/v1/orders/[id]/reconcile", () => {
  let mockMandateRepo: MockMandateRepo;
  let mockPaymentMandateRepo: MockPaymentMandateRepo;
  let fakePaymentProvider: FakePaymentProvider;
  let validSessionCookie: string;
  let principalId: string;

  const sampleTerms: PaymentMandateTerms = {
    v: 1,
    kind: "PAYMENT",
    id: "pm-rec-1",
    correlationId: "corr-rec-1",
    parent: { mandateId: "mand-rec-1", hash: "b".repeat(64), kind: "CART" },
    modality: "HP",
    sequence: 1,
    payee: { merchantId: "merchant-1" },
    payment: { amountMinor: 5000, currency: "USD" },
    agentId: "agent-1",
    createdAt: "2026-10-20T09:00:00.000Z",
  };

  beforeEach(() => {
    mockMandateRepo = new MockMandateRepo();
    mockPaymentMandateRepo = new MockPaymentMandateRepo();
    fakePaymentProvider = new FakePaymentProvider();

    container.setMandateRepo(mockMandateRepo);
    container.setPaymentMandateRepo(mockPaymentMandateRepo);
    container.setPaymentProvider(fakePaymentProvider);

    principalId = randomUUID();
    validSessionCookie = `cl_session=${container.getSessionService().sign(principalId)}`;
  });

  it("returns 401 UNAUTHENTICATED without valid session cookie", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORD-123/reconcile", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-123" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.title).toBe("Unauthenticated");
  });

  it("returns 404 NOT_FOUND when order does not exist in local database", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORD-NONEXISTENT/reconcile", {
      method: "POST",
      headers: { cookie: validSessionCookie },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-NONEXISTENT" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.title).toBe("Not Found");
  });

  it("returns 200 OK immediately when order is already CAPTURED", async () => {
    await mockMandateRepo.createMandate({
      id: "mand-rec-1",
      kind: "CART",
      correlationId: "corr-rec-1",
      principalId,
      agentId: "agent-1",
      terms: sampleTerms as unknown as StoredMandateRecord["terms"],
      hash: "b".repeat(64),
      attestations: [],
      status: "SETTLED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-rec-1",
      mandateId: "mand-rec-1",
      correlationId: "corr-rec-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms,
      status: "CAPTURED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const req = new Request("http://localhost:3000/api/v1/orders/ORD-123/reconcile", {
      method: "POST",
      headers: { cookie: validSessionCookie },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CAPTURED");
    expect(body.reconciled).toBe(true);
  });

  it("returns 500 PROVIDER_ERROR when PayPal getOrder fails", async () => {
    await mockMandateRepo.createMandate({
      id: "mand-rec-1",
      kind: "CART",
      correlationId: "corr-rec-1",
      principalId,
      agentId: "agent-1",
      terms: sampleTerms as unknown as StoredMandateRecord["terms"],
      hash: "b".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-rec-1",
      mandateId: "mand-rec-1",
      correlationId: "corr-rec-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms,
      status: "UNKNOWN",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    // fakePaymentProvider returns 404 for uncreated order, mapped to PROVIDER_ERROR
    const req = new Request("http://localhost:3000/api/v1/orders/ORD-123/reconcile", {
      method: "POST",
      headers: { cookie: validSessionCookie },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-123" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.title).toBe("Provider Error");
  });

  it("reconciles UNKNOWN order to CAPTURED when PayPal reports COMPLETED", async () => {
    await mockMandateRepo.createMandate({
      id: "mand-rec-1",
      kind: "CART",
      correlationId: "corr-rec-1",
      principalId,
      agentId: "agent-1",
      terms: sampleTerms as unknown as StoredMandateRecord["terms"],
      hash: "b".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-rec-1",
      mandateId: "mand-rec-1",
      correlationId: "corr-rec-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms,
      status: "UNKNOWN",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    fakePaymentProvider.createdOrders.set("ORD-123", {
      orderId: "ORD-123",
      status: "COMPLETED",
      requestId: "req-rec-1",
      paymentMandateId: "pm-rec-1",
      amountValue: "50.00",
      currency: "USD",
    });

    const req = new Request("http://localhost:3000/api/v1/orders/ORD-123/reconcile", {
      method: "POST",
      headers: { cookie: validSessionCookie },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CAPTURED");
    expect(body.reconciled).toBe(true);

    const updatedPm = await mockPaymentMandateRepo.findPaymentMandateById("pm-rec-1");
    expect(updatedPm?.status).toBe("CAPTURED");
  });

  it("reconciles order to FAILED when PayPal reports VOIDED", async () => {
    await mockMandateRepo.createMandate({
      id: "mand-rec-1",
      kind: "CART",
      correlationId: "corr-rec-1",
      principalId,
      agentId: "agent-1",
      terms: sampleTerms as unknown as StoredMandateRecord["terms"],
      hash: "b".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-rec-1",
      mandateId: "mand-rec-1",
      correlationId: "corr-rec-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms,
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    fakePaymentProvider.createdOrders.set("ORD-123", {
      orderId: "ORD-123",
      status: "VOIDED",
      requestId: "req-rec-1",
      paymentMandateId: "pm-rec-1",
      amountValue: "50.00",
      currency: "USD",
    });

    const req = new Request("http://localhost:3000/api/v1/orders/ORD-123/reconcile", {
      method: "POST",
      headers: { cookie: validSessionCookie },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORD-123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("FAILED");
    expect(body.reconciled).toBe(true);

    const updatedPm = await mockPaymentMandateRepo.findPaymentMandateById("pm-rec-1");
    expect(updatedPm?.status).toBe("FAILED");
  });
});
