/**
 * Route tests for POST /api/v1/orders/[id]/capture
 *
 * Verifies session authentication, request validation, untrusted reference checking,
 * Gate protection, RFC 9457 error mappings, and successful guarded capture.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../../src/app/api/v1/orders/[id]/capture/route.js";
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
import { hashPolicy } from "../../../src/domain/policy/policy.js";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { keyId } from "../../../src/domain/crypto/signing.js";
import { attestMandate } from "../../../src/domain/mandate/attestation.js";
import { buildCartMandate } from "../../../src/domain/mandate/builders.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";
import type { Uuid, Timestamp } from "../../../src/domain/shared/clock.js";
import type { PaymentMandateTerms } from "../../../src/domain/mandate/types.js";

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

describe("POST /api/v1/orders/[id]/capture", () => {
  let mockMandateRepo: MockMandateRepo;
  let mockPaymentMandateRepo: MockPaymentMandateRepo;
  let fakePaymentProvider: FakePaymentProvider;
  let validSessionCookie: string;
  let principalId: string;
  const authorityKeys = generateKeyPairSync("ed25519");
  const merchantKeys = generateKeyPairSync("ed25519");

  beforeEach(() => {
    mockMandateRepo = new MockMandateRepo();
    mockPaymentMandateRepo = new MockPaymentMandateRepo();
    fakePaymentProvider = new FakePaymentProvider();

    container.setMandateRepo(mockMandateRepo);
    container.setPaymentMandateRepo(mockPaymentMandateRepo);
    container.setPaymentProvider(fakePaymentProvider);

    const tMap = new Map();
    tMap.set(keyId(authorityKeys.publicKey), {
      role: "AUTHORITY" as const,
      publicKey: authorityKeys.publicKey,
    });
    tMap.set(keyId(merchantKeys.publicKey), {
      role: "MERCHANT" as const,
      publicKey: merchantKeys.publicKey,
    });
    container.setTrustedKeys(tMap);
    container.setAuthorityKeyPair(authorityKeys);

    principalId = randomUUID();
    validSessionCookie = `cl_session=${container.getSessionService().sign(principalId)}`;

    const defaultPolicy = {
      id: "policy-default",
      version: 1,
      rules: { maxPerTxMinor: 100000 },
    };
    mockMandateRepo.policies.set("policy-default", defaultPolicy);
  });

  async function createValidOrderAndMandate(overrides?: {
    paymentStatus?: PaymentMandateStatus;
    customOrderId?: string;
  }) {
    const mandateId = randomUUID();
    const correlationId = randomUUID();
    const orderId = overrides?.customOrderId ?? `ORDER-${randomUUID()}`;
    const policy = mockMandateRepo.policies.get("policy-default");
    if (!policy) throw new Error("Policy not found");
    const policyHash = hashPolicy(policy);
    if (!policyHash.ok) throw new Error("Policy hash failed");

    const buildResult = buildCartMandate({
      id: mandateId as Uuid,
      correlationId: correlationId as Uuid,
      principalId,
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "merchant-1", displayName: "Merchant One" },
      payment: { amountMinor: 7500, currency: "USD" },
      items: [
        {
          sku: "ITEM-1",
          description: "Widget",
          quantity: 1,
          unitAmountMinor: 7500,
        },
      ],
      promptPlayback: "Buy widget",
      policy: { id: "policy-default", hash: policyHash.value },
      validity: {
        notBefore: new Date(Date.now() - 60000).toISOString() as Timestamp,
        expiresAt: new Date(Date.now() + 600000).toISOString() as Timestamp,
      },
      nonce: "nonce-1",
    });

    if (!buildResult.ok) throw new Error("Build mandate failed");
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
    if (!authAttest.ok || !merchAttest.ok) throw new Error("Attest failed");

    // Save mandate as SIGNED
    await mockMandateRepo.createMandate({
      id: mandateId,
      kind: "CART",
      correlationId,
      principalId,
      agentId: "agent-1",
      terms,
      hash,
      attestations: [authAttest.value, merchAttest.value],
      status: "SIGNED",
      expiresAt: terms.validity.expiresAt,
      createdAt: terms.validity.notBefore,
    });

    // Save consent
    await mockMandateRepo.saveConsent({
      id: randomUUID(),
      mandateId,
      credentialId: "cred-1",
      authenticatorData: "auth-data",
      clientDataJson: "client-data",
      signature: "sig",
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const paymentMandateTerms: PaymentMandateTerms = {
      v: 1,
      kind: "PAYMENT",
      id: randomUUID() as Uuid,
      correlationId: correlationId as Uuid,
      parent: {
        mandateId,
        hash,
        kind: "CART",
      },
      modality: "HP",
      sequence: 1,
      payee: { merchantId: "merchant-1" },
      payment: {
        amountMinor: 7500,
        currency: "USD",
      },
      agentId: "agent-1",
      createdAt: new Date().toISOString() as Timestamp,
    };

    const pmRecord: StoredPaymentMandateRecord = {
      id: paymentMandateTerms.id,
      mandateId,
      correlationId,
      sequence: 1,
      terms: paymentMandateTerms,
      hash: "h".repeat(64),
      authoritySignature: "sig",
      status: overrides?.paymentStatus ?? "ORDER_CREATED",
      requestId: "order-req-1",
      captureRequestId: null,
      paypalOrderId: orderId,
      paypalCaptureId: null,
      createdAt: new Date().toISOString(),
    };
    mockPaymentMandateRepo.records.set(pmRecord.id, pmRecord);

    fakePaymentProvider.createdOrders.set(orderId, {
      orderId,
      status: "APPROVED",
      requestId: "order-req-1",
      paymentMandateId: pmRecord.id,
      amountValue: "75.00",
      currency: "USD",
    });

    return { mandateId, orderId, paymentMandateId: pmRecord.id };
  }

  it("returns 401 UNAUTHENTICATED without session cookie", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORDER-123/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORDER-123" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.type).toContain("unauthenticated");
  });

  it("returns 400 VALIDATION_ERROR on malformed request JSON", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORDER-123/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: "invalid-json{",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORDER-123" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.type).toContain("validation-failed");
  });

  it("returns 400 VALIDATION_ERROR if mandateId is not a valid UUID", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORDER-123/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId: "not-a-uuid" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORDER-123" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.type).toContain("validation-failed");
  });

  it("returns 404 NOT_FOUND when order is unknown", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders/ORDER-UNKNOWN/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "ORDER-UNKNOWN" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.type).toContain("not-found");
  });

  it("returns 422 TERMS_MISMATCH if client provides mismatched mandateId", async () => {
    const { orderId } = await createValidOrderAndMandate();

    const req = new Request(`http://localhost:3000/api/v1/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId: randomUUID() }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("TERMS_MISMATCH");
    expect(body.type).toContain("terms-mismatch");
  });

  it("returns 200 OK on successful guarded capture", async () => {
    const { orderId } = await createValidOrderAndMandate();

    const req = new Request(`http://localhost:3000/api/v1/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
    });

    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe("COMPLETED");
    expect(body.captureId).toBeDefined();
  });

  it("returns 200 OK idempotently on already captured order", async () => {
    const { orderId } = await createValidOrderAndMandate({
      paymentStatus: "CAPTURED",
    });

    const req = new Request(`http://localhost:3000/api/v1/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
    });

    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.alreadyCaptured).toBe(true);
  });

  it("returns 500 on provider pending status", async () => {
    const { orderId } = await createValidOrderAndMandate();
    fakePaymentProvider.nextCaptureStatus = "PENDING";

    const req = new Request(`http://localhost:3000/api/v1/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
    });

    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("PROVIDER_ERROR");
  });
});
