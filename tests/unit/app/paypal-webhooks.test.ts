/**
 * Route tests for POST /api/v1/paypal/webhooks (Phase 5C).
 *
 * Verifies:
 * - Signature header validation (fails if any PayPal header is missing)
 * - JSON parse error handling
 * - Fail-closed handling when PAYPAL_WEBHOOK_ID is unconfigured (500)
 * - Rejecting invalid webhook signatures (RFC 9457 WEBHOOK_SIGNATURE_INVALID)
 * - Deduplication returning 200 OK DUPLICATE_IGNORED
 * - Successful event processing (200 OK)
 * - Handling terms mismatch and unknown orders
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "../../../src/app/api/v1/paypal/webhooks/route.js";
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
import type {
  WebhookRepo,
  WebhookDeliveryRecord,
} from "../../../src/application/ports/webhook-repo.js";
import type { StoredMandateRecord } from "../../../src/domain/gate/index.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import type { PaymentMandateTerms } from "../../../src/domain/mandate/types.js";

class MockWebhookRepo implements WebhookRepo {
  deliveries = new Map<string, WebhookDeliveryRecord>();

  async findDeliveryById(paypalEventId: string): Promise<WebhookDeliveryRecord | null> {
    return this.deliveries.get(paypalEventId) ?? null;
  }

  async recordDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
    this.deliveries.set(delivery.paypalEventId, delivery);
  }
}

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

describe("POST /api/v1/paypal/webhooks", () => {
  let mockWebhookRepo: MockWebhookRepo;
  let mockMandateRepo: MockMandateRepo;
  let mockPaymentMandateRepo: MockPaymentMandateRepo;
  let fakePaymentProvider: FakePaymentProvider;
  let originalWebhookId: string | undefined;

  const validHeaders: Record<string, string> = {
    "content-type": "application/json",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "trans-12345",
    "paypal-transmission-sig": "sig-base64-xyz",
    "paypal-transmission-time": "2026-10-20T10:00:00Z",
  };

  const sampleTerms: PaymentMandateTerms = {
    v: 1,
    kind: "PAYMENT",
    id: "pm-test-1",
    correlationId: "corr-test-1",
    parent: { mandateId: "mand-test-1", hash: "a".repeat(64), kind: "CART" },
    modality: "HP",
    sequence: 1,
    payee: { merchantId: "merchant-1" },
    payment: { amountMinor: 3000, currency: "USD" },
    agentId: "agent-1",
    createdAt: "2026-10-20T09:00:00.000Z",
  };

  beforeEach(() => {
    mockWebhookRepo = new MockWebhookRepo();
    mockMandateRepo = new MockMandateRepo();
    mockPaymentMandateRepo = new MockPaymentMandateRepo();
    fakePaymentProvider = new FakePaymentProvider();

    container.setWebhookRepo(mockWebhookRepo);
    container.setMandateRepo(mockMandateRepo);
    container.setPaymentMandateRepo(mockPaymentMandateRepo);
    container.setPaymentProvider(fakePaymentProvider);
    container.setWebhookId("WH-CONFIGURED-ID");
  });

  afterEach(() => {
    container.setWebhookId(undefined);
  });

  it("returns 400 Bad Request when PayPal signature headers are missing", async () => {
    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "WH-EV-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toBe("Validation Failed");
  });

  it("returns 400 Bad Request when request body is malformed JSON", async () => {
    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: "not a json string {{{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toBe("Validation Failed");
  });

  it("returns 500 Internal Server Error when PAYPAL_WEBHOOK_ID is unconfigured (fail closed, I-11)", async () => {
    container.setWebhookId(undefined);

    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-1",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-123" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.title).toBe("Internal");
  });

  it("returns 422 Unprocessable Entity when PayPal rejects signature verification", async () => {
    fakePaymentProvider.nextVerifyResult = false;

    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-TAMPERED",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-123" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.title).toBe("Webhook Signature Invalid");
  });

  it("returns 200 OK with DUPLICATE_IGNORED when event was already processed (I-06)", async () => {
    await mockWebhookRepo.recordDelivery({
      paypalEventId: "WH-EV-DUP-1",
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceId: "ORD-123",
      resourceStatus: "APPROVED",
      receivedAt: "2026-10-20T09:00:00.000Z",
    });

    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-DUP-1",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-123" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("DUPLICATE_IGNORED");
  });

  it("returns 200 OK PROCESSED for PAYMENT.CAPTURE.COMPLETED and updates states", async () => {
    await mockMandateRepo.createMandate({
      id: "mand-test-1",
      kind: "CART",
      correlationId: "corr-test-1",
      principalId: "user-1",
      agentId: "agent-1",
      terms: sampleTerms as unknown as StoredMandateRecord["terms"],
      hash: "a".repeat(64),
      attestations: [],
      status: "APPROVED",
      expiresAt: "2026-10-21T00:00:00.000Z",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-test-1",
      mandateId: "mand-test-1",
      correlationId: "corr-test-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms, // 30.00 USD
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-CAP-OK",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-123",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "30.00" },
          supplementary_data: { related_ids: { order_id: "ORD-123" } },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PROCESSED");

    const updatedPm = await mockPaymentMandateRepo.findPaymentMandateById("pm-test-1");
    expect(updatedPm?.status).toBe("CAPTURED");

    const updatedMandate = await mockMandateRepo.findMandateById("mand-test-1");
    expect(updatedMandate?.status).toBe("SETTLED");
  });

  it("returns 422 TERMS_MISMATCH when webhook capture amount does not match stored mandate", async () => {
    await mockPaymentMandateRepo.createPaymentMandate({
      id: "pm-test-1",
      mandateId: "mand-test-1",
      correlationId: "corr-test-1",
      paypalOrderId: "ORD-123",
      terms: sampleTerms, // 30.00 USD
      status: "CAPTURE_REQUESTED",
      createdAt: "2026-10-20T09:00:00.000Z",
    });

    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-MISMATCH",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-123",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "60.00" }, // mismatch!
          supplementary_data: { related_ids: { order_id: "ORD-123" } },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.title).toBe("Terms Mismatch");
  });

  it("returns 404 NOT_FOUND when order does not exist in local database", async () => {
    const req = new Request("http://localhost:3000/api/v1/paypal/webhooks", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "WH-EV-UNKNOWN-ORD",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORD-NONEXISTENT", status: "APPROVED" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.title).toBe("Not Found");
  });
});
